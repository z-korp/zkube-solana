import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  BorshAccountsCoder,
  BorshInstructionCoder,
  convertIdlToCamelCase,
  type Idl,
} from "@anchor-lang/core";
import BN from "bn.js";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountInfo,
  type GetProgramAccountsFilter,
} from "@solana/web3.js";

import {
  KEEPER_PLAN_INSTRUCTION,
  MIN_SUPPORTED_DAY_ID,
  ARENA_ENTRY_LAMPORTS,
  ARENA_BOARD_ENTRY_SIZE,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  PLAYER_STATE_ACCOUNT_VERSION,
  PLAYER_STATE_RESERVED_BYTES,
  PROTOCOL_ACCOUNT_VERSION,
  SOL_PAYOUT_UNIT_LAMPORTS,
  ZKUBE_PROGRAM_ID,
  activeRunPda,
  arcadeConfigPda,
  arenaDailyPda,
  arenaBoardPda,
  arenaPlayerPda,
  assertCadenceId,
  currentDayId,
  cadenceFundingPda,
  nextScheduledDaily,
  playerStatePda,
  protocolPda,
  type KeeperOperation,
  type KeeperPlanContext,
} from "./arcadeChain.js";
import { dailyBoardPools, payoutPlan, dailyWindow, compareBoardEntries } from "./zkubeCore.js";
import {
  type DailySnapshot,
  type PeriodStatus,
  type ProtocolSnapshot,
  type RunLifecycle,
  type RunSnapshot,
  type ArcadeRootSnapshot,
  type ClosedArenaPlayerSnapshot,
  type CadenceArchiveCandidate,
  type SettlementSnapshot,
  type BoardSourceSnapshot,
  type BoardConstructionSnapshot,
} from "./arcadeReconciliation.js";
import { type ProtocolInstructionMaterializer } from "./planMaterializer.js";
import { getDelegationStatus } from "./router.js";
import { canonicalDevnetReplayDomainHex } from "./serviceReadiness.js";

const ARENA_BOARD_HEADER_BYTES = 125;
const MAX_PROGRAM_ACCOUNT_BYTES = 129_538;
// Anchor 1.0.2's public type encoder hardcodes a 1,000-byte scratch buffer.
// Build the same pinned IDL layout directly so production-sized cadence
// results remain byte-identical while the keeper owns an explicit hard bound.
const MAX_CADENCE_PERIODS = 10_000;
const MAX_DISCOVERED_PLAYER_STATES = 10_000;
export const MAX_ARENA_PLAYERS_PER_DAILY = 100_000;
const MAX_RPC_ACCOUNT_BATCH = 100;
export const KEEPER_EXPECTED_IDL_SHA256 =
  "72c82d6751d30d29d21bc7a608fbc8736ef7601e5acd4773a1d3203b85b2c360";
const REQUIRED_ACCOUNTS = [
  "activeRun",
  "arcadeConfig",
  "arenaDaily",
  "arenaBoard",
  "arenaPlayer",
  "playerState",
  "protocolConfig",
] as const;
const REQUIRED_INSTRUCTIONS = Object.values(KEEPER_PLAN_INSTRUCTION).map(({ instruction }) =>
  instruction.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()));

interface RemainingAccountMeta {
  pubkey: PublicKey;
  isWritable: boolean;
}

interface LoadedAccount {
  address: PublicKey;
  account: AccountInfo<Buffer>;
  value: Record<string, unknown>;
}

interface LoadedDaily {
  loaded: LoadedAccount;
  snapshot: DailySnapshot;
  scoreBoard?: LoadedAccount;
  themeBoard?: LoadedAccount;
}

interface LoadedBoardSnapshot {
  loaded: LoadedAccount;
  construction: BoardConstructionSnapshot;
  entries: BoardSourceSnapshot[];
  claimedMask: bigint;
}

interface PlayerStateRecord {
  address: PublicKey;
  owner: PublicKey;
  nextRunId: bigint;
  activeRunId: bigint;
  activeRunDaily: PublicKey;
  activeRunDeadlineAt: number;
  orphanRunId: bigint;
}

export interface AnchorKeeperAdapterInput {
  connection: Connection;
  nowUnix: number;
  routerEndpoint?: string;
  fetcher?: typeof fetch;
  connectionFactory?: (endpoint: string) => Connection;
  idlPath?: URL;
  /** Permits source-contract tests without changing the unapproved release fingerprint. */
  testExpectedIdlSha256?: string;
  release?: KeeperReleaseExpectation;
}

export interface KeeperReleaseExpectation {
  launchDayId: number;
}

export type KeeperLaunchState = "staged_launch_ready" | "active";

/** Exact checked-in Anchor IDL decoder and instruction materializer. */
export class AnchorKeeperAdapter implements ProtocolInstructionMaterializer {
  readonly idlHash: string;
  private readonly accountsCoder: BorshAccountsCoder;
  private readonly instructionCoder: BorshInstructionCoder;
  private readonly rentBySize = new Map<number, number>();

  private constructor(
    private readonly input: AnchorKeeperAdapterInput,
    private readonly idl: Idl,
    idlBytes: Buffer,
  ) {
    this.accountsCoder = new BorshAccountsCoder(idl);
    this.instructionCoder = new BorshInstructionCoder(idl);
    this.idlHash = createHash("sha256").update(idlBytes).digest("hex");
    if (input.testExpectedIdlSha256 && process.env.NODE_ENV !== "test") {
      throw new Error("test IDL expectation is unavailable outside tests");
    }
    const expectedIdlSha256 = input.testExpectedIdlSha256 ??
      KEEPER_EXPECTED_IDL_SHA256;
    if (this.idlHash !== expectedIdlSha256) {
      throw new Error("checked-in Anchor IDL hash does not match the keeper release");
    }
    assertIdlInterface(idl);
  }

  static async create(input: AnchorKeeperAdapterInput): Promise<AnchorKeeperAdapter> {
    const path = input.idlPath ??
      new URL("../../tools/chain/idl/solana.json", import.meta.url);
    const bytes = await readFile(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("checked-in Anchor IDL is malformed JSON");
    }
    if (!isRecord(parsed) || parsed.address !== ZKUBE_PROGRAM_ID.toBase58()) {
      throw new Error("checked-in Anchor IDL program address is not the pinned zKube program");
    }
    return new AnchorKeeperAdapter(
      input,
      convertIdlToCamelCase(parsed as Idl),
      bytes,
    );
  }

