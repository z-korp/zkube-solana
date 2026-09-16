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
} from "@solana/web3.js";

import {
  KEEPER_PLAN_INSTRUCTION,
  KEEPER_RECENT_DAILY_CADENCES,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  PLAYER_STATE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION,
  ZKUBE_PROGRAM_ID,
  activeRunPda,
  arenaDailyPda,
  arenaBoardPda,
  arenaPlayerPda,
  assertCadenceId,
  currentDayId,
  cadenceFundingPda,
  playerStatePda,
  protocolPda,
  type KeeperOperation,
  type KeeperPlanContext,
} from "./arcadeChain.js";
import { dailyWindow, scheduledDailyWindow, compareBoardEntries } from "./zkubeCore.js";
import {
  type DailySnapshot,
  type PeriodStatus,
  type ProtocolSnapshot,
  type RunLifecycle,
  type RunSnapshot,
  type ArcadeRootSnapshot,
  type ClosedArenaPlayerSnapshot,
  type CadenceArchiveCandidate,
  type BoardSourceSnapshot,
  type BoardConstructionSnapshot,
} from "./arcadeReconciliation.js";
import { type ProtocolInstructionMaterializer } from "./arcadeChain.js";
import { getDelegationStatus } from "./router.js";

const MAX_PROGRAM_ACCOUNT_BYTES = 129_538;
const MAX_DISCOVERED_PLAYER_STATES = 10_000;
const MAX_DISCOVERED_ARENA_PLAYERS = 100_000;
const MAX_RPC_ACCOUNT_BATCH = 100;
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
}

interface PlayerStateRecord {
  address: PublicKey;
  owner: PublicKey;
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
  launchDayId: number;
}

export type KeeperLaunchState = "staged_launch_ready" | "active";

/** Exact checked-in Anchor IDL decoder and instruction materializer. */
export class AnchorKeeperAdapter implements ProtocolInstructionMaterializer {
  private readonly accountsCoder: BorshAccountsCoder;
  private readonly instructionCoder: BorshInstructionCoder;

