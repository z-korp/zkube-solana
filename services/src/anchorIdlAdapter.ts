import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  BorshAccountsCoder,
  BorshInstructionCoder,
  convertIdlToCamelCase,
  type Idl,
  type IdlTypeDef,
} from "@anchor-lang/core";
import { IdlCoder } from "@anchor-lang/core/dist/cjs/coder/borsh/idl.js";
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
  ARCADE_ACCOUNT_VERSION,
  ARENA_BOARD_CAPACITY,
  ARENA_BOARD_ENTRY_SIZE,
  ARENA_ENTRY_LAMPORTS,
  DAILY_ENTRY_CLOSE_OFFSET,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  DAILY_POOL_SELECTION_SEED,
  DAILY_RUN_CLOSE_OFFSET,
  ENTRY_SPLIT_LAMPORTS,
  KEEPER_RECENT_DAILY_CADENCES,
  PLAYER_STATE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION,
  RULES_ACCOUNT_VERSION,
  RUN_RECOVERY_SECONDS,
  SECONDS_PER_DAY,
  ZKUBE_PROGRAM_ID,
  activeRunPda,
  arcadeArchivePda,
  arcadeConfigPda,
  arenaDailyPda,
  arenaBoardPda,
  arenaPlayerPda,
  assertCadenceId,
  currentDayId,
  cadenceFundingPda,
  mapCatalogPda,
  nextScheduledDaily,
  playerFundingPda,
  playerStatePda,
  protocolPda,
  rulesCatalogPda,
  type KeeperOperation,
  type KeeperPlanContext,
} from "./arcadeChain.js";
import { dailyBoardPools, rankWeightedPayoutPlan } from "./arcadeEconomy.js";
import {
  type DailySnapshot,
  type ArenaPlayerClosureSnapshot,
  type PeriodStatus,
  type ProtocolSnapshot,
  type RunLifecycle,
  type RunSnapshot,
  type ArcadeArchiveSnapshot,
  type CadenceArchiveCandidate,
  type SettlementSnapshot,
  type BoardSourceSnapshot,
  type BoardConstructionSnapshot,
} from "./arcadeReconciliation.js";
import {
  cadenceRoot,
  cadenceResultHash,
  canonicalArchiveV3,
} from "./archiveContract.js";
import { type ProtocolInstructionMaterializer } from "./planMaterializer.js";
import { getDelegationStatus } from "./router.js";

const ARENA_BOARD_HEADER_BYTES = 121;
const MAX_PROGRAM_ACCOUNT_BYTES = 129_530;
// Anchor 1.0.2's public type encoder hardcodes a 1,000-byte scratch buffer.
// Build the same pinned IDL layout directly so production-sized cadence
// results remain byte-identical while the keeper owns an explicit hard bound.
export const MAX_CADENCE_RESULT_BYTES = 300_000;
const MAX_CADENCE_PERIODS = 10_000;
const MAX_DISCOVERED_PLAYER_STATES = 10_000;
const MAX_ARENA_PLAYERS_PER_DAILY = 100_000;
const MAX_RPC_ACCOUNT_BATCH = 100;
const MIN_SUPPORTED_DAY_ID = 4;
export const KEEPER_EXPECTED_IDL_SHA256 =
  "c0d8777218bc5f5b541d1beb461a73058a6991937ea06c29630d3230521bfdfb";
const REQUIRED_ACCOUNTS = [
  "activeRun",
  "arcadeConfig",
  "arenaDaily",
  "arenaBoard",
  "arenaPlayer",
  "dailyRulesCatalog",
  "mapCatalog",
  "playerState",
  "protocolConfig",
] as const;
const REQUIRED_INSTRUCTIONS = [
  "activateArenaDaily",
  "forceFinishDeadline",
  "commitRun",
  "consumeCampaignRun",
  "consumeArenaRun",
  "expireUnresolvedArenaRun",
  "cleanupOrphanActiveRun",
  "fundedFinalizeArenaDaily",
  "submitArenaBoardChunk",
  "expireDailyClaims",
  "syncDailyProfile",
  "closeArenaPlayer",
] as const;
const REQUIRED_INSTRUCTION_ALTERNATIVES = [
  ["fundedPrepareArenaDaily", "prepareArenaDaily"],
] as const;

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
  profileSyncMask: bigint;
}