  async loadProtocolSnapshot(): Promise<ProtocolSnapshot> {
    const protocol = await this.loadRequired(
      "protocolConfig",
      protocolPda(),
      PROTOCOL_ACCOUNT_VERSION,
    );
    const config = await this.loadRequired(
      "arcadeConfig",
      arcadeConfigPda(),
      PROTOCOL_ACCOUNT_VERSION,
    );
    this.requireReleaseProtocol(protocol.value);
    requirePublicKey(config.value, "protocol", protocol.address, "ArcadeConfig protocol");
    if (u32(config.value.launchDayId, "launch day id") === 0) {
      throw new Error("keeper rejects an unseeded Arcade launch");
    }
    const launchDayId = u32(config.value.launchDayId, "launch day id");
    if (launchDayId < MIN_SUPPORTED_DAY_ID ||
        launchDayId > currentDayId(this.input.nowUnix)) {
      throw new Error("keeper rejects invalid launch cadence");
    }
    this.requireReleaseLaunchDay(launchDayId);
    const suspendedUntilDay = u32(
      config.value.suspendedUntilDay,
      "suspended-until day",
    );
    const paused = boolean(protocol.value.paused, "protocol pause state");
    const archiveRoot = await this.loadArchiveRoot(config);

    const today = currentDayId(this.input.nowUnix);
    const firstDay = launchDayId;
    const lastDay = nextScheduledDaily(today, suspendedUntilDay);
    const dailyIds = range(firstDay, lastDay);
    const dailies = await this.loadDailies(dailyIds, launchDayId);
    const launchDailyPresent =
      dailies.some(({ snapshot }) => snapshot.dayId === launchDayId) ||
      (archiveRoot.lastDailyId ?? -1) >= launchDayId;
    if (!launchDailyPresent) {
      throw new Error("seeded Arcade launch cadence is incomplete");
    }
    const playerStates = await this.loadPlayerStates();
    const runs = await this.loadRuns(playerStates, dailies);
    const { sources: boardSources, closed: closedArenaPlayers } = await this.loadBoardSources(dailies, archiveRoot);
    for (const daily of dailies) {
      const sources = boardSources.get(daily.snapshot.dayId) ?? {
        score: [],
        theme: [],
      };
      daily.snapshot.scoreSources = sources.score;
      daily.snapshot.themeSources = sources.theme;
      const sourceSettlement = this.arcadeSettlement(
        sources.score,
        sources.theme,
        daily.snapshot.scoreQualifiedPlayers,
        daily.snapshot.themeQualifiedPlayers,
        daily.snapshot.potLamports,
      );
      if (daily.snapshot.settlement &&
          !sameSettlementOwners(daily.snapshot.settlement, sourceSettlement)) {
        throw new Error("sealed ArenaBoard rows do not match canonical ArenaPlayer ordering");
      }
      daily.snapshot.settlement = sourceSettlement;
    }
    const archive = this.archiveSnapshot(dailies, archiveRoot);
    return {
      paused,
      launchDayId,
      suspendedUntilDay,
      dailies: dailies.map(({ snapshot }) => snapshot),
      runs,
      closedArenaPlayers,
      ...(archive ? {
        archiveState: archive.state,
        archiveCandidates: archive.candidates,
      } : {}),
    };
  }

  private async loadArchiveRoot(config: LoadedAccount): Promise<ArcadeRootSnapshot> {
    const launchDayId = this.requiredRelease().launchDayId;
    const lastDailyId = u32(config.value.lastDailyId, "ArcadeConfig last Daily id");
    const dailyRoot = bytes32Hex(config.value.dailyRoot, "ArcadeConfig Daily root");
    const today = currentDayId(this.input.nowUnix);
    if (lastDailyId < launchDayId - 1 || lastDailyId > today ||
        (lastDailyId === launchDayId - 1) !== /^0{64}$/.test(dailyRoot)) {
      throw new Error("ArcadeConfig result root is invalid");
    }
    const fundingAddress = cadenceFundingPda();
    const funding = await this.input.connection.getAccountInfo(
      fundingAddress,
      "confirmed",
    );
    if (!funding || funding.executable ||
        !funding.owner.equals(SystemProgram.programId) ||
        funding.data.length !== 0) {
      throw new Error("cadence funding PDA is missing or invalid");
    }
    return {
      address: config.address,
      cadenceFunding: fundingAddress,
      lastDailyId,
      dailyRoot,
    };
  }

  private archiveSnapshot(dailies: readonly LoadedDaily[], state: ArcadeRootSnapshot): {
    state: ArcadeRootSnapshot;
    candidates: CadenceArchiveCandidate[];
  } {
    const lastDailyId = state.lastDailyId!;
    const candidates: CadenceArchiveCandidate[] = [];
    for (const daily of dailies) {
      if (daily.snapshot.status !== "finalized") continue;
      if (!daily.snapshot.scoreBoard?.sealed || !daily.snapshot.themeBoard?.sealed ||
          !daily.scoreBoard || !daily.themeBoard) continue;
      candidates.push(this.archiveCandidate({
        cadenceId: daily.snapshot.dayId,
        period: daily.snapshot,
        lastCadenceId: lastDailyId,
      }));
    }
    return { state, candidates };
  }

  private archiveCandidate(input: {
    cadenceId: number;
    period: DailySnapshot;
    lastCadenceId: number;
  }): CadenceArchiveCandidate {
    const committed = input.cadenceId <= input.lastCadenceId;
    const closeEligibleAt = Math.max(
      input.period.scoreBoard!.sealedAt,
      input.period.themeBoard!.sealedAt,
    ) + DAILY_REWARD_CLAIM_WINDOW_SECONDS;
    return {
      cadenceId: input.cadenceId,
      claimsExpired: input.period.claimsExpired,
      committed,
      closeEligibleAt,
    };
  }

  /** Read-only verification gate for the paused carrier before launch seed. */
  async inspectLaunchState(): Promise<KeeperLaunchState> {
    const protocol = await this.loadRequired(
      "protocolConfig",
      protocolPda(),
      PROTOCOL_ACCOUNT_VERSION,
    );
    const config = await this.loadRequired(
      "arcadeConfig",
      arcadeConfigPda(),
      PROTOCOL_ACCOUNT_VERSION,
    );
    this.requireReleaseProtocol(protocol.value);
    requirePublicKey(config.value, "protocol", protocol.address, "ArcadeConfig protocol");
    const release = this.requiredRelease();

    if (u32(config.value.launchDayId, "launch day id") > 0) {
      this.requireReleaseLaunchDay(u32(config.value.launchDayId, "launch day id"));
      return "active";
    }
    if (!boolean(protocol.value.paused, "protocol pause state") ||
        u32(config.value.launchDayId, "launch day id") !== 0) {
      throw new Error("paused launch carrier is incomplete or active");
    }

    await this.loadStagedLaunchPeriods(release.launchDayId);
    return "staged_launch_ready";
  }

  private requiredRelease(): KeeperReleaseExpectation {
    const release = this.input.release;
    if (!release || !Number.isSafeInteger(release.launchDayId) ||
        release.launchDayId < MIN_SUPPORTED_DAY_ID) {
      throw new Error("keeper release expectation is missing or malformed");
    }
    return release;
  }

  private requireReleaseProtocol(value: Record<string, unknown>): void {
    if (bytes32Hex(value.replayDomain, "protocol replay domain") !==
        canonicalDevnetReplayDomainHex()) {
      throw new Error("protocol replay domain does not match keeper release");
    }
  }

  private requireReleaseLaunchDay(launchDayId: number): void {
    if (launchDayId !== this.requiredRelease().launchDayId) {
      throw new Error("Arcade launch day does not match keeper release");
    }
  }

  private async loadStagedLaunchPeriods(launchDayId: number): Promise<void> {
    for (const dayId of [launchDayId, launchDayId + 1]) {
      const daily = await this.loadRequired(
        "arenaDaily",
        arenaDailyPda(dayId),
        PROTOCOL_ACCOUNT_VERSION,
      );
      if (u32(daily.value.dayId, "ArenaDaily day id") !== dayId) {
        throw new Error("staged Daily cadence is invalid");
      }
      this.requireUnfundedPeriod(daily.value, "ArenaDaily");
    }
  }

  private requireUnfundedPeriod(
    value: Record<string, unknown>,
    label: string,
  ): void {
    if (periodStatus(value.status, `${label} status`) !== "funding" ||
        boolean(value.predecessorRolloverApplied, `${label} predecessor flag`) ||
        fundedLedgerLamports(value.ledger, label) !== 0n) {
      throw new Error(`${label} staged funding state is invalid`);
    }
  }