  private constructor(
    private readonly input: AnchorKeeperAdapterInput,
    private readonly idl: Idl,
  ) {
    this.accountsCoder = new BorshAccountsCoder(idl);
    this.instructionCoder = new BorshInstructionCoder(idl);

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
    );
  }

  async loadProtocolSnapshot(): Promise<ProtocolSnapshot> {
    const protocol = await this.loadRequired(
      "protocolConfig",
      protocolPda(),
      PROTOCOL_ACCOUNT_VERSION,
    );
    const launchDayId = u32(protocol.value.launchDayId, "launch day id");
    this.requireReleaseLaunchDay(launchDayId);
    const suspendedUntilDay = u32(
      protocol.value.suspendedUntilDay,
      "suspended-until day",
    );
    const paused = boolean(protocol.value.paused, "protocol pause state");
    const archiveRoot = { lastDailyId: u32(protocol.value.lastDailyId, "last Daily id") };

    const today = currentDayId(this.input.nowUnix);
    const firstDay = Math.max(launchDayId, today - KEEPER_RECENT_DAILY_CADENCES);
    const dailyIds = [...new Set([...range(firstDay, today), ...Object.values(scheduledDailyWindow(today, suspendedUntilDay))])];
    const dailies = await this.loadDailies(dailyIds, launchDayId);
    const playerStates = await this.loadPlayerStates();
    const runs = await this.loadRuns(playerStates, dailies);
    const { sources: boardSources, closed: closedArenaPlayers } = await this.loadBoardSources(dailies);
    for (const daily of dailies) {
      const sources = boardSources.get(daily.snapshot.dayId) ?? {
        score: [],
        theme: [],
      };
      daily.snapshot.scoreSources = sources.score;
      daily.snapshot.themeSources = sources.theme;

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

    if (u32(protocol.value.launchDayId, "launch day id") > 0) {
      this.requireReleaseLaunchDay(u32(protocol.value.launchDayId, "launch day id"));
      return "active";
    }
    if (!boolean(protocol.value.paused, "protocol pause state") ||
        u32(protocol.value.launchDayId, "launch day id") !== 0) {
      throw new Error("paused launch carrier is incomplete or active");
    }

    await this.loadStagedLaunchPeriods(this.input.launchDayId);
    return "staged_launch_ready";
  }

  private requireReleaseLaunchDay(launchDayId: number): void {
    if (launchDayId !== this.input.launchDayId) {
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
      this.requireUnfundedPeriod(daily.value, "ArenaDaily");
    }
  }

  private requireUnfundedPeriod(
    value: Record<string, unknown>,
    label: string,
  ): void {
    if (periodStatus(value.status, `${label} status`) !== "funding" ||
        boolean(value.predecessorRolloverApplied, `${label} predecessor flag`) ||
        array(Object.values(record(value.ledger, label)), label).reduce<bigint>((sum, value) => sum + bigint(value, label), 0n) !== 0n) {
      throw new Error(`${label} staged funding state is invalid`);
    }
  }

  async materialize(input: {
    operation: KeeperOperation; context: KeeperPlanContext; keeper: PublicKey;
  }): Promise<readonly TransactionInstruction[]> {
    const definition = KEEPER_PLAN_INSTRUCTION[input.operation];
    if (!definition) throw new Error("keeper materializer operation is outside the exact allowlist");
    const name = definition.instruction.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const { context: c, keeper } = input;
    const daily = () => arenaDailyPda(requiredNumber(c.dayId, "day id"));
    const following = () => arenaDailyPda(requiredNumber(c.followingDayId, "following day id"));
    const owner = () => requiredOwner(c.owner);
    const activeRun = () => activeRunPda(owner(), requiredRunId(c.runId));
    const boards = () => ({ arenaDaily: daily(), scoreBoard: arenaBoardPda(daily(), "score"),
      themeBoard: arenaBoardPda(daily(), "theme") });
    const cadenceFunding = cadenceFundingPda(), protocol = protocolPda(), systemProgram = SystemProgram.programId;
    let accounts: Record<string, PublicKey>;
    let args: Record<string, unknown> = {};
    let remaining: RemainingAccountMeta[] = [];
    switch (input.operation) {
      case "prepare_arena_daily":
        accounts = { caller: keeper, protocol, arenaDaily: following(), cadenceFunding, systemProgram };
        args = { dayId: c.followingDayId };
        break;
      case "activate_arena_daily":
        accounts = { caller: keeper, protocol, arenaDaily: daily() };
        break;
      case "skip_suspended_arena_daily":
        accounts = { caller: keeper, protocol, suspendedDaily: daily(), successorDaily: following(), cadenceFunding };
        break;
      case "finish_run":
        accounts = { actor: keeper, activeRun: activeRun(), ownerAuthority: owner(), sessionToken: ZKUBE_PROGRAM_ID };
        args = { reason: { deadline: {} } };
        break;
      case "commit_run":
        accounts = { payer: keeper, activeRun: activeRun(), systemProgram };
        break;
      case "consume_arena_run":
        accounts = { playerState: playerStatePda(owner()), activeRun: activeRun(),
          arenaDaily: c.includeArenaPlayer ? daily() : ZKUBE_PROGRAM_ID,
          arenaPlayer: c.includeArenaPlayer ? arenaPlayerPda(daily(), owner()) : ZKUBE_PROGRAM_ID,
          rentRecipient: requireRentRecipient(c.rentRecipient) };
        break;
      case "expire_unresolved_arena_run":
        accounts = { caller: keeper, playerState: playerStatePda(owner()), arenaDaily: daily(),
          arenaPlayer: arenaPlayerPda(daily(), owner()), owner: owner(), systemProgram };
        break;
      case "finalize_arena_daily":
        accounts = { caller: keeper, ...boards(), followingDaily: following(), cadenceFunding, systemProgram };
        break;
      case "submit_arena_board_chunk": {
        const kind = requiredBoardKind(c.boardKind);
        if (!c.boardEntries) throw new Error("board chunk entries are missing");
        accounts = { caller: keeper, arenaDaily: daily(), arenaBoard: arenaBoardPda(daily(), kind) };
        args = { kind: { [kind]: {} }, entries: c.boardEntries.map(entry => ({ score: entry.score,
          objectiveTotal: new BN(entry.objectiveTotal.toString()), finalizedAt: new BN(entry.finalizedAt),
          replayHash: [...entry.replayHash] })) };
        remaining = c.boardEntries.map(entry => ({ pubkey: entry.source, isWritable: false }));
        break;
      }
      case "expire_daily_claims":
        accounts = { caller: keeper, protocol, ...boards(), followingDaily: following() };
        break;
      case "archive_arena_daily":
        accounts = { caller: keeper, protocol, ...boards() };
        break;
      case "close_arena_daily":
        accounts = { caller: keeper, protocol, ...boards(), cadenceFunding };
        break;
      case "close_arena_player":
        accounts = { caller: keeper, arenaDaily: daily(), arenaPlayer: arenaPlayerPda(daily(), owner()),
          rentRecipient: requireRentRecipient(c.rentRecipient) };
        break;
      default:
        throw new Error("keeper materializer operation is outside the exact allowlist");
    }
    return [this.buildInstruction(name, args, accounts, remaining)];
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
      const status = periodStatus(item.value.status, "ArenaDaily status");
      const finalizedAt = signedTimestamp(
        item.value.finalizedAt,
        "ArenaDaily finalization",
      );
      const claimsExpired = boolean(item.value.claimsExpired, "ArenaDaily claim expiry");
      const scoreBoard = status === "finalized" ? await this.loadArenaBoard(item.address, "score") : undefined;
      const themeBoard = status === "finalized" ? await this.loadArenaBoard(item.address, "theme") : undefined;
      const snapshot: DailySnapshot = {
        dayId,
        status,
        finalizedAt,
        runsCloseAt,
        recoveryDeadlineAt,
        entriesPaid: bigint(item.value.entriesPaid, "ArenaDaily paid entries"),
        entriesScored: bigint(item.value.entriesScored, "ArenaDaily scored entries"),
        entriesExpired: bigint(item.value.entriesExpired, "ArenaDaily expired entries"),
        predecessorRolloverRequired: dayId !== launchDayId,
        predecessorRolloverApplied: boolean(
          item.value.predecessorRolloverApplied,
          "ArenaDaily predecessor flag",
        ),
        claimsExpired,
        ...(scoreBoard ? {
          scoreBoard: scoreBoard.construction,
        } : {}),
        ...(themeBoard ? {
          themeBoard: themeBoard.construction,
        } : {}),
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

  private async loadArenaBoard(daily: PublicKey, kind: "score" | "theme"): Promise<LoadedBoardSnapshot> {
    const loaded = await this.loadRequired("arenaBoard", arenaBoardPda(daily, kind), PROTOCOL_ACCOUNT_VERSION);
    const cursor = u32(loaded.value.cursor, "ArenaBoard cursor");
    const payoutCount = u32(loaded.value.payoutCount, "ArenaBoard payout count");
    const sealedAt = signedTimestamp(loaded.value.sealedAt, "ArenaBoard sealing time");
    return { loaded, construction: { kind, cursor, payoutCount, sealed: sealedAt > 0, sealedAt } };
  }

  private async loadBoardSources(
    dailies: readonly LoadedDaily[],
  ): Promise<{ sources: Map<number, { score: BoardSourceSnapshot[]; theme: BoardSourceSnapshot[] }>;
    closed: ClosedArenaPlayerSnapshot[] }> {
    const closed: ClosedArenaPlayerSnapshot[] = [];
    const boardSources = new Map<number, {
      score: BoardSourceSnapshot[];
      theme: BoardSourceSnapshot[];
    }>();
    const today = currentDayId(this.input.nowUnix);
    const firstDay = Math.max(this.input.launchDayId, today - KEEPER_RECENT_DAILY_CADENCES);
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
      MAX_DISCOVERED_ARENA_PLAYERS,
    );
    for (const player of discovered) {
      const challenge = publicKey(player.value.challenge, "ArenaPlayer challenge");
      const owner = publicKey(player.value.player, "ArenaPlayer owner");
      const dayId = dayByAddress.get(challenge.toBase58());
      if (dayId === undefined) continue;
      if (!liveDaily.has(dayId)) {
        const rentPayer = publicKey(player.value.rentPayer, "ArenaPlayer rent payer");
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
      return {
        address: loaded.address,
        owner,
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
          ));
        } catch (error) {
          if (this.input.nowUnix <
              dailyWindow(currentDayId(player.activeRunDeadlineAt)).recoveryDeadlineAt) {
            throw error;
          }
          const daily = dailyByAddress.get(player.activeRunDaily.toBase58());
          const cadence = daily
            ? { dayId: daily.dayId }
            : arcadeCadenceFromDeadline(
              player.activeRunDeadlineAt,
            );
          const arenaPlayerExists = await this.loadArenaPlayerExists(
            player.activeRunDaily,
            player.owner,
          );
          output.push({
            owner: player.owner,
            runId: player.activeRunId,
            dayId: cadence.dayId,

            arenaPlayerExists,
            lifecycle: "unavailable",
            location: "unavailable",

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
      if (!status.fqdn) {
        throw new Error("ActiveRun delegation location is missing");
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
    );
    const owner = publicKey(loaded.value.owner, "ActiveRun owner");
    const rentPayer = publicKey(loaded.value.rentPayer, "ActiveRun rent payer");
    const deadlineAt = signedTimestamp(loaded.value.deadlineAt, "ActiveRun deadline");
    const dailyAddress = publicKey(loaded.value.dailyChallenge, "ActiveRun Daily");
    const daily = dailyByAddress.get(dailyAddress.toBase58());
    const cadence = daily
      ? { dayId: daily.dayId }
      : arcadeCadenceFromDeadline(deadlineAt);
    const arenaPlayerExists = await this.loadArenaPlayerExists(dailyAddress, owner);
    return {
      owner,
      rentPayer,
      runId,
      dayId: cadence.dayId,

      arenaPlayerExists,
      lifecycle: runLifecycle(loaded.value.lifecycle, "ActiveRun lifecycle"),
      location,

      runsCloseAt: deadlineAt,
      recoveryDeadlineAt: dailyWindow(currentDayId(deadlineAt)).recoveryDeadlineAt,
      reservationActive,
    };
  }

  private async loadArenaPlayerExists(daily: PublicKey, owner: PublicKey): Promise<boolean> {
    const address = arenaPlayerPda(daily, owner);
    const info = await this.input.connection.getAccountInfo(address, "confirmed");
    if (!info) return false;
    this.decodeAccount(
      "arenaPlayer",
      address,
      info,
      PROTOCOL_ACCOUNT_VERSION,
    );
    return true;
  }

  private async loadRequired(
    name: string,
    address: PublicKey,
    version: number | readonly number[],
  ): Promise<LoadedAccount> {
    const info = await this.input.connection.getAccountInfo(address, "confirmed");
    if (!info) throw new Error(`${name} account is missing`);
    return this.decodeAccount(name, address, info, version);
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
        ? [this.decodeAccount(name, item.address, info, version)]
        : [];
    });
  }

  private async scanAccounts(
    name: string,
    version: number | readonly number[],
    maximum: number,
  ): Promise<LoadedAccount[]> {
    const discriminator = this.accountsCoder.accountDiscriminator(name);
    const accounts = await this.input.connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { memcmp: { offset: 0, bytes: base58(discriminator) } },
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
  ): LoadedAccount {
    if (!info.owner.equals(ZKUBE_PROGRAM_ID) || info.executable ||
        info.data.length < 9 || info.data.length >= MAX_PROGRAM_ACCOUNT_BYTES ||
        !info.data.subarray(0, 8).equals(this.accountsCoder.accountDiscriminator(name)) ||
        !(Array.isArray(version)
          ? version.includes(info.data[8]!)
          : info.data[8] === version)) {
      throw new Error(`${name} owner, size, discriminator or version is invalid`);
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

function arcadeCadenceFromDeadline(
  deadlineAt: number,
): { dayId: number } {
  return { dayId: currentDayId(deadlineAt) };
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
  if (lastInclusive < first || lastInclusive - first > KEEPER_RECENT_DAILY_CADENCES) {
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