interface PlayerStateRecord {
  address: PublicKey;
  owner: PublicKey;
  nextRunId: bigint;
  activeRunId: bigint;
  campaignActiveRunId: bigint;
  activeRunDaily: PublicKey;
  activeRunMode: "campaign" | "ranked";
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
  replayDomainHex: string;
  rulesCatalogHash: string;
  rulesVersion: number;
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
      new URL("../../client/src/chain/idl/solana.json", import.meta.url);
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
      ARCADE_ACCOUNT_VERSION,
    );
    this.requireReleaseProtocol(protocol.value);
    requirePublicKey(config.value, "protocol", protocol.address, "ArcadeConfig protocol");
    requireBigInt(config.value, "entryLamports", ARENA_ENTRY_LAMPORTS, "entry price");
    requireBigInt(
      config.value,
      "dailyLamports",
      ENTRY_SPLIT_LAMPORTS.followingDaily,
      "Daily split",
    );
    requireBigInt(
      config.value,
      "operatorLamports",
      ENTRY_SPLIT_LAMPORTS.operator,
      "operator split",
    );
    if (!boolean(config.value.launchSeeded, "ArcadeConfig launch flag")) {
      throw new Error("keeper rejects an unseeded Arcade launch");
    }
    const launchDayId = u32(config.value.launchDayId, "launch day id");
    if (launchDayId < MIN_SUPPORTED_DAY_ID ||
        launchDayId > currentDayId(this.input.nowUnix)) {
      throw new Error("keeper rejects invalid launch cadence");
    }
    this.requireReleaseLaunchDay(launchDayId);
    const rulesVersion = u32(protocol.value.dailyRulesVersion, "active rules version");
    if (rulesVersion === 0) throw new Error("keeper rejects an inactive rules catalog");
    const rulesCatalog = rulesCatalogPda(rulesVersion);
    requirePublicKey(config.value, "rulesCatalog", rulesCatalog, "ArcadeConfig rules catalog");
    const catalog = await this.loadRequired(
      "dailyRulesCatalog",
      rulesCatalog,
      RULES_ACCOUNT_VERSION,
    );
    this.requireReleaseCatalog(catalog.value, rulesVersion);
    const contentVersion = u32(catalog.value.contentVersion, "rules content version");
    const selectionSeed = bytes32(catalog.value.selectionSeed, "rules selection seed");
    if (selectionSeed.some((byte, index) =>
      byte !== DAILY_POOL_SELECTION_SEED[index])) {
      throw new Error("keeper rejects a publisher-chosen Daily selection seed");
    }
    const catalogStartsDay = u32(catalog.value.startsDay, "rules start day");
    const poolEntryCount = u8(catalog.value.poolEntryCount, "rules pool entry count");
    const poolEntries = array(catalog.value.poolEntries, "rules pool entries")
      .slice(0, poolEntryCount)
      .map((value, index) => {
        const entry = record(value, `rules pool entry ${index}`);
        return {
          realmMapId: u8(entry.realmMapId, `rules pool entry ${index} realm`),
          passiveMapId: u8(entry.passiveMapId, `rules pool entry ${index} passive`),
        };
      });
    requirePublicKey(catalog.value, "protocol", protocol.address, "rules catalog protocol");
    if (u32(catalog.value.rulesVersion, "rules catalog version") !== rulesVersion) {
      throw new Error("rules catalog version relationship is invalid");
    }
    const paused = boolean(protocol.value.paused, "protocol pause state");
    const archiveCheckpoint = await this.loadArchiveCheckpoint();

    const today = currentDayId(this.input.nowUnix);
    const firstDay = launchDayId;
    const lastDay = poolEntryCount === 0
      ? today
      : nextScheduledDaily(today, catalogStartsDay, poolEntryCount);
    const dailyIds = range(firstDay, lastDay);
    const dailies = await this.loadDailies(dailyIds, launchDayId);
    const launchDailyPresent =
      dailies.some(({ snapshot }) => snapshot.dayId === launchDayId) ||
      (archiveCheckpoint?.lastDailyId ?? -1) >= launchDayId;
    if (!launchDailyPresent) {
      throw new Error("seeded Arcade launch cadence is incomplete");
    }
    const playerStates = await this.loadPlayerStates();
    const runs = await this.loadRuns(playerStates, dailies);
    const participantClosures = await this.loadParticipantClosures(
      dailies,
      archiveCheckpoint,
    );
    for (const daily of dailies) {
      const sources = participantClosures.boardSources.get(daily.snapshot.dayId) ?? {
        score: [],
        theme: [],
      };
      daily.snapshot.scoreSources = sources.score;
      daily.snapshot.themeSources = sources.theme;
      const sourceSettlement = this.rankedSettlement(
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
    const archive = await this.loadArchiveSnapshot(
      dailies,
      participantClosures.arenaCadenceBlockers,
    );
    return {
      paused,
      launchDayId,
      rulesCatalog,
      contentVersion,
      selectionSeed,
      catalogStartsDay,
      poolEntries,
      dailies: dailies.map(({ snapshot }) => snapshot),
      runs,
      playerStateOwners: playerStates.map(({ owner }) => owner),
      arenaPlayerClosures: participantClosures.arenaPlayers,
      ...(archive ? {
        archiveState: archive.state,
        archiveCandidates: archive.candidates,
      } : {}),
    };
  }

  private async loadArchiveCheckpoint(): Promise<ArcadeArchiveSnapshot | undefined> {
    if (!this.idlHasAccount("arcadeArchive") ||
        !this.idlHasInstruction("archiveArenaDaily")) {
      return undefined;
    }
    const archive = await this.loadRequired(
      "arcadeArchive",
      arcadeArchivePda(),
      ARCADE_ACCOUNT_VERSION,
    );
    requirePublicKey(
      archive.value,
      "arcadeConfig",
      arcadeConfigPda(),
      "ArcadeArchive ArcadeConfig",
    );
    const release = this.requiredRelease();
    const firstDailyId = u32(archive.value.firstDailyId,
      "ArcadeArchive first Daily id");
    if (firstDailyId !== release.launchDayId) {
      throw new Error("ArcadeArchive first cadence identities are invalid");
    }
    const lastDailyId = u32(archive.value.lastDailyId,
      "ArcadeArchive last Daily id");
    const dailyRoot = bytes32Hex(archive.value.dailyRoot,
      "ArcadeArchive Daily root");
    const today = currentDayId(this.input.nowUnix);
    if (lastDailyId < firstDailyId - 1 ||
        lastDailyId > today ||
        (lastDailyId === firstDailyId - 1) !== /^0{64}$/.test(dailyRoot)) {
      throw new Error("ArcadeArchive checkpoint or root is invalid");
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
      address: archive.address,
      cadenceFunding: fundingAddress,
      firstDailyId,
      lastDailyId,
      dailyRoot,
    };
  }

  private async loadArchiveSnapshot(
    dailies: readonly LoadedDaily[],
    arenaCadenceBlockers: ReadonlySet<number>,
  ): Promise<{
    state: ArcadeArchiveSnapshot;
    candidates: CadenceArchiveCandidate[];
  } | undefined> {
    if (!this.idlHasAccount("arcadeArchive") ||
        !this.idlHasInstruction("archiveArenaDaily")) {
      return undefined;
    }
    const loadedArchive = await this.loadRequired(
      "arcadeArchive",
      arcadeArchivePda(),
      ARCADE_ACCOUNT_VERSION,
    );
    requirePublicKey(
      loadedArchive.value,
      "arcadeConfig",
      arcadeConfigPda(),
      "ArcadeArchive ArcadeConfig",
    );
    const firstDailyId = u32(loadedArchive.value.firstDailyId,
      "ArcadeArchive first Daily id");
    const release = this.requiredRelease();
    if (firstDailyId !== release.launchDayId) {
      throw new Error("ArcadeArchive first cadence identities are invalid");
    }
    const lastDailyId = u32(loadedArchive.value.lastDailyId,
      "ArcadeArchive last Daily id");
    if (lastDailyId < firstDailyId - 1) {
      throw new Error("ArcadeArchive sequence is invalid");
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
    const dailyRoot = bytes32Hex(loadedArchive.value.dailyRoot,
      "ArcadeArchive Daily root");
    const today = currentDayId(this.input.nowUnix);
    if (lastDailyId > today ||
        (lastDailyId === firstDailyId - 1) !== /^0{64}$/.test(dailyRoot)) {
      throw new Error("ArcadeArchive checkpoint or root is invalid");
    }
    const state: ArcadeArchiveSnapshot = {
      address: loadedArchive.address,
      cadenceFunding: fundingAddress,
      firstDailyId,
      lastDailyId,
      dailyRoot,
    };
    const candidates: CadenceArchiveCandidate[] = [];
    for (const daily of dailies) {
      if (daily.snapshot.status !== "finalized") continue;
      if (!daily.snapshot.scoreBoard?.sealed || !daily.snapshot.themeBoard?.sealed ||
          !daily.scoreBoard || !daily.themeBoard) continue;
      candidates.push(this.archiveCandidate({
        competition: "daily",
        cadenceId: daily.snapshot.dayId,
        loaded: daily.loaded,
        scoreBoard: daily.scoreBoard,
        themeBoard: daily.themeBoard,
        period: daily.snapshot,
        lastCadenceId: lastDailyId,
        currentRoot: dailyRoot,
        participantAccountsRemain:
          arenaCadenceBlockers.has(daily.snapshot.dayId),
      }));
    }
    return { state, candidates };
  }

  private archiveCandidate(input: {
    competition: "daily";
    cadenceId: number;
    loaded: LoadedAccount;
    scoreBoard: LoadedAccount;
    themeBoard: LoadedAccount;
    period: DailySnapshot;
    lastCadenceId: number;
    currentRoot: string;
    participantAccountsRemain: boolean;
  }): CadenceArchiveCandidate {
    const resultData = canonicalCadenceResultData(
      this.idl,
      input.competition,
      input.loaded.value,
      {
        score: {
          value: input.scoreBoard.value,
          data: input.scoreBoard.account.data,
        },
        theme: {
          value: input.themeBoard.value,
          data: input.themeBoard.account.data,
        },
      },
    );
    const resultHash = cadenceResultHash(input.competition, resultData);
    const committed = input.cadenceId <= input.lastCadenceId;
    const root = committed
      ? undefined
      : cadenceRoot(
        input.competition,
        input.currentRoot,
        input.cadenceId,
        resultHash,
      );
    const requiredScoreProfileSyncMask = profileSyncMask(input.period, "score");
    const requiredThemeProfileSyncMask = profileSyncMask(input.period, "theme");
    const closeEligibleAt = input.period.finalizedAt +
      DAILY_REWARD_CLAIM_WINDOW_SECONDS;
    const canonicalJson = root === undefined
      ? undefined
      : canonicalArchiveV3({
        account: input.loaded.address,
        accountData: input.loaded.account.data,
        scoreBoard: input.scoreBoard.address,
        scoreBoardData: input.scoreBoard.account.data,
        themeBoard: input.themeBoard.address,
        themeBoardData: input.themeBoard.account.data,
        competition: input.competition,
        periodId: input.cadenceId,
        programId: ZKUBE_PROGRAM_ID,
        resultData,
        root,
      });
    return {
      competition: input.competition,
      cadenceId: input.cadenceId,
      ...(canonicalJson === undefined ? {} : {
        canonicalJson,
        fileSha256: createHash("sha256")
          .update(Buffer.from(canonicalJson, "utf8"))
          .digest("hex"),
      }),
      resultHash,
      requiredScoreProfileSyncMask,
      requiredThemeProfileSyncMask,
      claimsExpired: input.period.claimsExpired,
      committed,
      closeEligible:
        committed &&
        input.period.claimsExpired &&
        this.input.nowUnix >= closeEligibleAt &&
        input.period.scoreProfileSyncMask === requiredScoreProfileSyncMask &&
        input.period.themeProfileSyncMask === requiredThemeProfileSyncMask &&
        !input.participantAccountsRemain,
      closeEligibleAt,
    };
  }

  projectArchiveResultData(
    competition: "daily",
    accountData: Buffer,
    scoreBoardData?: Buffer,
    themeBoardData?: Buffer,
  ): Buffer {
    const name = "arenaDaily";
    if (accountData.length < 9 || accountData.length >= MAX_PROGRAM_ACCOUNT_BYTES ||
        !accountData.subarray(0, 8).equals(
          this.accountsCoder.accountDiscriminator(name),
        ) ||
        accountData[8] !== ARCADE_ACCOUNT_VERSION) {
      throw new Error("archived cadence account discriminator or version is invalid");
    }
    let decoded: unknown;
    try {
      decoded = this.accountsCoder.decode(name, accountData);
    } catch {
      throw new Error("archived cadence account data is malformed");
    }
    if (!scoreBoardData || !themeBoardData) {
      throw new Error("archived cadence board evidence is missing");
    }
    const decodeBoard = (data: Buffer, kind: "score" | "theme") => {
      if (data.length < ARENA_BOARD_HEADER_BYTES ||
          data.length >= MAX_PROGRAM_ACCOUNT_BYTES ||
          !data.subarray(0, 8).equals(
            this.accountsCoder.accountDiscriminator("arenaBoard"),
          ) || data[8] !== ARCADE_ACCOUNT_VERSION) {
        throw new Error(`archived ${kind} board discriminator or version is invalid`);
      }
      try {
        return record(this.accountsCoder.decode("arenaBoard", data), `${kind} board`);
      } catch {
        throw new Error(`archived ${kind} board data is malformed`);
      }
    };
    return canonicalCadenceResultData(
      this.idl,
      competition,
      record(decoded, name),
      {
        score: { value: decodeBoard(scoreBoardData, "score"), data: scoreBoardData },
        theme: { value: decodeBoard(themeBoardData, "theme"), data: themeBoardData },
      },
    );
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
      ARCADE_ACCOUNT_VERSION,
    );
    this.requireReleaseProtocol(protocol.value);
    requirePublicKey(config.value, "protocol", protocol.address, "ArcadeConfig protocol");
    const release = this.requiredRelease();
    const rulesCatalog = rulesCatalogPda(release.rulesVersion);
    requirePublicKey(config.value, "rulesCatalog", rulesCatalog, "ArcadeConfig rules catalog");
    const catalog = await this.loadRequired(
      "dailyRulesCatalog",
      rulesCatalog,
      RULES_ACCOUNT_VERSION,
    );
    requirePublicKey(catalog.value, "protocol", protocol.address, "rules catalog protocol");
    this.requireReleaseCatalog(catalog.value, release.rulesVersion);

    if (boolean(config.value.launchSeeded, "ArcadeConfig launch flag")) {
      this.requireReleaseLaunchDay(u32(config.value.launchDayId, "launch day id"));
      return "active";
    }
    if (!boolean(protocol.value.paused, "protocol pause state") ||
        u32(config.value.launchDayId, "launch day id") !== 0 ||
        u32(protocol.value.contentVersion, "protocol content version") !== 2 ||
        u32(protocol.value.dailyRulesVersion, "protocol rules version") !==
          release.rulesVersion ||
        u8(protocol.value.campaignMapCount, "Campaign map count") !== 10) {
      throw new Error("paused launch carrier is incomplete or active");
    }

    await this.loadCanonicalCampaignMaps();
    await this.loadStagedLaunchPeriods(release.launchDayId);
    return "staged_launch_ready";
  }

  private requiredRelease(): KeeperReleaseExpectation {
    const release = this.input.release;
    if (!release || !/^[0-9a-f]{64}$/.test(release.replayDomainHex) ||
        !/^[0-9a-f]{64}$/.test(release.rulesCatalogHash) ||
        !Number.isSafeInteger(release.rulesVersion) || release.rulesVersion < 1 ||
        !Number.isSafeInteger(release.launchDayId) ||
        release.launchDayId < MIN_SUPPORTED_DAY_ID) {
      throw new Error("keeper release expectation is missing or malformed");
    }
    return release;
  }

  private requireReleaseProtocol(value: Record<string, unknown>): void {
    if (bytes32Hex(value.replayDomain, "protocol replay domain") !==
        this.requiredRelease().replayDomainHex) {
      throw new Error("protocol replay domain does not match keeper release");
    }
  }

  private requireReleaseCatalog(
    value: Record<string, unknown>,
    rulesVersion: number,
  ): void {
    const release = this.requiredRelease();
    if (rulesVersion !== release.rulesVersion ||
        u32(value.rulesVersion, "rules catalog version") !== release.rulesVersion ||
        u32(value.contentVersion, "rules content version") !== 2 ||
        u32(value.startsDay, "rules start day") !== release.launchDayId ||
        bytes32Hex(value.catalogHash, "rules catalog hash") !==
          release.rulesCatalogHash) {
      throw new Error("Arena rules catalog does not match keeper release");
    }
  }

  private requireReleaseLaunchDay(launchDayId: number): void {
    if (launchDayId !== this.requiredRelease().launchDayId) {
      throw new Error("Arcade launch day does not match keeper release");
    }
  }

  private async loadCanonicalCampaignMaps(): Promise<void> {
    for (let mapId = 1; mapId <= 10; mapId += 1) {
      const map = await this.loadRequired(
        "mapCatalog",
        mapCatalogPda(2, mapId),
        PROTOCOL_ACCOUNT_VERSION,
      );
      if (u32(map.value.contentVersion, "Campaign content version") !== 2 ||
          u8(map.value.mapId, "Campaign map id") !== mapId ||
          !boolean(map.value.enabled, "Campaign map enabled")) {
        throw new Error("paused Campaign release is incomplete");
      }
    }
  }

  private async loadStagedLaunchPeriods(launchDayId: number): Promise<void> {
    for (const dayId of [launchDayId, launchDayId + 1]) {
      const daily = await this.loadRequired(
        "arenaDaily",
        arenaDailyPda(dayId),
        ARCADE_ACCOUNT_VERSION,
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
    operation: Exclude<KeeperOperation, "revoke_expired_session">;
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
    operation: Exclude<KeeperOperation, "revoke_expired_session">;
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
        const contentVersion = requiredNumber(context.contentVersion, "content version");
        const realmMapId = requiredMapId(context.realmMapId, true, "realm map id");
        const passiveMapId = requiredMapId(context.passiveMapId, false, "passive map id");
        return {
          name: this.preferredInstructionName(
            "fundedPrepareArenaDaily",
            "prepareArenaDaily",
          ),
          args: { dayId: following },
          accounts: {
            ...base,
            protocol: protocolPda(),
            arcadeConfig: arcadeConfigPda(),
            arcadeArchive: arcadeArchivePda(),
            dailyRulesCatalog: requiredRulesCatalog(context.rulesCatalog),
            realmMapCatalog: mapCatalogPda(contentVersion, Math.max(realmMapId, 1)),
            passiveMapCatalog: mapCatalogPda(contentVersion, passiveMapId),
            arenaDaily: arenaDailyPda(following),
            cadenceFunding: cadenceFundingPda(),
            zkubeProgram: ZKUBE_PROGRAM_ID,
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
            dailyRulesCatalog: requiredRulesCatalog(context.rulesCatalog),
            arenaDaily: arenaDailyPda(requiredNumber(dayId, "day id")),
          },
        };
      case "force_finish_deadline":
        return {
          name: "forceFinishDeadline",
          args: {},
          accounts: {
            ...base,
            activeRun: activeRunPda(requiredOwner(owner), requiredRunId(runId)),
          },
        };
      case "commit_run":
        return {
          name: "commitRun",
          args: {},
          accounts: {
            ...base,
            activeRun: activeRunPda(requiredOwner(owner), requiredRunId(runId)),
          },
        };
      case "consume_campaign_run": {
        const player = requiredOwner(owner);
        return {
          name: "consumeCampaignRun",
          args: {},
          accounts: {
            activeRun: activeRunPda(player, requiredRunId(runId)),
            playerState: playerStatePda(player),
            owner: player,
            rentRecipient: playerFundingPda(player),
          },
        };
      }
      case "consume_arena_run": {
        const player = requiredOwner(owner);
        const challenge = requiredNumber(dayId, "challenge day id");
        const daily = arenaDailyPda(challenge);
        return {
          name: "consumeArenaRun",
          args: {},
          accounts: {
            playerState: playerStatePda(player),
            arenaDaily: daily,
            arenaPlayer: arenaPlayerPda(daily, player),
            activeRun: activeRunPda(player, requiredRunId(runId)),
            rentRecipient: playerFundingPda(player),
          },
        };
      }
      case "expire_unresolved_arena_run": {
        const player = requiredOwner(owner);
        const daily = arenaDailyPda(requiredNumber(dayId, "challenge day id"));
        return {
          name: "expireUnresolvedArenaRun",
          args: { runId: new BN(requiredRunId(runId).toString()) },
          accounts: {
            ...base,
            playerState: playerStatePda(player),
            arenaDaily: daily,
            arenaPlayer: context.includeArenaPlayer
              ? arenaPlayerPda(daily, player)
              : ZKUBE_PROGRAM_ID,
            owner: player,
          },
        };
      }
      case "cleanup_orphan_active_run": {
        const player = requiredOwner(owner);
        return {
          name: "cleanupOrphanActiveRun",
          args: {},
          accounts: {
            ...base,
            activeRun: activeRunPda(player, requiredRunId(runId)),
            playerState: playerStatePda(player),
            rentRecipient: playerFundingPda(player),
          },
        };
      }
      case "finalize_arena_daily":
        {
          const daily = arenaDailyPda(requiredNumber(dayId, "day id"));
        return {
          name: "fundedFinalizeArenaDaily",
          args: {
            scorePayoutCount: requiredNumber(context.scorePayoutCount, "Score payout count"),
            themePayoutCount: requiredNumber(context.themePayoutCount, "Theme payout count"),
          },
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
            zkubeProgram: ZKUBE_PROGRAM_ID,
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
            seal: context.sealBoard === true,
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
            arcadeArchive: arcadeArchivePda(),
            arcadeConfig: arcadeConfigPda(),
            dailyRulesCatalog: requiredRulesCatalog(context.rulesCatalog),
            arenaDaily: daily,
            scoreBoard: arenaBoardPda(daily, "score"),
            themeBoard: arenaBoardPda(daily, "theme"),
            followingDaily: arenaDailyPda(
              requiredNumber(context.followingDayId, "following day id"),
            ),
          },
        };
        }
      case "sync_daily_profile": {
        const player = requiredOwner(owner);
        const daily = arenaDailyPda(requiredNumber(dayId, "day id"));
        const board = requiredBoardKind(context.boardKind);
        return {
          name: "syncDailyProfile",
          args: { board: dailyBoardKind(board) },
          accounts: {
            caller: keeper,
            arenaDaily: daily,
            arenaBoard: arenaBoardPda(daily, board),
            playerState: playerStatePda(player),
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
            arcadeArchive: arcadeArchivePda(),
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
            arcadeArchive: arcadeArchivePda(),
            arenaDaily: daily,
            scoreBoard: arenaBoardPda(daily, "score"),
            themeBoard: arenaBoardPda(daily, "theme"),
            cadenceFunding: cadenceFundingPda(),
          },
        };
        }
      case "close_arena_player": {
        const player = requiredOwner(owner);
        const daily = arenaDailyPda(requiredNumber(dayId, "day id"));
        requireRentRecipient(context.rentRecipient, player);
        return {
          name: "closeArenaPlayer",
          args: {},
          accounts: {
            caller: keeper,
            arenaDaily: daily,
            arenaPlayer: arenaPlayerPda(daily, player),
            rentRecipient: playerFundingPda(player),
          },
        };
      }
    }
  }

  private preferredInstructionName(
    preferred: string,
    legacy: string,
  ): string {
    const names = new Set(
      array((this.idl as unknown as Record<string, unknown>).instructions,
        "Anchor IDL instructions")
        .map((value) => record(value, "Anchor IDL instruction").name),
    );
    if (names.has(preferred)) return preferred;
    if (this.idlHasInstruction("archiveArenaDaily")) {
      throw new Error(`checked-in archive ABI is missing ${preferred}`);
    }
    if (names.has(legacy)) return legacy;
    throw new Error(`checked-in Anchor IDL is missing ${preferred}`);
  }

  private idlHasInstruction(name: string): boolean {
    return array(
      (this.idl as unknown as Record<string, unknown>).instructions,
      "Anchor IDL instructions",
    ).some((value) =>
      record(value, "Anchor IDL instruction").name === name
    );
  }

  private idlHasAccount(name: string): boolean {
    return array(
      (this.idl as unknown as Record<string, unknown>).accounts,
      "Anchor IDL accounts",
    ).some((value) =>
      record(value, "Anchor IDL account").name === name
    );
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
      ARCADE_ACCOUNT_VERSION,
    );
    const output: LoadedDaily[] = [];
    for (const item of loaded) {
      const dayId = u32(item.value.dayId, "ArenaDaily day id");
      const dayStart = dayId * SECONDS_PER_DAY;
      const entriesCloseAt = timestamp(
        item.value.entriesCloseAt,
        "ArenaDaily entry close",
      );
      const runsCloseAt = timestamp(item.value.runsCloseAt, "ArenaDaily run close");
      if (!item.address.equals(arenaDailyPda(dayId)) ||
          timestamp(item.value.opensAt, "ArenaDaily open") !== dayStart ||
          !validDailyWindow(dayStart, entriesCloseAt, runsCloseAt)) {
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
      let scoreProfileSyncMask = 0n;
      let themeProfileSyncMask = 0n;
      let scoreBoard: LoadedBoardSnapshot | undefined;
      let themeBoard: LoadedBoardSnapshot | undefined;
      let settlement: SettlementSnapshot | undefined;
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
        scoreProfileSyncMask = scoreBoard.profileSyncMask;
        themeProfileSyncMask = themeBoard.profileSyncMask;
        if (scoreBoard.construction.sealed && themeBoard.construction.sealed) {
          settlement = this.rankedSettlement(
            scoreBoard.entries,
            themeBoard.entries,
            scoreQualifiedPlayers,
            themeQualifiedPlayers,
            potLamports,
          );
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
        recoveryDeadlineAt: timestamp(
          item.value.recoveryDeadlineAt,
          "ArenaDaily recovery deadline",
        ),
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
        scoreProfileSyncMask,
        themeProfileSyncMask,
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
      ARCADE_ACCOUNT_VERSION,
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
    const profileSyncCount = u32(
      loaded.value.profileSyncCount,
      `ArenaBoard ${kind} profile sync count`,
    );
    const bitmapBytes = Math.ceil(payoutCount / 8);
    const expectedSize = ARENA_BOARD_HEADER_BYTES +
      payoutCount * ARENA_BOARD_ENTRY_SIZE + 2 * bitmapBytes;
    const plan = rankWeightedPayoutPlan(
      poolLamports,
      qualifiedCount,
      ARENA_BOARD_CAPACITY,
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
        profileSyncCount > payoutCount || loaded.account.data.length !== expectedSize) {
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
      payoutCount * ARENA_BOARD_ENTRY_SIZE;
    const claimedMask = littleEndianMask(
      loaded.account.data.subarray(masksOffset, masksOffset + bitmapBytes),
    );
    const profileSyncMask = littleEndianMask(
      loaded.account.data.subarray(
        masksOffset + bitmapBytes,
        masksOffset + 2 * bitmapBytes,
      ),
    );
    if (popcount(claimedMask) !== claimedCount ||
        popcount(profileSyncMask) !== profileSyncCount) {
      throw new Error(`${kind} ArenaBoard bitmap counters do not match`);
    }
    const sealed = boolean(loaded.value.sealed, `ArenaBoard ${kind} sealed`);
    if (sealed !== (cursor === payoutCount)) {
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
        claimedLamports,
        claimedCount,
        profileSyncCount,
        capacityLimited,
      },
      entries,
      claimedMask,
      profileSyncMask,
    };
  }

  private async loadParticipantClosures(
    dailies: readonly LoadedDaily[],
    archive: ArcadeArchiveSnapshot | undefined,
  ): Promise<{
    arenaPlayers: ArenaPlayerClosureSnapshot[];
    arenaCadenceBlockers: Set<number>;
    boardSources: Map<number, {
      score: BoardSourceSnapshot[];
      theme: BoardSourceSnapshot[];
    }>;
  }> {
    const candidates: Array<{ dayId: number; owner: PublicKey }> = [];
    const arenaCadenceBlockers = new Set<number>();
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
      ARCADE_ACCOUNT_VERSION,
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
      if (liveDaily.has(dayId)) arenaCadenceBlockers.add(dayId);
      const sources = boardSources.get(dayId) ?? { score: [], theme: [] };
      if (boolean(player.value.hasScoreBest, "ArenaPlayer Score best flag")) {
        sources.score.push(boardSourceSnapshot(player, owner, "score"));
      }
      if (boolean(player.value.hasThemeBest, "ArenaPlayer Theme best flag")) {
        sources.theme.push(boardSourceSnapshot(player, owner, "theme"));
      }
      boardSources.set(dayId, sources);
      if (archive?.lastDailyId !== undefined && dayId <= archive.lastDailyId &&
          liveDaily.has(dayId) && liveDaily.get(dayId)?.status !== "finalized") {
        throw new Error("archived Daily was recreated or mutated");
      }
      const finalized = liveDaily.get(dayId)?.status === "finalized" ||
        (archive?.lastDailyId !== undefined && dayId <= archive.lastDailyId);
      if (!finalized ||
          dayId < Math.max(0, today - KEEPER_RECENT_DAILY_CADENCES)) {
        continue;
      }
      const activePaidRunId = bigint(
        player.value.activePaidRunId,
        "ArenaPlayer active paid run id",
      );
      const paidEntries = bigint(player.value.paidEntries, "ArenaPlayer paid entries");
      const resolvedEntries = bigint(
        player.value.resolvedEntries,
        "ArenaPlayer resolved entries",
      );
      const resolved = resolvedEntries === paidEntries;
      if (activePaidRunId === 0n && resolved) candidates.push({ dayId, owner });
    }

    const fundingInfos = await this.getMultiple(
      candidates.map(({ owner }) => playerFundingPda(owner)),
    );
    const arenaPlayers = candidates.flatMap(({ dayId, owner }, index) => {
      const info = fundingInfos[index];
      const valid = !info || (!info.executable &&
        info.owner.equals(SystemProgram.programId) && info.data.length === 0);
      return valid ? [{ dayId, owner, rentRecipient: playerFundingPda(owner) }] : [];
    });
    for (const sources of boardSources.values()) {
      sources.score.sort((left, right) => compareBoardSources("score", left, right));
      sources.theme.sort((left, right) => compareBoardSources("theme", left, right));
    }
    return { arenaPlayers, arenaCadenceBlockers, boardSources };
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
      const campaignActiveRunId = bigint(
        loaded.value.campaignActiveRunId,
        "PlayerState Campaign active run id",
      );
      const orphanRunId = bigint(loaded.value.orphanRunId, "PlayerState orphan run id");
      const activeRunDaily = publicKey(
        loaded.value.activeRunDaily,
        "PlayerState active run Daily",
      );
      const activeRunMode = runMode(loaded.value.activeRunMode, "PlayerState active run mode");
      const activeRunDeadlineAt = signedTimestamp(
        loaded.value.activeRunDeadlineAt,
        "PlayerState active run deadline",
      );
      const reserved = array(loaded.value.reserved, "PlayerState reserved bytes");
      if (reserved.length !== 56 ||
          reserved.some((value) => u8(value, "PlayerState reserved byte") !== 0)) {
        throw new Error("PlayerState reserved bytes are nonzero");
      }
      if (nextRunId === 0n || activeRunId >= nextRunId ||
          campaignActiveRunId >= nextRunId || orphanRunId >= nextRunId ||
          (activeRunId !== 0n && activeRunId === campaignActiveRunId) ||
          (activeRunId !== 0n && orphanRunId !== 0n)) {
        throw new Error("PlayerState run reservations are invalid");
      }
      const idle = activeRunId === 0n;
      const noArenaCadence = activeRunDaily.equals(SystemProgram.programId) &&
        activeRunDeadlineAt === 0;
      if ((idle && (!noArenaCadence || activeRunMode !== "campaign")) ||
          (!idle && activeRunMode === "campaign") ||
          (!idle && activeRunMode !== "campaign" &&
            (activeRunDaily.equals(SystemProgram.programId) || activeRunDeadlineAt <= 0))) {
        throw new Error("PlayerState active reservation fields are inconsistent");
      }
      return {
        address: loaded.address,
        owner,
        nextRunId,
        activeRunId,
        campaignActiveRunId,
        activeRunDaily,
        activeRunMode,
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
      if (player.campaignActiveRunId !== 0n) {
        output.push(await this.loadRun(
          player,
          player.campaignActiveRunId,
          true,
          dailyByAddress,
          {
            mode: "campaign",
            daily: SystemProgram.programId,
            deadlineAt: 0,
          },
        ));
      }
      if (player.activeRunId !== 0n) {
        try {
          output.push(await this.loadRun(
            player,
            player.activeRunId,
            true,
            dailyByAddress,
            {
              mode: player.activeRunMode,
              daily: player.activeRunDaily,
              deadlineAt: player.activeRunDeadlineAt,
            },
          ));
        } catch (error) {
          if (this.input.nowUnix <
              player.activeRunDeadlineAt + RUN_RECOVERY_SECONDS) {
            throw error;
          }
          const daily = dailyByAddress.get(player.activeRunDaily.toBase58());
          const cadence = daily
            ? { challengeDayId: daily.dayId, deadlineDayId: daily.dayId }
            : rankedCadenceFromDeadline(
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
            mode: player.activeRunMode,
            challengeDayId: cadence.challengeDayId,
            deadlineDayId: cadence.deadlineDayId,
            arenaPlayerExists,
            lifecycle: "unavailable",
            location: "unavailable",
            acceptedActions: 0,
            runsCloseAt: player.activeRunDeadlineAt,
            recoveryDeadlineAt: player.activeRunDeadlineAt + RUN_RECOVERY_SECONDS,
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
      mode: "campaign" | "ranked";
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
    const decodedRunId = bigint(loaded.value.runId, "ActiveRun run id");
    if (!owner.equals(player.owner) || decodedRunId !== runId) {
      throw new Error("ActiveRun identity is invalid");
    }
    const mode = runMode(loaded.value.mode, "ActiveRun mode");
    const deadlineAt = signedTimestamp(loaded.value.deadlineAt, "ActiveRun deadline");
    const dailyAddress = publicKey(loaded.value.dailyChallenge, "ActiveRun Daily");
    if (reservationActive &&
        (!expected || mode !== expected.mode || !dailyAddress.equals(expected.daily) ||
          deadlineAt !== expected.deadlineAt)) {
      throw new Error("ActiveRun does not match its durable reservation");
    }
    if (mode === "campaign") {
      if (!dailyAddress.equals(SystemProgram.programId) || deadlineAt !== 0) {
        throw new Error("Campaign ActiveRun carries Arena cadence state");
      }
      return {
        owner,
        runId,
        mode,
        arenaPlayerExists: false,
        lifecycle: runLifecycle(loaded.value.lifecycle, "ActiveRun lifecycle"),
        location,
        acceptedActions: u32(loaded.value.actionCounter, "ActiveRun action counter"),
        reservationActive,
      };
    }
    const daily = dailyByAddress.get(dailyAddress.toBase58());
    const cadence = daily
      ? { challengeDayId: daily.dayId, deadlineDayId: daily.dayId }
      : rankedCadenceFromDeadline(dailyAddress, deadlineAt);
    const arenaPlayerExists = await this.loadArenaPlayerExists(dailyAddress, owner);
    if (!arenaPlayerExists) {
      throw new Error("ranked ActiveRun is missing its ArenaPlayer");
    }
    return {
      owner,
      runId,
      mode,
      challengeDayId: cadence.challengeDayId,
      deadlineDayId: cadence.deadlineDayId,
      arenaPlayerExists,
      lifecycle: runLifecycle(loaded.value.lifecycle, "ActiveRun lifecycle"),
      location,
      acceptedActions: u32(loaded.value.actionCounter, "ActiveRun action counter"),
      runsCloseAt: deadlineAt,
      recoveryDeadlineAt: deadlineAt + RUN_RECOVERY_SECONDS,
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
      ARCADE_ACCOUNT_VERSION,
      address,
    );
    requirePublicKey(loaded.value, "challenge", daily, "ArenaPlayer challenge");
    requirePublicKey(loaded.value, "player", owner, "ArenaPlayer owner");
    return true;
  }

  private rankedSettlement(
    scoreEntries: readonly BoardSourceSnapshot[],
    themeEntries: readonly BoardSourceSnapshot[],
    scoreQualifiedPlayers: number,
    themeQualifiedPlayers: number,
    potLamports: bigint,
  ): SettlementSnapshot {
    const pools = dailyBoardPools(potLamports, themeQualifiedPlayers);
    const scorePlan = rankWeightedPayoutPlan(
      pools.score,
      scoreQualifiedPlayers,
      ARENA_BOARD_CAPACITY,
    );
    const themePlan = rankWeightedPayoutPlan(
      pools.theme,
      themeQualifiedPlayers,
      ARENA_BOARD_CAPACITY,
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
  if (leftMetric !== rightMetric) return leftMetric > rightMetric ? -1 : 1;
  if (left.finalizedAt !== right.finalizedAt) {
    return left.finalizedAt - right.finalizedAt;
  }
  return Buffer.compare(left.owner.toBuffer(), right.owner.toBuffer());
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
  for (const alternatives of REQUIRED_INSTRUCTION_ALTERNATIVES) {
    if (!alternatives.some((name) => instructionNames.has(name))) {
      throw new Error(
        `checked-in Anchor IDL is missing ${alternatives[0]}`,
      );
    }
  }
  if (instructionNames.has("archiveArenaDaily") &&
      !accountNames.has("arcadeArchive")) {
    throw new Error("checked-in Anchor IDL is missing arcadeArchive");
  }
}

const RESULT_FIELDS = {
  daily: [
    "version",
    "dayId",
    "arcadeConfig",
    "rulesVersion",
    "contentVersion",
    "catalogHash",
    "rulesHash",
    "mapId",
    "passiveMapId",
    "scoringRule",
    "rules",
    "pressure",
    "opensAt",
    "entriesCloseAt",
    "runsCloseAt",
    "finalizedAt",
    "ledger",
    "entriesPaid",
    "entriesScored",
    "entriesExpired",
    "uniquePlayers",
    "scoreQualifiedPlayers",
    "themeQualifiedPlayers",
  ],
} as const;

const BOARD_RESULT_FIELDS = [
  "version",
  "arenaDaily",
  "dayId",
  "kind",
  "qualifiedCount",
  "widthCount",
  "payoutCount",
  "denominator",
  "poolLamports",
  "paidLamports",
  "rolloverLamports",
  "capacityLimited",
] as const;

export interface CanonicalBoardResultInput {
  value: Record<string, unknown>;
  data: Buffer;
}

export function canonicalCadenceResultHash(
  idl: Idl,
  competition: "daily",
  value: Record<string, unknown>,
  boards: { score: CanonicalBoardResultInput; theme: CanonicalBoardResultInput },
): string {
  return cadenceResultHash(
    competition,
    canonicalCadenceResultData(idl, competition, value, boards),
  );
}

export function canonicalCadenceResultData(
  idl: Idl,
  competition: "daily",
  value: Record<string, unknown>,
  boards: { score: CanonicalBoardResultInput; theme: CanonicalBoardResultInput },
): Buffer {
  const definitions = array(
    (idl as unknown as Record<string, unknown>).types,
    "Anchor IDL types",
  );
  const daily = encodeSelectedType(
    definitions,
    "arenaDaily",
    RESULT_FIELDS[competition],
    value,
  );
  const boardBytes = (["score", "theme"] as const).flatMap((kind) => {
    const board = boards[kind];
    const payoutCount = u32(board.value.payoutCount, `${kind} payout count`);
    const cursor = u32(board.value.cursor, `${kind} cursor`);
    if (!boolean(board.value.sealed, `${kind} board seal`) || cursor !== payoutCount) {
      throw new Error(`${kind} board is not complete for archival`);
    }
    const rowsEnd = ARENA_BOARD_HEADER_BYTES + payoutCount * ARENA_BOARD_ENTRY_SIZE;
    if (rowsEnd > board.data.length) throw new Error(`${kind} board rows are truncated`);
    return [
      encodeSelectedType(
        definitions,
        "arenaBoard",
        BOARD_RESULT_FIELDS,
        board.value,
      ),
      Buffer.from(board.data.subarray(ARENA_BOARD_HEADER_BYTES, rowsEnd)),
    ];
  });
  const result = Buffer.concat([daily, ...boardBytes]);
  if (result.length >= MAX_CADENCE_RESULT_BYTES) {
    throw new Error(
      `canonical ${competition} result encoding reached or exceeded the ` +
        `${MAX_CADENCE_RESULT_BYTES}-byte bound`,
    );
  }
  return result;
}

function encodeSelectedType(
  definitions: readonly unknown[],
  definitionName: string,
  fields: readonly string[],
  value: Record<string, unknown>,
): Buffer {
  const definition = definitions
    .map((entry) => record(entry, "Anchor IDL type"))
    .find(({ name }) => name === definitionName);
  const type = definition && record(definition.type, `${definitionName} type`);
  const sourceFields = type && array(type.fields, `${definitionName} fields`);
  if (!definition || type?.kind !== "struct" || !sourceFields) {
    throw new Error(`checked-in Anchor IDL is missing ${definitionName} fields`);
  }
  const selected = fields.map((name) => {
    const field = sourceFields
      .map((entry) => record(entry, `${definitionName} field`))
      .find((entry) => entry.name === name);
    if (!field) throw new Error(`${definitionName}.${name} is missing from the IDL`);
    return field;
  });
  const resultDefinition = {
    name: `keeper${definitionName}Result`,
    type: { kind: "struct", fields: selected },
  } as IdlTypeDef;
  const layout = IdlCoder.typeDefLayout({
    typeDef: resultDefinition,
    types: definitions as IdlTypeDef[],
  });
  const buffer = Buffer.alloc(MAX_CADENCE_RESULT_BYTES);
  let encodedLength: number;
  try {
    encodedLength = layout.encode(value, buffer);
  } catch (cause) {
    throw new Error(
      `canonical ${definitionName} result encoding failed within the ` +
        `${MAX_CADENCE_RESULT_BYTES}-byte bound`,
      { cause },
    );
  }
  if (!Number.isSafeInteger(encodedLength) || encodedLength < 0 ||
      encodedLength >= MAX_CADENCE_RESULT_BYTES) {
    throw new Error(
      `canonical ${definitionName} result encoding reached or exceeded the ` +
        `${MAX_CADENCE_RESULT_BYTES}-byte bound`,
    );
  }
  return Buffer.from(buffer.subarray(0, encodedLength));
}

function profileSyncMask(
  period: DailySnapshot,
  board: "score" | "theme",
): bigint {
  let mask = 0n;
  for (const winner of period.settlement?.winners ?? []) {
    if (winner.board !== board || winner.payoutLamports === 0n) continue;
    const bit = winner.rank - 1;
    if (!Number.isSafeInteger(bit) ||
        bit < 0 || bit >= ARENA_BOARD_CAPACITY) {
      throw new Error("cadence payout position is invalid");
    }
    mask |= 1n << BigInt(bit);
  }
  return mask;
}

function rankedCadenceFromDeadline(
  dailyAddress: PublicKey,
  deadlineAt: number,
): { challengeDayId: number; deadlineDayId: number } {
  const challengeDayId = Math.floor(deadlineAt / SECONDS_PER_DAY);
  if (deadlineAt - challengeDayId * SECONDS_PER_DAY !== DAILY_RUN_CLOSE_OFFSET ||
      !dailyAddress.equals(arenaDailyPda(challengeDayId))) {
    throw new Error("ranked ActiveRun closed-Daily cadence is invalid");
  }
  return { challengeDayId, deadlineDayId: challengeDayId };
}

function validDailyWindow(
  dayStart: number,
  entriesCloseAt: number,
  runsCloseAt: number,
): boolean {
  return entriesCloseAt === dayStart + DAILY_ENTRY_CLOSE_OFFSET &&
    runsCloseAt === dayStart + DAILY_RUN_CLOSE_OFFSET;
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

function runMode(value: unknown, label: string): "campaign" | "ranked" {
  const variant = enumVariant(value, label);
  if (variant === "campaign") return "campaign";
  if (variant === "daily") return "ranked";
  throw new Error(`${label} is invalid`);
}

function runLifecycle(value: unknown, label: string): RunLifecycle {
  const variant = enumVariant(value, label);
  if (variant === "prepared" || variant === "delegated" || variant === "playing") {
    return variant;
  }
  if (variant === "awaitingVrf") return "awaiting_vrf";
  if (variant === "levelComplete" || variant === "finished") return "terminal";
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

function requireBigInt(
  value: Record<string, unknown>,
  field: string,
  expected: bigint,
  label: string,
): void {
  if (bigint(value[field], label) !== expected) {
    throw new Error(`${label} is invalid`);
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

function timestamp(value: unknown, label: string): number {
  const parsed = signedTimestamp(value, label);
  if (parsed === 0) throw new Error(`${label} must be positive`);
  return parsed;
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

function requiredRulesCatalog(value: PublicKey | undefined): PublicKey {
  if (!value) throw new Error("IDL materializer has no validated rules catalog");
  return value;
}

function requiredOwner(value: PublicKey | undefined): PublicKey {
  if (!value) throw new Error("IDL materializer is missing run/player owner");
  return value;
}

function requireRentRecipient(value: PublicKey | undefined, owner: PublicKey): void {
  if (!value || !value.equals(playerFundingPda(owner))) {
    throw new Error("IDL materializer rejects noncanonical player funding recipient");
  }
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

function requiredMapId(
  value: number | undefined,
  allowWildcard: boolean,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || value === undefined ||
      value < (allowWildcard ? 0 : 1) || value > 10) {
    throw new Error(`IDL materializer is missing ${label}`);
  }
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