  async materialize(input: {
    operation: KeeperOperation;
    context: KeeperPlanContext;
    programId: PublicKey;
    keeper: PublicKey;
  }): Promise<readonly TransactionInstruction[]> {
    if (!input.programId.equals(ZKUBE_PROGRAM_ID)) {
      throw new Error("IDL materializer rejects an unpinned program");
    }
    const { name, args, accounts, remaining } = this.instructionInput(input);
    return [this.buildInstruction(name, args, accounts, remaining)];
  }

  private instructionInput(input: {
    operation: KeeperOperation;
    context: KeeperPlanContext;
    keeper: PublicKey;
  }): {
    name: string;
    args: Record<string, unknown>;
    accounts: Record<string, PublicKey>;
    remaining?: readonly RemainingAccountMeta[];
  } {
    const context = input.context;
    const keeper = input.keeper;
    const owner = context.owner;
    const runId = context.runId;
    const dayId = context.dayId ?? context.challengeDayId;
    const base = { caller: keeper, payer: keeper, systemProgram: SystemProgram.programId };
    switch (input.operation) {
      case "prepare_arena_daily": {
        const following = requiredNumber(context.followingDayId, "following day id");
        return {
          name: "prepareArenaDaily",
          args: { dayId: following },
          accounts: {
            ...base,
            protocol: protocolPda(),
            arcadeConfig: arcadeConfigPda(),
            arenaDaily: arenaDailyPda(following),
            cadenceFunding: cadenceFundingPda(),
          },
        };
      }
      case "activate_arena_daily":
        return {
          name: "activateArenaDaily",
          args: {},
          accounts: {
            ...base,
            protocol: protocolPda(),
            arcadeConfig: arcadeConfigPda(),
            arenaDaily: arenaDailyPda(requiredNumber(dayId, "day id")),
          },
        };
      case "skip_suspended_arena_daily":
        return {
          name: "skipSuspendedArenaDaily",
          args: {},
          accounts: {
            caller: keeper,
            arcadeConfig: arcadeConfigPda(),
            suspendedDaily: arenaDailyPda(requiredNumber(dayId, "day id")),
            successorDaily: arenaDailyPda(
              requiredNumber(context.followingDayId, "following day id"),
            ),
            cadenceFunding: cadenceFundingPda(),
          },
        };
      case "finish_run": {
        const player = requiredOwner(owner);
        return {
          name: "finishRun",
          args: { reason: { deadline: {} } },
          accounts: {
            actor: keeper,
            activeRun: activeRunPda(requiredOwner(owner), requiredRunId(runId)),
            ownerAuthority: player,
            sessionToken: ZKUBE_PROGRAM_ID,
          },
        };
      }
      case "commit_run":
        return {
          name: "commitRun",
          args: {},
          accounts: {
            ...base,
            activeRun: activeRunPda(requiredOwner(owner), requiredRunId(runId)),
          },
        };
      case "consume_arena_run": {
        const player = requiredOwner(owner);
        const challenge = requiredNumber(dayId, "challenge day id");
        const daily = arenaDailyPda(challenge);
        return {
          name: "consumeArenaRun",
          args: {},
          accounts: {
            playerState: playerStatePda(player),
            arenaDaily: context.includeArenaPlayer ? daily : ZKUBE_PROGRAM_ID,
            arenaPlayer: context.includeArenaPlayer ? arenaPlayerPda(daily, player) : ZKUBE_PROGRAM_ID,
            activeRun: activeRunPda(player, requiredRunId(runId)),
            rentRecipient: requireRentRecipient(context.rentRecipient),
          },
        };
      }
      case "expire_unresolved_arena_run": {
        const player = requiredOwner(owner);
        const daily = arenaDailyPda(requiredNumber(dayId, "challenge day id"));
        return {
          name: "expireUnresolvedArenaRun",
          args: {},
          accounts: {
            ...base,
            playerState: playerStatePda(player),
            arenaDaily: daily,
            arenaPlayer: arenaPlayerPda(daily, player),
            owner: player,
          },
        };
      }
      case "finalize_arena_daily":
        {
          const daily = arenaDailyPda(requiredNumber(dayId, "day id"));
        return {
          name: "finalizeArenaDaily",
          args: {},
          accounts: {
            caller: keeper,
            arenaDaily: daily,
            followingDaily: arenaDailyPda(
              requiredNumber(context.followingDayId, "following day id"),
            ),
            scoreBoard: arenaBoardPda(daily, "score"),
            themeBoard: arenaBoardPda(daily, "theme"),
            cadenceFunding: cadenceFundingPda(),
            systemProgram: SystemProgram.programId,
          },
        };
        }
      case "submit_arena_board_chunk": {
        const daily = arenaDailyPda(requiredNumber(dayId, "day id"));
        const board = requiredBoardKind(context.boardKind);
        const entries = context.boardEntries;
        if (!entries) throw new Error("board chunk entries are missing");
        return {
          name: "submitArenaBoardChunk",
          args: {
            kind: dailyBoardKind(board),
            entries: entries.map((entry) => ({
              score: entry.score,
              objectiveTotal: new BN(entry.objectiveTotal.toString()),
              finalizedAt: new BN(entry.finalizedAt),
              replayHash: [...entry.replayHash],
            })),
          },
          accounts: {
            caller: keeper,
            arenaDaily: daily,
            arenaBoard: arenaBoardPda(daily, board),
          },
          remaining: entries.map((entry) => ({
            pubkey: entry.source,
            isWritable: false,
          })),
        };
      }
      case "expire_daily_claims":
        {
          const daily = arenaDailyPda(requiredNumber(dayId, "day id"));
        return {
          name: "expireDailyClaims",
          args: {},
          accounts: {
            caller: keeper,
            arcadeConfig: arcadeConfigPda(),
            arenaDaily: daily,
            scoreBoard: arenaBoardPda(daily, "score"),
            themeBoard: arenaBoardPda(daily, "theme"),
            followingDaily: arenaDailyPda(
              requiredNumber(context.followingDayId, "following day id"),
            ),
          },
        };
        }
      case "archive_arena_daily":
        {
          const daily = arenaDailyPda(requiredNumber(dayId, "day id"));
        return {
          name: "archiveArenaDaily",
          args: {},
          accounts: {
            caller: keeper,
            arcadeConfig: arcadeConfigPda(),
            arenaDaily: daily,
            scoreBoard: arenaBoardPda(daily, "score"),
            themeBoard: arenaBoardPda(daily, "theme"),
          },
        };
        }
      case "close_arena_daily":
        {
          const daily = arenaDailyPda(requiredNumber(dayId, "day id"));
        return {
          name: "closeArenaDaily",
          args: {},
          accounts: {
            caller: keeper,
            arcadeConfig: arcadeConfigPda(),
            arenaDaily: daily,
            scoreBoard: arenaBoardPda(daily, "score"),
            themeBoard: arenaBoardPda(daily, "theme"),
            cadenceFunding: cadenceFundingPda(),
          },
        };
        }
      case "close_arena_player": {
        const daily = arenaDailyPda(requiredNumber(dayId, "day id"));
        return {
          name: "closeArenaPlayer",
          args: {},
          accounts: {
            caller: keeper,
            arenaDaily: daily,
            arenaPlayer: arenaPlayerPda(daily, requiredOwner(owner)),
            rentRecipient: requireRentRecipient(context.rentRecipient),
          },
        };
      }
      default:
        throw new Error(
          `keeper materializer operation is outside the exact allowlist: ${String(input.operation)}`,
        );
    }
  }

  private buildInstruction(
    name: string,
    args: Record<string, unknown>,
    accounts: Record<string, PublicKey>,
    remaining: readonly RemainingAccountMeta[] = [],
  ): TransactionInstruction {
    const instruction = instructionRecord(this.idl, name);
    const accountSpecs = instruction.accounts;
    const keys = accountSpecs.map((raw) => {
      if (!isRecord(raw) || typeof raw.name !== "string") {
        throw new Error(`Anchor IDL ${name} contains a nested or malformed account`);
      }
      const staticAddress = typeof raw.address === "string"
        ? new PublicKey(raw.address)
        : undefined;
      const supplied = accounts[raw.name];
      if (staticAddress && supplied && !staticAddress.equals(supplied)) {
        throw new Error(`Anchor IDL ${name}.${raw.name} static address drifted`);
      }
      const pubkey = staticAddress ?? supplied;
      if (!pubkey) throw new Error(`Anchor IDL materializer is missing ${name}.${raw.name}`);
      return {
        pubkey,
        isWritable: raw.writable === true,
        isSigner: raw.signer === true,
      };
    });
    keys.push(...remaining.map(({ pubkey, isWritable }) => ({
      pubkey,
      isWritable,
      isSigner: false,
    })));
    return new TransactionInstruction({
      programId: ZKUBE_PROGRAM_ID,
      keys,
      data: this.instructionCoder.encode(name, args),
    });
  }

  private async loadDailies(
    ids: readonly number[],
    launchDayId: number,
  ): Promise<LoadedDaily[]> {
    const loaded = await this.loadKnown(
      "arenaDaily",
      ids.map((id) => ({ id, address: arenaDailyPda(id) })),
      PROTOCOL_ACCOUNT_VERSION,
    );
    const output: LoadedDaily[] = [];
    for (const item of loaded) {
      const dayId = u32(item.value.dayId, "ArenaDaily day id");
      const { runsCloseAt, recoveryDeadlineAt } = dailyWindow(dayId);
      if (!item.address.equals(arenaDailyPda(dayId))) {
        throw new Error("ArenaDaily PDA or cadence relationship is invalid");
      }
      requirePublicKey(
        item.value,
        "arcadeConfig",
        arcadeConfigPda(),
        "ArenaDaily ArcadeConfig",
      );
      const status = periodStatus(item.value.status, "ArenaDaily status");
      const finalizedAt = signedTimestamp(
        item.value.finalizedAt,
        "ArenaDaily finalization",
      );
      const availableLamports = availableLedgerLamports(item.value.ledger, "ArenaDaily");
      const potLamports = status === "finalized"
        ? fundedLedgerLamports(item.value.ledger, "ArenaDaily")
        : availableLamports;
      if (status === "finalized" && availableLamports !== 0n) {
        throw new Error("finalized ArenaDaily retains unsettled ledger lamports");
      }
      const scoreQualifiedPlayers = u32(
        item.value.scoreQualifiedPlayers,
        "ArenaDaily Score qualified players",
      );
      const themeQualifiedPlayers = u32(
        item.value.themeQualifiedPlayers,
        "ArenaDaily Theme qualified players",
      );
      const claimsExpired = boolean(item.value.claimsExpired, "ArenaDaily claim expiry");
      let scoreClaimedMask = 0n;
      let themeClaimedMask = 0n;
      let scoreBoard: LoadedBoardSnapshot | undefined;
      let themeBoard: LoadedBoardSnapshot | undefined;
      let settlement: SettlementSnapshot | undefined;
      let integrityFailure: string | undefined;
      if (status === "finalized") {
        const pools = dailyBoardPools(potLamports, themeQualifiedPlayers);
        scoreBoard = await this.loadArenaBoard(
          item.address,
          dayId,
          "score",
          scoreQualifiedPlayers,
          pools.score,
        );
        themeBoard = await this.loadArenaBoard(
          item.address,
          dayId,
          "theme",
          themeQualifiedPlayers,
          pools.theme,
        );
        scoreClaimedMask = scoreBoard.claimedMask;
        themeClaimedMask = themeBoard.claimedMask;
        if (scoreBoard.construction.sealed && themeBoard.construction.sealed) {
          try {
            settlement = this.arcadeSettlement(
              scoreBoard.entries,
              themeBoard.entries,
              scoreQualifiedPlayers,
              themeQualifiedPlayers,
              potLamports,
            );
          } catch (error) {
            integrityFailure =
              error instanceof Error ? error.message : String(error);
          }
        }
      }
      const retainedClaims = status === "finalized" && !claimsExpired &&
          scoreBoard && themeBoard
        ? bigint(scoreBoard.loaded.value.paidLamports, "Score board paid") -
            scoreBoard.construction.claimedLamports +
            bigint(themeBoard.loaded.value.paidLamports, "Theme board paid") -
            themeBoard.construction.claimedLamports
        : availableLamports;
      await this.assertSpendable(item.account, retainedClaims, "ArenaDaily");
      const snapshot: DailySnapshot = {
        dayId,
        status,
        finalizedAt,
        runsCloseAt,
        recoveryDeadlineAt,
        entriesPaid: bigint(item.value.entriesPaid, "ArenaDaily paid entries"),
        entriesScored: bigint(item.value.entriesScored, "ArenaDaily scored entries"),
        entriesExpired: bigint(item.value.entriesExpired, "ArenaDaily expired entries"),
        potLamports,
        scoreQualifiedPlayers,
        themeQualifiedPlayers,
        predecessorRolloverRequired: dayId !== launchDayId,
        predecessorRolloverApplied: boolean(
          item.value.predecessorRolloverApplied,
          "ArenaDaily predecessor flag",
        ),
        scoreClaimedMask,
        themeClaimedMask,
        claimsExpired,
        ...(scoreBoard ? {
          scoreBoard: scoreBoard.construction,
          scoreSources: scoreBoard.entries,
        } : {}),
        ...(themeBoard ? {
          themeBoard: themeBoard.construction,
          themeSources: themeBoard.entries,
        } : {}),
        ...(settlement ? { settlement } : {}),
        ...(integrityFailure ? { integrityFailure } : {}),
      };
      output.push({
        loaded: item,
        snapshot,
        ...(scoreBoard ? { scoreBoard: scoreBoard.loaded } : {}),
        ...(themeBoard ? { themeBoard: themeBoard.loaded } : {}),
      });
    }
    return output;
  }

  private async loadArenaBoard(
    daily: PublicKey,
    dayId: number,
    kind: "score" | "theme",
    qualifiedCount: number,
    poolLamports: bigint,
  ): Promise<LoadedBoardSnapshot> {
    const address = arenaBoardPda(daily, kind);
    const loaded = await this.loadRequired(
      "arenaBoard",
      address,
      PROTOCOL_ACCOUNT_VERSION,
    );
    requirePublicKey(loaded.value, "arenaDaily", daily, `ArenaBoard ${kind} Daily`);
    const decodedKind = enumVariant(loaded.value.kind, `ArenaBoard ${kind} kind`);
    const payoutCount = u32(loaded.value.payoutCount, `ArenaBoard ${kind} payout count`);
    const widthCount = u32(loaded.value.widthCount, `ArenaBoard ${kind} width count`);
    const cursor = u32(loaded.value.cursor, `ArenaBoard ${kind} cursor`);
    const claimedCount = u32(
      loaded.value.claimedCount,
      `ArenaBoard ${kind} claimed count`,
    );
    const bitmapBytes = Math.ceil(payoutCount / 8);
    const expectedSize = ARENA_BOARD_HEADER_BYTES +
      cursor * ARENA_BOARD_ENTRY_SIZE + bitmapBytes;
    const plan = payoutPlan(
      poolLamports,
      qualifiedCount,
      ARENA_ENTRY_LAMPORTS,
      SOL_PAYOUT_UNIT_LAMPORTS,
    );
    const capacityLimited = boolean(
      loaded.value.capacityLimited,
      `ArenaBoard ${kind} capacity condition`,
    );
    if (decodedKind !== kind ||
        u32(loaded.value.dayId, `ArenaBoard ${kind} day`) !== dayId ||
        u32(loaded.value.qualifiedCount, `ArenaBoard ${kind} qualified count`) !==
          qualifiedCount || payoutCount !== plan.winnerCount ||
        widthCount !== plan.widthWinnerCount ||
        bigint(loaded.value.denominator, `ArenaBoard ${kind} denominator`) !==
          plan.denominator ||
        bigint(loaded.value.poolLamports, `ArenaBoard ${kind} pool`) !== poolLamports ||
        bigint(loaded.value.paidLamports, `ArenaBoard ${kind} paid`) !==
          plan.paidLamports ||
        bigint(loaded.value.rolloverLamports, `ArenaBoard ${kind} rollover`) !==
          plan.rolloverLamports || capacityLimited !== plan.capacityLimited ||
        cursor > payoutCount || claimedCount > payoutCount ||
        loaded.account.data.length !== expectedSize) {
      throw new Error(`${kind} ArenaBoard header is not canonical`);
    }
    const entries: BoardSourceSnapshot[] = [];
    for (let position = 0; position < cursor; position += 1) {
      const offset = ARENA_BOARD_HEADER_BYTES + position * ARENA_BOARD_ENTRY_SIZE;
      const row = loaded.account.data.subarray(offset, offset + ARENA_BOARD_ENTRY_SIZE);
      const owner = new PublicKey(row.subarray(0, 32));
      entries.push({
        source: arenaPlayerPda(daily, owner),
        owner,
        score: row.readUInt32LE(32),
        objectiveTotal: row.readBigUInt64LE(36),
        finalizedAt: safeBigintNumber(row.readBigInt64LE(44), `${kind} finalization`),
        replayHash: Uint8Array.from(row.subarray(52, 84)),
      });
    }
    const masksOffset = ARENA_BOARD_HEADER_BYTES +
      cursor * ARENA_BOARD_ENTRY_SIZE;
    const claimedMask = littleEndianMask(
      loaded.account.data.subarray(masksOffset, masksOffset + bitmapBytes),
    );
    if (popcount(claimedMask) !== claimedCount) {
      throw new Error(`${kind} ArenaBoard bitmap counters do not match`);
    }
    const sealed = cursor === payoutCount;
    const sealedAt = signedTimestamp(
      loaded.value.sealedAt,
      `ArenaBoard ${kind} seal time`,
    );
    if (sealed !== (sealedAt > 0)) {
      throw new Error(`${kind} ArenaBoard seal does not match its cursor`);
    }
    const claimedLamports = bigint(
      loaded.value.claimedLamports,
      `ArenaBoard ${kind} claimed lamports`,
    );
    const expectedClaimed = plan.payouts.reduce(
      (sum, payout, position) =>
        (claimedMask & (1n << BigInt(position))) === 0n ? sum : sum + payout,
      0n,
    );
    if (claimedLamports !== expectedClaimed) {
      throw new Error(`${kind} ArenaBoard claimed lamports do not match its bitmap`);
    }
    return {
      loaded,
      construction: {
        kind,
        payoutCount,
        widthCount,
        cursor,
        sealed,
        sealedAt,
        claimedLamports,
        claimedCount,
        capacityLimited,
      },
      entries,
      claimedMask,
    };
  }

  private async loadBoardSources(
    dailies: readonly LoadedDaily[],
    root: ArcadeRootSnapshot,
  ): Promise<{ sources: Map<number, { score: BoardSourceSnapshot[]; theme: BoardSourceSnapshot[] }>;
    closed: ClosedArenaPlayerSnapshot[] }> {
    const closed: ClosedArenaPlayerSnapshot[] = [];
    const boardSources = new Map<number, {
      score: BoardSourceSnapshot[];
      theme: BoardSourceSnapshot[];
    }>();
    const today = currentDayId(this.input.nowUnix);
    const firstDay = this.requiredRelease().launchDayId;
    const dayByAddress = new Map(
      range(firstDay, today)
        .map((dayId) => [arenaDailyPda(dayId).toBase58(), dayId]),
    );
    const liveDaily = new Map(
      dailies.map(({ snapshot }) => [snapshot.dayId, snapshot]),
    );
    const discovered = await this.scanAccounts(
      "arenaPlayer",
      PROTOCOL_ACCOUNT_VERSION,
      MAX_ARENA_PLAYERS_PER_DAILY,
    );
    for (const player of discovered) {
      const challenge = publicKey(player.value.challenge, "ArenaPlayer challenge");
      const owner = publicKey(player.value.player, "ArenaPlayer owner");
      const dayId = dayByAddress.get(challenge.toBase58());
      if (dayId === undefined ||
          !player.address.equals(arenaPlayerPda(challenge, owner))) {
        throw new Error("ArenaPlayer cleanup PDA or Daily relationship is invalid");
      }
      if (!liveDaily.has(dayId)) {
        const rentPayer = publicKey(player.value.rentPayer, "ArenaPlayer rent payer");
        if (dayId > (root.lastDailyId ?? -1) || rentPayer.equals(PublicKey.default) ||
            bigint(player.value.activePaidRunId, "ArenaPlayer active run") !== 0n ||
            u32(player.value.paidEntries, "ArenaPlayer paid entries") !==
              u32(player.value.resolvedEntries, "ArenaPlayer resolved entries")) {
          throw new Error("closed Daily retains an invalid ArenaPlayer");
        }
        closed.push({ dayId, owner, rentPayer });
        continue;
      }
      const sources = boardSources.get(dayId) ?? { score: [], theme: [] };
      if (u32(record(player.value.scoreBestEntry, "Score best row").score, "best score") > 0) {
        sources.score.push(boardSourceSnapshot(player, owner, "score"));
      }
      if (bigint(record(player.value.themeBestEntry, "Theme best row").objectiveTotal, "best Theme metric") > 0n) {
        sources.theme.push(boardSourceSnapshot(player, owner, "theme"));
      }
      boardSources.set(dayId, sources);
    }
    for (const sources of boardSources.values()) {
      sources.score.sort((left, right) => compareBoardSources("score", left, right));
      sources.theme.sort((left, right) => compareBoardSources("theme", left, right));
    }
    return { sources: boardSources, closed };
  }

  private async loadPlayerStates(): Promise<PlayerStateRecord[]> {
    const accounts = await this.scanAccounts(
      "playerState",
      PLAYER_STATE_ACCOUNT_VERSION,
      MAX_DISCOVERED_PLAYER_STATES,
    );
    return accounts.map((loaded) => {
      const owner = publicKey(loaded.value.owner, "PlayerState owner");
      if (!loaded.address.equals(playerStatePda(owner))) {
        throw new Error("PlayerState PDA is invalid");
      }
      const nextRunId = bigint(loaded.value.nextRunId, "PlayerState next run id");
      const activeRunId = bigint(loaded.value.activeRunId, "PlayerState active run id");
      const orphanRunId = bigint(loaded.value.orphanRunId, "PlayerState orphan run id");
      const activeRunDaily = publicKey(
        loaded.value.activeRunDaily,
        "PlayerState active run Daily",
      );
      const activeRunDeadlineAt = signedTimestamp(
        loaded.value.activeRunDeadlineAt,
        "PlayerState active run deadline",
      );
      bigint(loaded.value.ladderPoints, "PlayerState ladder points");
      const highestLadderTier = u8(
        loaded.value.highestLadderTier,
        "PlayerState highest ladder tier",
      );
      const reserved = array(loaded.value.reserved, "PlayerState reserved bytes");
      if (highestLadderTier > 4 || reserved.length !== PLAYER_STATE_RESERVED_BYTES ||
          reserved.some((value) => u8(value, "PlayerState reserved byte") !== 0)) {
        throw new Error("PlayerState reserved bytes are nonzero");
      }
      if (nextRunId === 0n || activeRunId >= nextRunId ||
          orphanRunId >= nextRunId ||
          (activeRunId !== 0n && orphanRunId !== 0n)) {
        throw new Error("PlayerState run reservations are invalid");
      }
      const idle = activeRunId === 0n;
      const noArenaCadence = activeRunDaily.equals(SystemProgram.programId) &&
        activeRunDeadlineAt === 0;
      if ((idle && !noArenaCadence) ||
          (!idle && (activeRunDaily.equals(SystemProgram.programId) || activeRunDeadlineAt <= 0))) {
        throw new Error("PlayerState active reservation fields are inconsistent");
      }
      return {
        address: loaded.address,
        owner,
        nextRunId,
        activeRunId,
        activeRunDaily,
        activeRunDeadlineAt,
        orphanRunId,
      };
    });
  }

  private async loadRuns(
    players: readonly PlayerStateRecord[],
    dailies: readonly LoadedDaily[],
  ): Promise<RunSnapshot[]> {
    const dailyByAddress = new Map(
      dailies.map(({ loaded, snapshot }) => [loaded.address.toBase58(), snapshot]),
    );
    const output: RunSnapshot[] = [];
    for (const player of players) {
      if (player.activeRunId !== 0n) {
        try {
          output.push(await this.loadRun(
            player,
            player.activeRunId,
            true,
            dailyByAddress,
            {
              daily: player.activeRunDaily,
              deadlineAt: player.activeRunDeadlineAt,
            },
          ));
        } catch (error) {
          if (this.input.nowUnix <
              dailyWindow(currentDayId(player.activeRunDeadlineAt)).recoveryDeadlineAt) {
            throw error;
          }
          const daily = dailyByAddress.get(player.activeRunDaily.toBase58());
          const cadence = daily
            ? { challengeDayId: daily.dayId, deadlineDayId: daily.dayId }
            : arcadeCadenceFromDeadline(
              player.activeRunDaily,
              player.activeRunDeadlineAt,
            );
          const arenaPlayerExists = await this.loadArenaPlayerExists(
            player.activeRunDaily,
            player.owner,
          );
          output.push({
            owner: player.owner,
            runId: player.activeRunId,
            challengeDayId: cadence.challengeDayId,
            deadlineDayId: cadence.deadlineDayId,
            arenaPlayerExists,
            lifecycle: "unavailable",
            location: "unavailable",
            acceptedActions: 0,
            runsCloseAt: player.activeRunDeadlineAt,
            recoveryDeadlineAt: dailyWindow(currentDayId(player.activeRunDeadlineAt)).recoveryDeadlineAt,
            reservationActive: true,
          });
        }
      }
      if (player.orphanRunId !== 0n) {
        try {
          output.push(await this.loadRun(
            player,
            player.orphanRunId,
            false,
            dailyByAddress,
          ));
        } catch {
          // The durable orphan remains non-scoreable; retry Router discovery.
        }
      }
    }
    return output;
  }

  private async loadRun(
    player: PlayerStateRecord,
    runId: bigint,
    reservationActive: boolean,
    dailyByAddress: ReadonlyMap<string, DailySnapshot>,
    expected?: {
      daily: PublicKey;
      deadlineAt: number;
    },
  ): Promise<RunSnapshot> {
    const address = activeRunPda(player.owner, runId);
    const status = await getDelegationStatus(
      address,
      this.input.routerEndpoint,
      this.input.fetcher,
    );
    let connection = this.input.connection;
    let location: "base" | "ephemeral_rollup" = "base";
    if (status.isDelegated) {
      if (!status.fqdn || status.delegationRecord?.owner !== ZKUBE_PROGRAM_ID.toBase58()) {
        throw new Error("ActiveRun delegation record is incomplete or foreign");
      }
      connection = this.input.connectionFactory?.(status.fqdn) ??
        new Connection(status.fqdn, "confirmed");
      location = "ephemeral_rollup";
    }
    const info = await connection.getAccountInfo(address, "confirmed");
    if (!info) throw new Error("ActiveRun is missing at its resolved location");
    const loaded = this.decodeAccount(
      "activeRun",
      address,
      info,
      PROTOCOL_ACCOUNT_VERSION,
      address,
    );
    const owner = publicKey(loaded.value.owner, "ActiveRun owner");
    const rentPayer = publicKey(loaded.value.rentPayer, "ActiveRun rent payer");
    const decodedRunId = bigint(loaded.value.runId, "ActiveRun run id");
    if (!owner.equals(player.owner) || decodedRunId !== runId) {
      throw new Error("ActiveRun identity is invalid");
    }
    const deadlineAt = signedTimestamp(loaded.value.deadlineAt, "ActiveRun deadline");
    const dailyAddress = publicKey(loaded.value.dailyChallenge, "ActiveRun Daily");
    if (reservationActive &&
        (!expected || !dailyAddress.equals(expected.daily) ||
          deadlineAt !== expected.deadlineAt)) {
      throw new Error("ActiveRun does not match its durable reservation");
    }
    const daily = dailyByAddress.get(dailyAddress.toBase58());
    const cadence = daily
      ? { challengeDayId: daily.dayId, deadlineDayId: daily.dayId }
      : arcadeCadenceFromDeadline(dailyAddress, deadlineAt);
    const arenaPlayerExists = await this.loadArenaPlayerExists(dailyAddress, owner);
    if (!arenaPlayerExists) {
      throw new Error("arcade ActiveRun is missing its ArenaPlayer");
    }
    return {
      owner,
      rentPayer,
      runId,
      challengeDayId: cadence.challengeDayId,
      deadlineDayId: cadence.deadlineDayId,
      arenaPlayerExists,
      lifecycle: runLifecycle(loaded.value.lifecycle, "ActiveRun lifecycle"),
      location,
      acceptedActions: u32(loaded.value.actionCounter, "ActiveRun action counter"),
      runsCloseAt: deadlineAt,
      recoveryDeadlineAt: dailyWindow(currentDayId(deadlineAt)).recoveryDeadlineAt,
      reservationActive,
    };
  }

  private async loadArenaPlayerExists(daily: PublicKey, owner: PublicKey): Promise<boolean> {
    const address = arenaPlayerPda(daily, owner);
    const info = await this.input.connection.getAccountInfo(address, "confirmed");
    if (!info) return false;
    const loaded = this.decodeAccount(
      "arenaPlayer",
      address,
      info,
      PROTOCOL_ACCOUNT_VERSION,
      address,
    );
    requirePublicKey(loaded.value, "challenge", daily, "ArenaPlayer challenge");
    requirePublicKey(loaded.value, "player", owner, "ArenaPlayer owner");
    return true;
  }

  private arcadeSettlement(
    scoreEntries: readonly BoardSourceSnapshot[],
    themeEntries: readonly BoardSourceSnapshot[],
    scoreQualifiedPlayers: number,
    themeQualifiedPlayers: number,
    potLamports: bigint,
  ): SettlementSnapshot {
    const pools = dailyBoardPools(potLamports, themeQualifiedPlayers);
    const scorePlan = payoutPlan(
      pools.score,
      scoreQualifiedPlayers,
      ARENA_ENTRY_LAMPORTS,
      SOL_PAYOUT_UNIT_LAMPORTS,
    );
    const themePlan = payoutPlan(
      pools.theme,
      themeQualifiedPlayers,
      ARENA_ENTRY_LAMPORTS,
      SOL_PAYOUT_UNIT_LAMPORTS,
    );
    const winners = ([
      ["score", scoreEntries, scorePlan] as const,
      ["theme", themeEntries, themePlan] as const,
    ]).flatMap(([board, entries, plan]) => {
      if (entries.length < plan.winnerCount) {
        throw new Error(`${board} board does not retain every claimable winner`);
      }
      return entries.slice(0, plan.winnerCount).map((entry, index) => ({
        board,
        owner: entry.owner,
        rank: index + 1,
        payoutLamports: plan.payouts[index]!,
      }));
    });
    return {
      winners,
      rolloverLamports: scorePlan.rolloverLamports + themePlan.rolloverLamports,
      scoreCapacityLimited: scorePlan.capacityLimited,
      themeCapacityLimited: themePlan.capacityLimited,
    };
  }

  private async assertSpendable(
    account: AccountInfo<Buffer>,
    accountedLamports: bigint,
    label: string,
  ): Promise<void> {
    let rent = this.rentBySize.get(account.data.length);
    if (rent === undefined) {
      rent = await this.input.connection.getMinimumBalanceForRentExemption(
        account.data.length,
        "confirmed",
      );
      this.rentBySize.set(account.data.length, rent);
    }
    const spendable = BigInt(account.lamports - rent);
    if (account.lamports < rent || spendable < accountedLamports) {
      throw new Error(`${label} lamports do not cover rent and its accounted pool`);
    }
  }

  private async loadRequired(
    name: string,
    address: PublicKey,
    version: number | readonly number[],
  ): Promise<LoadedAccount> {
    const info = await this.input.connection.getAccountInfo(address, "confirmed");
    if (!info) throw new Error(`${name} account is missing`);
    return this.decodeAccount(name, address, info, version, address);
  }

  private async loadKnown(
    name: string,
    items: readonly { id: number; address: PublicKey }[],
    version: number | readonly number[],
  ): Promise<LoadedAccount[]> {
    const infos = await this.getMultiple(items.map(({ address }) => address));
    return items.flatMap((item, index) => {
      const info = infos[index];
      return info
        ? [this.decodeAccount(name, item.address, info, version, item.address)]
        : [];
    });
  }

  private async scanAccounts(
    name: string,
    version: number | readonly number[],
    maximum: number,
    extraFilters: readonly GetProgramAccountsFilter[] = [],
  ): Promise<LoadedAccount[]> {
    const discriminator = this.accountsCoder.accountDiscriminator(name);
    const accounts = await this.input.connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { memcmp: { offset: 0, bytes: base58(discriminator) } },
        ...extraFilters,
      ],
    });
    if (accounts.length > maximum) {
      throw new Error(`${name} discovery exceeded its fail-closed account bound`);
    }
    return accounts.map(({ pubkey, account }) => this.decodeAccount(
      name,
      pubkey,
      { ...account, data: Buffer.from(account.data) },
      version,
    ));
  }

  private decodeAccount(
    name: string,
    address: PublicKey,
    info: AccountInfo<Buffer>,
    version: number | readonly number[],
    expectedAddress?: PublicKey,
  ): LoadedAccount {
    if ((expectedAddress && !address.equals(expectedAddress)) ||
        !info.owner.equals(ZKUBE_PROGRAM_ID) || info.executable ||
        info.data.length < 9 || info.data.length >= MAX_PROGRAM_ACCOUNT_BYTES ||
        !info.data.subarray(0, 8).equals(this.accountsCoder.accountDiscriminator(name)) ||
        !(Array.isArray(version)
          ? version.includes(info.data[8]!)
          : info.data[8] === version)) {
      throw new Error(`${name} owner, size, discriminator, version, or PDA is invalid`);
    }
    let decoded: unknown;
    try {
      decoded = this.accountsCoder.decode(name, info.data);
    } catch {
      throw new Error(`${name} data is malformed`);
    }
    return { address, account: info, value: record(decoded, name) };
  }

  private async getMultiple(
    addresses: readonly PublicKey[],
  ): Promise<Array<AccountInfo<Buffer> | null>> {
    const output: Array<AccountInfo<Buffer> | null> = [];
    for (let start = 0; start < addresses.length; start += MAX_RPC_ACCOUNT_BATCH) {
      const batch = addresses.slice(start, start + MAX_RPC_ACCOUNT_BATCH);
      const infos = await this.input.connection.getMultipleAccountsInfo(batch, "confirmed");
      if (infos.length !== batch.length) {
        throw new Error("RPC returned an incomplete account batch");
      }
      output.push(...infos);
    }
    return output;
  }
}

function boardSourceSnapshot(
  loaded: LoadedAccount,
  owner: PublicKey,
  kind: "score" | "theme",
): BoardSourceSnapshot {
  const field = kind === "score" ? "scoreBestEntry" : "themeBestEntry";
  const entry = record(loaded.value[field], `ArenaPlayer ${kind} best entry`);
  requirePublicKey(entry, "player", owner, `ArenaPlayer ${kind} best owner`);
  return {
    source: loaded.address,
    owner,
    score: u32(entry.score, `ArenaPlayer ${kind} score`),
    objectiveTotal: bigint(
      entry.objectiveTotal,
      `ArenaPlayer ${kind} objective total`,
    ),
    finalizedAt: signedTimestamp(
      entry.finalizedAt,
      `ArenaPlayer ${kind} finalization`,
    ),
    replayHash: bytes32(entry.replayHash, `ArenaPlayer ${kind} replay hash`),
  };
}

function compareBoardSources(
  kind: "score" | "theme",
  left: BoardSourceSnapshot,
  right: BoardSourceSnapshot,
): number {
  const leftMetric = kind === "score" ? BigInt(left.score) : left.objectiveTotal;
  const rightMetric = kind === "score" ? BigInt(right.score) : right.objectiveTotal;
  return compareBoardEntries(leftMetric, left.finalizedAt, left.owner.toBytes(),
    rightMetric, right.finalizedAt, right.owner.toBytes());
}

function sameSettlementOwners(
  left: SettlementSnapshot,
  right: SettlementSnapshot,
): boolean {
  return left.winners.length === right.winners.length &&
    left.winners.every((winner, index) => {
      const other = right.winners[index];
      return other !== undefined && winner.board === other.board &&
        winner.rank === other.rank && winner.owner.equals(other.owner) &&
        winner.payoutLamports === other.payoutLamports;
    });
}

function assertIdlInterface(idl: Idl): void {
  const idlRecord = idl as unknown as Record<string, unknown>;
  const accounts = array(idlRecord.accounts, "Anchor IDL accounts")
    .map((value) => record(value, "Anchor IDL account"));
  const instructions = array(idlRecord.instructions, "Anchor IDL instructions")
    .map((value) => record(value, "Anchor IDL instruction"));
  const accountNames = new Set(accounts.map(({ name }) => name));
  const instructionNames = new Set(instructions.map(({ name }) => name));
  for (const name of REQUIRED_ACCOUNTS) {
    if (!accountNames.has(name)) throw new Error(`checked-in Anchor IDL is missing ${name}`);
  }
  for (const name of REQUIRED_INSTRUCTIONS) {
    if (!instructionNames.has(name)) {
      throw new Error(`checked-in Anchor IDL is missing ${name}`);
    }
  }
}

function arcadeCadenceFromDeadline(
  dailyAddress: PublicKey,
  deadlineAt: number,
): { challengeDayId: number; deadlineDayId: number } {
  const challengeDayId = currentDayId(deadlineAt);
  if (deadlineAt !== dailyWindow(challengeDayId).runsCloseAt ||
      !dailyAddress.equals(arenaDailyPda(challengeDayId))) {
    throw new Error("arcade ActiveRun closed-Daily cadence is invalid");
  }
  return { challengeDayId, deadlineDayId: challengeDayId };
}


function instructionRecord(idl: Idl, name: string): {
  accounts: readonly unknown[];
} {
  const idlRecord = idl as unknown as Record<string, unknown>;
  const instruction = array(idlRecord.instructions, "Anchor IDL instructions")
    .map((value) => record(value, "Anchor IDL instruction"))
    .find((value) => value.name === name);
  if (!instruction) throw new Error(`Anchor IDL instruction ${name} is missing`);
  return { accounts: array(instruction.accounts, `${name} accounts`) };
}

function availableLedgerLamports(value: unknown, label: string): bigint {
  const ledger = record(value, `${label} ledger`);
  const funded = fundedLedgerLamports(ledger, label);
  const accountedOut = checkedU64Add(
    bigint(ledger.payoutLamports, `${label} payout lamports`),
    bigint(ledger.rolloverOutLamports, `${label} rollover out`),
    label,
  );
  if (accountedOut > funded) throw new Error(`${label} ledger is overdrawn`);
  return funded - accountedOut;
}

function fundedLedgerLamports(value: unknown, label: string): bigint {
  const ledger = record(value, `${label} ledger`);
  return checkedU64Add(
    checkedU64Add(
      bigint(ledger.seededLamports, `${label} seeded lamports`),
      bigint(ledger.entryLamports, `${label} entry lamports`),
      label,
    ),
    bigint(ledger.rolloverInLamports, `${label} rollover in`),
    label,
  );
}

function checkedU64Add(left: bigint, right: bigint, label: string): bigint {
  const value = left + right;
  if (value > 0xffff_ffff_ffff_ffffn) throw new Error(`${label} ledger overflows u64`);
  return value;
}

function periodStatus(value: unknown, label: string): PeriodStatus {
  const variant = enumVariant(value, label);
  if (variant !== "funding" && variant !== "open" && variant !== "finalized") {
    throw new Error(`${label} is invalid`);
  }
  return variant;
}


function runLifecycle(value: unknown, label: string): RunLifecycle {
  const variant = enumVariant(value, label);
  if (variant === "prepared" || variant === "delegated" || variant === "playing") {
    return variant;
  }
  if (variant === "awaitingVrf") return "awaiting_vrf";
  if (variant === "finished") return "terminal";
  throw new Error(`${label} is invalid`);
}

function enumVariant(value: unknown, label: string): string {
  const object = record(value, label);
  const keys = Object.keys(object);
  if (keys.length !== 1) throw new Error(`${label} is malformed`);
  return keys[0]!;
}

function safeBigintNumber(value: bigint, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} is outside safe integer range`);
  return number;
}

function littleEndianMask(bytes: Uint8Array): bigint {
  let mask = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    mask = (mask << 8n) | BigInt(bytes[index]!);
  }
  return mask;
}

function popcount(value: bigint): number {
  let count = 0;
  for (let remaining = value; remaining > 0n; remaining >>= 1n) {
    count += Number(remaining & 1n);
  }
  return count;
}

function requirePublicKey(
  value: Record<string, unknown>,
  field: string,
  expected: PublicKey,
  label: string,
): void {
  if (!publicKey(value[field], label).equals(expected)) {
    throw new Error(`${label} relationship is invalid`);
  }
}

function publicKey(value: unknown, label: string): PublicKey {
  if (value instanceof PublicKey) return value;
  if (typeof value === "string") {
    try {
      return new PublicKey(value);
    } catch {
      throw new Error(`${label} is not a Solana public key`);
    }
  }
  throw new Error(`${label} is not a Solana public key`);
}

function bigint(value: unknown, label: string): bigint {
  try {
    const parsed = typeof value === "bigint"
      ? value
      : typeof value === "number" && Number.isSafeInteger(value)
        ? BigInt(value)
        : isRecord(value) && typeof value.toString === "function"
          ? BigInt(String(value))
          : typeof value === "string"
            ? BigInt(value)
            : -1n;
    if (parsed < 0n || parsed > 0xffff_ffff_ffff_ffffn) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} is outside u64`);
  }
}

function signedTimestamp(value: unknown, label: string): number {
  let parsed: bigint;
  try {
    parsed = typeof value === "bigint" ? value : BigInt(String(value));
  } catch {
    throw new Error(`${label} is invalid`);
  }
  const number = Number(parsed);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} is invalid`);
  return number;
}


function u8(value: unknown, label: string): number {
  const parsed = safeInteger(value, label);
  if (parsed > 0xff) throw new Error(`${label} is outside u8`);
  return parsed;
}

function u32(value: unknown, label: string): number {
  const parsed = safeInteger(value, label);
  assertCadenceId(parsed, label);
  return parsed;
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} is invalid`);
  }
  return Number(value);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid`);
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is not an object`);
  return value;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`);
  return value;
}

function bytes32Hex(value: unknown, label: string): string {
  return Buffer.from(bytes32(value, label)).toString("hex");
}

function bytes32(value: unknown, label: string): Uint8Array {
  const bytes = value instanceof Uint8Array
    ? value
    : Array.isArray(value) && value.length === 32 &&
        value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ? Uint8Array.from(value as number[])
      : undefined;
  if (!bytes || bytes.length !== 32) throw new Error(`${label} is not 32 bytes`);
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function range(first: number, lastInclusive: number): number[] {
  assertCadenceId(first, "cadence range start");
  assertCadenceId(lastInclusive, "cadence range end");
  if (lastInclusive < first || lastInclusive - first >= MAX_CADENCE_PERIODS) {
    throw new Error("cadence discovery range is invalid or unbounded");
  }
  return Array.from({ length: lastInclusive - first + 1 }, (_, index) => first + index);
}

function requiredOwner(value: PublicKey | undefined): PublicKey {
  if (!value) throw new Error("IDL materializer is missing run/player owner");
  return value;
}

function requireRentRecipient(value: PublicKey | undefined): PublicKey {
  if (!value || value.equals(PublicKey.default)) {
    throw new Error("IDL materializer requires the persisted rent recipient");
  }
  return value;
}

function requiredRunId(value: bigint | undefined): bigint {
  if (value === undefined || value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error("IDL materializer is missing a valid run id");
  }
  return value;
}

function requiredNumber(value: number | undefined, label: string): number {
  if (value === undefined) throw new Error(`IDL materializer is missing ${label}`);
  assertCadenceId(value, label);
  return value;
}


function dailyBoardKind(
  value: KeeperPlanContext["boardKind"],
): Record<string, Record<string, never>> {
  if (value !== "score" && value !== "theme") {
    throw new Error("IDL materializer is missing Daily board kind");
  }
  return { [value]: {} };
}

function requiredBoardKind(
  value: KeeperPlanContext["boardKind"],
): "score" | "theme" {
  if (value !== "score" && value !== "theme") {
    throw new Error("IDL materializer is missing Daily board kind");
  }
  return value;
}

function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)]! + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || "1";
}
