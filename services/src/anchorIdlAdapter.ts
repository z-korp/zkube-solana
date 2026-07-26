import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  BorshAccountsCoder,
  BorshCoder,
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
  ARCADE_ACCOUNT_VERSION,
  ARENA_ENTRY_LAMPORTS,
  DAILY_ENTRY_CLOSE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  DAILY_PRIZE_WEIGHTS,
  DAYS_PER_SEASON,
  DAYS_PER_WEEK,
  ENTRY_SPLIT_LAMPORTS,
  MONDAY_EPOCH_DAY_ID,
  KEEPER_RECENT_DAILY_CADENCES,
  KEEPER_RECENT_SEASON_CADENCES,
  PLAYER_STATE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION,
  RULES_ACCOUNT_VERSION,
  RUN_RECOVERY_SECONDS,
  SECONDS_PER_DAY,
  ZKUBE_PROGRAM_ID,
  WEEKLY_PRIZE_WEIGHTS,
  activeRunPda,
  arcadeArchivePda,
  arcadeConfigPda,
  arenaDailyPda,
  arenaPlayerPda,
  assertCadenceId,
  currentDayId,
  cadenceFundingPda,
  mapCatalogPda,
  playerFundingPda,
  playerStatePda,
  protocolPda,
  rulesCatalogPda,
  seasonIdForDay,
  seasonPda,
  seasonPlayerPda,
  seasonStartDay,
  weekIdForDay,
  weekStartDay,
  weeklyJackpotPda,
  type KeeperOperation,
  type KeeperPlanContext,
} from "./arcadeChain.js";
import { equalBudgetPlan, payoutPlan } from "./arcadeEconomy.js";
import {
  type DailySeasonPlayerSnapshot,
  type DailySnapshot,
  type ArenaPlayerClosureSnapshot,
  type PeriodStatus,
  type ProtocolSnapshot,
  type RunLifecycle,
  type RunSnapshot,
  type SeasonSnapshot,
  type ArcadeArchiveSnapshot,
  type CadenceArchiveCandidate,
  type SeasonPlayerClosureSnapshot,
  type SettlementSnapshot,
  type WeeklySnapshot,
  type WinnerSnapshot,
} from "./arcadeReconciliation.js";
import { type ProtocolInstructionMaterializer } from "./planMaterializer.js";
import { getDelegationStatus } from "./router.js";

const MAX_PROGRAM_ACCOUNT_BYTES = 10_240;
const MAX_CADENCE_PERIODS = 10_000;
const MAX_DISCOVERED_PLAYER_STATES = 10_000;
const MAX_ARENA_PLAYERS_PER_DAILY = 5_000;
const MAX_SEASON_PLAYERS_PER_SEASON = 10_000;
const MAX_RPC_ACCOUNT_BATCH = 100;
const LEGACY_DAILY_ENTRY_CLOSE_OFFSET = 23 * 60 * 60;
const LEGACY_DAILY_RUN_CLOSE_OFFSET = 23 * 60 * 60 + 30 * 60;
export const KEEPER_EXPECTED_IDL_SHA256 =
  "8f22022034d137de95b8e44be24182512f00103ca18c7c58f601f92b6454491a";
const REQUIRED_ACCOUNTS = [
  "activeRun",
  "arcadeConfig",
  "arenaDaily",
  "arenaPlayer",
  "dailyRulesCatalog",
  "mapCatalog",
  "playerState",
  "protocolConfig",
  "season",
  "seasonPlayer",
  "weeklyJackpot",
] as const;
const REQUIRED_INSTRUCTIONS = [
  "activateArenaDaily",
  "activateWeeklyJackpot",
  "activateSeason",
  "forceFinishDeadline",
  "commitRun",
  "consumeCampaignRun",
  "consumeArenaRun",
  "consumePracticeRun",
  "expireUnresolvedArenaRun",
  "cleanupOrphanActiveRun",
  "initializeSeasonPlayer",
  "rollupArenaToSeason",
  "sealArenaSeasonRollups",
  "finalizeArenaDaily",
  "finalizeWeeklyJackpot",
  "finalizeSeason",
  "syncDailyProfile",
  "syncWeeklyProfile",
  "syncSeasonProfile",
  "closeArenaPlayer",
  "closeSeasonPlayer",
] as const;
const REQUIRED_INSTRUCTION_ALTERNATIVES = [
  ["fundedPrepareArenaDaily", "prepareArenaDaily"],
  ["fundedPrepareWeeklyJackpot", "prepareWeeklyJackpot"],
  ["fundedPrepareSeason", "prepareSeason"],
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

interface PlayerStateRecord {
  address: PublicKey;
  owner: PublicKey;
  nextRunId: bigint;
  version: number;
  activeRunId: bigint;
  campaignActiveRunId: bigint;
  activeRunDaily: PublicKey;
  activeRunMode: "campaign" | "ranked" | "practice";
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
    if (this.idlHash !== KEEPER_EXPECTED_IDL_SHA256) {
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
      "weeklyLamports",
      ENTRY_SPLIT_LAMPORTS.followingWeekly,
      "Weekly split",
    );
    requireBigInt(
      config.value,
      "seasonLamports",
      ENTRY_SPLIT_LAMPORTS.followingSeason,
      "Season split",
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
    if (launchDayId < MONDAY_EPOCH_DAY_ID ||
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
    requirePublicKey(catalog.value, "protocol", protocol.address, "rules catalog protocol");
    if (u32(catalog.value.rulesVersion, "rules catalog version") !== rulesVersion) {
      throw new Error("rules catalog version relationship is invalid");
    }
    const paused = boolean(protocol.value.paused, "protocol pause state");
    const archiveCheckpoint = await this.loadArchiveCheckpoint();

    const today = currentDayId(this.input.nowUnix);
    const currentSeason = seasonIdForDay(today);
    const firstSeason = seasonIdForDay(launchDayId);
    const firstDay = launchDayId;
    const dailyIds = range(firstDay, checkedNext(today, "day id"));
    const weeklyIds = range(
      weekIdForDay(firstDay),
      checkedNext(weekIdForDay(today), "week id"),
    );
    const seasonIds = range(firstSeason, checkedNext(currentSeason, "Season id"));
    const dailies = await this.loadDailies(dailyIds, launchDayId);
    const weeklies = await this.loadWeeklies(
      weeklyIds,
      weekIdForDay(launchDayId),
      launchDayId,
      dailies,
    );
    const seasons = await this.loadSeasons(
      seasonIds,
      seasonIdForDay(launchDayId),
      launchDayId,
      dailies,
    );
    const launchDailyPresent =
      dailies.some(({ snapshot }) => snapshot.dayId === launchDayId) ||
      (archiveCheckpoint?.lastDailyId ?? -1) >= launchDayId;
    const launchWeeklyId = weekIdForDay(launchDayId);
    const launchWeeklyPresent =
      weeklies.some(({ weekId }) => weekId === launchWeeklyId) ||
      (archiveCheckpoint?.lastWeeklyId ?? -1) >= launchWeeklyId;
    const launchSeasonId = seasonIdForDay(launchDayId);
    const launchSeasonPresent =
      seasons.some(({ seasonId }) => seasonId === launchSeasonId) ||
      (archiveCheckpoint?.lastSeasonId ?? -1) >= launchSeasonId;
    if (!launchDailyPresent || !launchWeeklyPresent || !launchSeasonPresent) {
      throw new Error("seeded Arcade launch cadence is incomplete");
    }
    const dailySeasonPlayers = await this.loadDailySeasonPlayers(dailies, seasons);
    const playerStates = await this.loadPlayerStates();
    const runs = await this.loadRuns(playerStates, dailies);
    const participantClosures = await this.loadParticipantClosures(
      dailies,
      seasons,
      archiveCheckpoint,
    );
    const archive = await this.loadArchiveSnapshot(
      dailies,
      weeklies,
      seasons,
      participantClosures.arenaCadenceBlockers,
      participantClosures.seasonCadenceBlockers,
    );
    if (archive) {
      const dailyById = new Map(
        dailies.map(({ snapshot }) => [snapshot.dayId, snapshot]),
      );
      for (const weekly of weeklies) {
        const finalDay = weekStartDay(weekly.weekId) + DAYS_PER_WEEK - 1;
        const archivedThrough = archive.state.lastDailyId;
        if (range(weekly.qualificationStartDay, finalDay).every((dayId) => {
          const daily = dailyById.get(dayId);
          return daily?.status === "finalized" ||
            (!daily && archivedThrough !== undefined && dayId <= archivedThrough);
        })) {
          weekly.qualificationDailiesComplete = true;
        }
      }
    }
    return {
      paused,
      launchDayId,
      rulesCatalog,
      dailies: dailies.map(({ snapshot }) => snapshot),
      weeklies,
      seasons,
      runs,
      dailySeasonPlayers,
      playerStateOwners: playerStates.map(({ owner }) => owner),
      arenaPlayerClosures: participantClosures.arenaPlayers,
      seasonPlayerClosures: participantClosures.seasonPlayers,
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
    const firstWeeklyId = u32(archive.value.firstWeeklyId,
      "ArcadeArchive first Weekly id");
    const firstSeasonId = u32(archive.value.firstSeasonId,
      "ArcadeArchive first Season id");
    if (firstDailyId !== release.launchDayId ||
        firstWeeklyId !== weekIdForDay(release.launchDayId) ||
        firstSeasonId !== seasonIdForDay(release.launchDayId)) {
      throw new Error("ArcadeArchive first cadence identities are invalid");
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
      lastDailyId: u32(archive.value.lastDailyId,
        "ArcadeArchive last Daily id"),
      lastWeeklyId: u32(archive.value.lastWeeklyId,
        "ArcadeArchive last Weekly id"),
      lastSeasonId: u32(archive.value.lastSeasonId,
        "ArcadeArchive last Season id"),
    };
  }

  private async loadArchiveSnapshot(
    dailies: readonly { loaded: LoadedAccount; snapshot: DailySnapshot }[],
    weeklies: readonly WeeklySnapshot[],
    seasons: readonly SeasonSnapshot[],
    arenaCadenceBlockers: ReadonlySet<number>,
    seasonCadenceBlockers: ReadonlySet<number>,
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
    const firstWeeklyId = u32(loadedArchive.value.firstWeeklyId,
      "ArcadeArchive first Weekly id");
    const firstSeasonId = u32(loadedArchive.value.firstSeasonId,
      "ArcadeArchive first Season id");
    const release = this.requiredRelease();
    if (firstDailyId !== release.launchDayId ||
        firstWeeklyId !== weekIdForDay(release.launchDayId) ||
        firstSeasonId !== seasonIdForDay(release.launchDayId)) {
      throw new Error("ArcadeArchive first cadence identities are invalid");
    }
    const lastDailyId = u32(loadedArchive.value.lastDailyId,
      "ArcadeArchive last Daily id");
    const lastWeeklyId = u32(loadedArchive.value.lastWeeklyId,
      "ArcadeArchive last Weekly id");
    const lastSeasonId = u32(loadedArchive.value.lastSeasonId,
      "ArcadeArchive last Season id");
    if (lastDailyId < firstDailyId - 1 || lastWeeklyId < firstWeeklyId - 1 ||
        lastSeasonId < firstSeasonId - 1) {
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
    const weeklyRoot = bytes32Hex(loadedArchive.value.weeklyRoot,
      "ArcadeArchive Weekly root");
    const seasonRoot = bytes32Hex(loadedArchive.value.seasonRoot,
      "ArcadeArchive Season root");
    const today = currentDayId(this.input.nowUnix);
    if (lastDailyId > today ||
        lastWeeklyId > weekIdForDay(today) ||
        lastSeasonId > seasonIdForDay(today) ||
        (lastDailyId === firstDailyId - 1) !== /^0{64}$/.test(dailyRoot) ||
        (lastWeeklyId === firstWeeklyId - 1) !== /^0{64}$/.test(weeklyRoot) ||
        (lastSeasonId === firstSeasonId - 1) !== /^0{64}$/.test(seasonRoot)) {
      throw new Error("ArcadeArchive checkpoint or root is invalid");
    }
    const state: ArcadeArchiveSnapshot = {
      address: loadedArchive.address,
      cadenceFunding: fundingAddress,
      lastDailyId,
      lastWeeklyId,
      lastSeasonId,
    };
    const candidates: CadenceArchiveCandidate[] = [];
    for (const daily of dailies) {
      if (daily.snapshot.status !== "finalized") continue;
      if (daily.snapshot.dayId > lastDailyId + 1) continue;
      // Archive is intentionally after Season rollup sealing. A committed
      // candidate still passes through so an already archived account can be
      // closed after the remaining rollup/seal work catches up.
      if (daily.snapshot.dayId > lastDailyId &&
          !daily.snapshot.seasonRollupSealed) continue;
      candidates.push(this.archiveCandidate({
        competition: "daily",
        cadenceId: daily.snapshot.dayId,
        loaded: daily.loaded,
        period: daily.snapshot,
        lastCadenceId: lastDailyId,
        currentRoot: dailyRoot,
        participantAccountsRemain:
          arenaCadenceBlockers.has(daily.snapshot.dayId),
      }));
    }
    for (const weekly of weeklies) {
      if (weekly.status !== "finalized") continue;
      if (weekly.weekId > lastWeeklyId + 1) continue;
      const loaded = await this.loadRequired(
        "weeklyJackpot",
        weeklyJackpotPda(weekly.weekId),
        ARCADE_ACCOUNT_VERSION,
      );
      candidates.push(this.archiveCandidate({
        competition: "weekly",
        cadenceId: weekly.weekId,
        loaded,
        period: weekly,
        lastCadenceId: lastWeeklyId,
        currentRoot: weeklyRoot,
        participantAccountsRemain: false,
      }));
    }
    for (const season of seasons) {
      if (season.status !== "finalized") continue;
      if (season.seasonId > lastSeasonId + 1) continue;
      const loaded = await this.loadRequired(
        "season",
        seasonPda(season.seasonId),
        ARCADE_ACCOUNT_VERSION,
      );
      candidates.push(this.archiveCandidate({
        competition: "season",
        cadenceId: season.seasonId,
        loaded,
        period: season,
        lastCadenceId: lastSeasonId,
        currentRoot: seasonRoot,
        participantAccountsRemain:
          seasonCadenceBlockers.has(season.seasonId),
      }));
    }
    return { state, candidates };
  }

  private archiveCandidate(input: {
    competition: "daily" | "weekly" | "season";
    cadenceId: number;
    loaded: LoadedAccount;
    period: DailySnapshot | WeeklySnapshot | SeasonSnapshot;
    lastCadenceId: number;
    currentRoot: string;
    participantAccountsRemain: boolean;
  }): CadenceArchiveCandidate {
    const resultHash = this.cadenceResultHash(
      input.competition,
      input.loaded.value,
    );
    const committed = input.cadenceId <= input.lastCadenceId;
    if (committed && input.cadenceId !== input.lastCadenceId) {
      // Older committed periods should already be closed. Keeping them out of
      // discovery avoids reconstructing an historical intermediate root.
      throw new Error("ArcadeArchive retains an obsolete cadence account");
    }
    const root = committed
      ? input.currentRoot
      : cadenceRoot(
        input.competition,
        input.currentRoot,
        input.cadenceId,
        resultHash,
    );
    const requiredProfileSyncMask = profileSyncMask(input.period);
    const closeEligibleAt = input.competition === "daily"
      ? (input.period as DailySnapshot).runsCloseAt
      : (input.period as WeeklySnapshot | SeasonSnapshot).closesAt;
    const canonicalJson = canonicalJsonString({
      account: input.loaded.address.toBase58(),
      accountDataBase64: input.loaded.account.data.toString("base64"),
      accountDataSha256: createHash("sha256")
        .update(input.loaded.account.data)
        .digest("hex"),
      competition: input.competition,
      periodId: input.cadenceId,
      programId: ZKUBE_PROGRAM_ID.toBase58(),
      resultHash,
      root,
      schemaVersion: 1,
    });
    return {
      competition: input.competition,
      cadenceId: input.cadenceId,
      canonicalJson,
      fileSha256: createHash("sha256")
        .update(Buffer.from(canonicalJson, "utf8"))
        .digest("hex"),
      resultHash,
      requiredProfileSyncMask,
      committed,
      closeEligible:
        committed &&
        this.input.nowUnix >= closeEligibleAt &&
        input.period.profileSyncMask === requiredProfileSyncMask &&
        !input.participantAccountsRemain &&
        (input.competition !== "daily" ||
          (input.period as DailySnapshot).seasonRollupSealed),
      closeEligibleAt,
    };
  }

  private cadenceResultHash(
    competition: "daily" | "weekly" | "season",
    value: Record<string, unknown>,
  ): string {
    return canonicalCadenceResultHash(this.idl, competition, value);
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
        release.launchDayId < MONDAY_EPOCH_DAY_ID) {
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
    const launchWeekId = weekIdForDay(launchDayId);
    const launchSeasonId = seasonIdForDay(launchDayId);
    for (const dayId of [launchDayId, checkedNext(launchDayId, "launch day")]) {
      const daily = await this.loadRequired(
        "arenaDaily",
        arenaDailyPda(dayId),
        ARCADE_ACCOUNT_VERSION,
      );
      if (u32(daily.value.dayId, "ArenaDaily day id") !== dayId ||
          u32(daily.value.weekId, "ArenaDaily week id") !== weekIdForDay(dayId) ||
          u32(daily.value.seasonId, "ArenaDaily Season id") !== seasonIdForDay(dayId)) {
        throw new Error("staged Daily cadence is invalid");
      }
      this.requireUnfundedPeriod(daily.value, "ArenaDaily");
    }
    for (const weekId of [launchWeekId, checkedNext(launchWeekId, "launch week")]) {
      const weekly = await this.loadRequired(
        "weeklyJackpot",
        weeklyJackpotPda(weekId),
        ARCADE_ACCOUNT_VERSION,
      );
      if (u32(weekly.value.weekId, "WeeklyJackpot week id") !== weekId ||
          u32(weekly.value.qualificationStartDay, "Weekly qualification start") !==
            weekStartDay(weekId)) {
        throw new Error("staged Weekly cadence is invalid");
      }
      this.requireUnfundedPeriod(weekly.value, "WeeklyJackpot");
    }
    for (const seasonId of [
      launchSeasonId,
      checkedNext(launchSeasonId, "launch Season"),
    ]) {
      const season = await this.loadRequired(
        "season",
        seasonPda(seasonId),
        ARCADE_ACCOUNT_VERSION,
      );
      if (u32(season.value.seasonId, "Season id") !== seasonId ||
          u32(season.value.qualificationStartDay, "Season qualification start") !==
            seasonStartDay(seasonId)) {
        throw new Error("staged Season cadence is invalid");
      }
      this.requireUnfundedPeriod(season.value, "Season");
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
    const weekId = context.weekId;
    const seasonId = context.seasonId;
    const base = { caller: keeper, payer: keeper, systemProgram: SystemProgram.programId };
    switch (input.operation) {
      case "prepare_arena_daily": {
        const following = requiredNumber(context.followingDayId, "following day id");
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
            arenaDaily: arenaDailyPda(following),
            cadenceFunding: cadenceFundingPda(),
            zkubeProgram: ZKUBE_PROGRAM_ID,
          },
        };
      }
      case "prepare_weekly_jackpot": {
        const following = requiredNumber(context.followingWeekId, "following week id");
        return {
          name: this.preferredInstructionName(
            "fundedPrepareWeeklyJackpot",
            "prepareWeeklyJackpot",
          ),
          args: { weekId: following },
          accounts: {
            ...base,
            protocol: protocolPda(),
            arcadeConfig: arcadeConfigPda(),
            arcadeArchive: arcadeArchivePda(),
            dailyRulesCatalog: requiredRulesCatalog(context.rulesCatalog),
            weeklyJackpot: weeklyJackpotPda(following),
            cadenceFunding: cadenceFundingPda(),
            zkubeProgram: ZKUBE_PROGRAM_ID,
          },
        };
      }
      case "prepare_season": {
        const following = requiredNumber(context.followingSeasonId, "following Season id");
        return {
          name: this.preferredInstructionName("fundedPrepareSeason", "prepareSeason"),
          args: { seasonId: following },
          accounts: {
            ...base,
            protocol: protocolPda(),
            arcadeConfig: arcadeConfigPda(),
            arcadeArchive: arcadeArchivePda(),
            season: seasonPda(following),
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
            arenaDaily: arenaDailyPda(requiredNumber(dayId, "day id")),
          },
        };
      case "activate_weekly_jackpot":
        return {
          name: "activateWeeklyJackpot",
          args: {},
          accounts: {
            ...base,
            protocol: protocolPda(),
            weeklyJackpot: weeklyJackpotPda(requiredNumber(weekId, "week id")),
          },
        };
      case "activate_season":
        return {
          name: "activateSeason",
          args: {},
          accounts: {
            ...base,
            protocol: protocolPda(),
            season: seasonPda(requiredNumber(seasonId, "Season id")),
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
            weeklyJackpot: weeklyJackpotPda(weekIdForDay(challenge)),
            activeRun: activeRunPda(player, requiredRunId(runId)),
            rentRecipient: playerFundingPda(player),
          },
        };
      }
      case "consume_practice_run": {
        const player = requiredOwner(owner);
        const daily = arenaDailyPda(requiredNumber(dayId, "challenge day id"));
        return {
          name: "consumePracticeRun",
          args: {},
          accounts: {
            playerState: playerStatePda(player),
            arenaDaily: daily,
            arenaPlayer: context.includeArenaPlayer
              ? arenaPlayerPda(daily, player)
              : ZKUBE_PROGRAM_ID,
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
      case "expire_unresolved_practice_run": {
        const player = requiredOwner(owner);
        return {
          name: "expireUnresolvedPracticeRun",
          args: { runId: new BN(requiredRunId(runId).toString()) },
          accounts: {
            ...base,
            playerState: playerStatePda(player),
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
      case "initialize_season_player": {
        const player = requiredOwner(owner);
        const id = requiredNumber(seasonId, "Season id");
        const season = seasonPda(id);
        return {
          name: "initializeSeasonPlayer",
          args: {},
          accounts: {
            ...base,
            season,
            seasonPlayer: seasonPlayerPda(season, player),
            player,
          },
        };
      }
      case "rollup_arena_to_season": {
        const player = requiredOwner(owner);
        const daily = arenaDailyPda(requiredNumber(dayId, "day id"));
        const season = seasonPda(requiredNumber(seasonId, "Season id"));
        return {
          name: "rollupArenaToSeason",
          args: {},
          accounts: {
            ...base,
            arenaDaily: daily,
            season,
            seasonPlayer: seasonPlayerPda(season, player),
            arenaPlayer: arenaPlayerPda(daily, player),
          },
        };
      }
      case "seal_arena_season_rollups":
        return {
          name: "sealArenaSeasonRollups",
          args: {},
          accounts: {
            ...base,
            arenaDaily: arenaDailyPda(requiredNumber(dayId, "day id")),
            season: seasonPda(requiredNumber(seasonId, "Season id")),
          },
        };
      case "finalize_arena_daily":
        return {
          name: "finalizeArenaDaily",
          args: {},
          accounts: {
            ...base,
            arenaDaily: arenaDailyPda(requiredNumber(dayId, "day id")),
            followingDaily: arenaDailyPda(
              requiredNumber(context.followingDayId, "following day id"),
            ),
          },
          remaining: writableRemaining(context.owners),
        };
      case "finalize_weekly_jackpot":
        {
          const id = requiredNumber(weekId, "week id");
          const name = "finalizeWeeklyJackpot";
          const archivedQualification = this.instructionHasAccount(
            name,
            "arcadeArchive",
          );
          const qualificationDays = archivedQualification
            ? []
            : requiredWeeklyQualificationDays(context, id);
        return {
          name,
          args: {},
          accounts: {
            ...base,
            weeklyJackpot: weeklyJackpotPda(id),
            followingWeekly: weeklyJackpotPda(
              requiredNumber(context.followingWeekId, "following week id"),
            ),
            arcadeArchive: arcadeArchivePda(),
          },
          remaining: [
            ...qualificationDays.map((day) => ({
              pubkey: arenaDailyPda(day),
              isWritable: false,
            })),
            ...writableRemaining(context.owners),
          ],
        };
        }
      case "finalize_season":
        return {
          name: "finalizeSeason",
          args: {},
          accounts: {
            ...base,
            season: seasonPda(requiredNumber(seasonId, "Season id")),
            followingSeason: seasonPda(
              requiredNumber(context.followingSeasonId, "following Season id"),
            ),
          },
          remaining: writableRemaining(context.owners),
        };
      case "sync_daily_profile": {
        const player = requiredOwner(owner);
        return {
          name: "syncDailyProfile",
          args: {},
          accounts: {
            caller: keeper,
            arenaDaily: arenaDailyPda(requiredNumber(dayId, "day id")),
            playerState: playerStatePda(player),
          },
        };
      }
      case "sync_weekly_profile": {
        const player = requiredOwner(owner);
        return {
          name: "syncWeeklyProfile",
          args: {},
          accounts: {
            caller: keeper,
            weeklyJackpot: weeklyJackpotPda(requiredNumber(weekId, "week id")),
            playerState: playerStatePda(player),
          },
        };
      }
      case "sync_season_profile": {
        const player = requiredOwner(owner);
        return {
          name: "syncSeasonProfile",
          args: {},
          accounts: {
            caller: keeper,
            season: seasonPda(requiredNumber(seasonId, "Season id")),
            playerState: playerStatePda(player),
          },
        };
      }
      case "archive_arena_daily":
        return {
          name: "archiveArenaDaily",
          args: {},
          accounts: {
            caller: keeper,
            arcadeArchive: arcadeArchivePda(),
            arenaDaily: arenaDailyPda(requiredNumber(dayId, "day id")),
          },
        };
      case "archive_weekly_jackpot":
        return {
          name: "archiveWeeklyJackpot",
          args: {},
          accounts: {
            caller: keeper,
            arcadeArchive: arcadeArchivePda(),
            weeklyJackpot: weeklyJackpotPda(requiredNumber(weekId, "week id")),
          },
        };
      case "archive_season":
        return {
          name: "archiveSeason",
          args: {},
          accounts: {
            caller: keeper,
            arcadeArchive: arcadeArchivePda(),
            season: seasonPda(requiredNumber(seasonId, "Season id")),
          },
        };
      case "close_arena_daily":
        return {
          name: "closeArenaDaily",
          args: {},
          accounts: {
            caller: keeper,
            arcadeArchive: arcadeArchivePda(),
            arenaDaily: arenaDailyPda(requiredNumber(dayId, "day id")),
            cadenceFunding: cadenceFundingPda(),
          },
        };
      case "close_weekly_jackpot":
        return {
          name: "closeWeeklyJackpot",
          args: {},
          accounts: {
            caller: keeper,
            arcadeArchive: arcadeArchivePda(),
            weeklyJackpot: weeklyJackpotPda(requiredNumber(weekId, "week id")),
            cadenceFunding: cadenceFundingPda(),
          },
        };
      case "close_season":
        return {
          name: "closeSeason",
          args: {},
          accounts: {
            caller: keeper,
            arcadeArchive: arcadeArchivePda(),
            season: seasonPda(requiredNumber(seasonId, "Season id")),
            cadenceFunding: cadenceFundingPda(),
          },
        };
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
      case "close_season_player": {
        const player = requiredOwner(owner);
        const season = seasonPda(requiredNumber(seasonId, "Season id"));
        requireRentRecipient(context.rentRecipient, player);
        return {
          name: "closeSeasonPlayer",
          args: {},
          accounts: {
            caller: keeper,
            season,
            seasonPlayer: seasonPlayerPda(season, player),
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

  private instructionHasAccount(name: string, account: string): boolean {
    return instructionRecord(this.idl, name).accounts.some((value) =>
      isRecord(value) && value.name === account
    );
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
  ): Promise<Array<{ loaded: LoadedAccount; snapshot: DailySnapshot }>> {
    const loaded = await this.loadKnown(
      "arenaDaily",
      ids.map((id) => ({ id, address: arenaDailyPda(id) })),
      ARCADE_ACCOUNT_VERSION,
    );
    const output: Array<{ loaded: LoadedAccount; snapshot: DailySnapshot }> = [];
    for (const item of loaded) {
      const dayId = u32(item.value.dayId, "ArenaDaily day id");
      const dayStart = dayId * SECONDS_PER_DAY;
      const entriesCloseAt = timestamp(
        item.value.entriesCloseAt,
        "ArenaDaily entry close",
      );
      const runsCloseAt = timestamp(item.value.runsCloseAt, "ArenaDaily run close");
      if (!item.address.equals(arenaDailyPda(dayId)) ||
          u32(item.value.weekId, "ArenaDaily week id") !== weekIdForDay(dayId) ||
          u32(item.value.seasonId, "ArenaDaily Season id") !== seasonIdForDay(dayId) ||
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
      const availableLamports = availableLedgerLamports(item.value.ledger, "ArenaDaily");
      const potLamports = status === "finalized"
        ? fundedLedgerLamports(item.value.ledger, "ArenaDaily")
        : availableLamports;
      if (status === "finalized" && availableLamports !== 0n) {
        throw new Error("finalized ArenaDaily retains unsettled ledger lamports");
      }
      await this.assertSpendable(item.account, availableLamports, "ArenaDaily");
      const snapshot: DailySnapshot = {
        dayId,
        status,
        runsCloseAt,
        recoveryDeadlineAt: timestamp(
          item.value.recoveryDeadlineAt,
          "ArenaDaily recovery deadline",
        ),
        entriesPaid: bigint(item.value.entriesPaid, "ArenaDaily paid entries"),
        entriesScored: bigint(item.value.entriesScored, "ArenaDaily scored entries"),
        entriesExpired: bigint(item.value.entriesExpired, "ArenaDaily expired entries"),
        potLamports,
        predecessorRolloverRequired: dayId !== launchDayId,
        predecessorRolloverApplied: boolean(
          item.value.predecessorRolloverApplied,
          "ArenaDaily predecessor flag",
        ),
        seasonEligiblePlayers: u32(
          item.value.seasonEligiblePlayers,
          "ArenaDaily Season eligible players",
        ),
        seasonRollups: u32(item.value.seasonRollups, "ArenaDaily Season rollups"),
        seasonRollupSealed: boolean(
          item.value.seasonRollupSealed,
          "ArenaDaily Season seal",
        ),
        profileSyncMask: u8(item.value.profileSyncMask, "ArenaDaily profile sync mask"),
        ...(status !== "funding" ? {
          settlement: await this.rankedSettlement(
            array(item.value.entries, "ArenaDaily entries"),
            potLamports,
            "daily",
          ),
        } : {}),
      };
      output.push({ loaded: item, snapshot });
    }
    return output;
  }

  private async loadWeeklies(
    ids: readonly number[],
    launchWeekId: number,
    launchDayId: number,
    dailies: readonly { loaded: LoadedAccount; snapshot: DailySnapshot }[],
  ): Promise<WeeklySnapshot[]> {
    const loaded = await this.loadKnown(
      "weeklyJackpot",
      ids.map((id) => ({ id, address: weeklyJackpotPda(id) })),
      ARCADE_ACCOUNT_VERSION,
    );
    const dailyById = new Map(dailies.map(({ snapshot }) => [snapshot.dayId, snapshot]));
    const output: WeeklySnapshot[] = [];
    for (const item of loaded) {
      const weekId = u32(item.value.weekId, "WeeklyJackpot week id");
      const opensAt = weekStartDay(weekId) * SECONDS_PER_DAY;
      const closesAt = (weekStartDay(weekId) + DAYS_PER_WEEK) * SECONDS_PER_DAY;
      const qualificationStartDay = u32(
        item.value.qualificationStartDay,
        "WeeklyJackpot qualification start",
      );
      const expectedQualificationStart = weekId === launchWeekId
        ? launchDayId
        : weekStartDay(weekId);
      if (!item.address.equals(weeklyJackpotPda(weekId)) ||
          qualificationStartDay !== expectedQualificationStart ||
          timestamp(item.value.opensAt, "WeeklyJackpot open") !== opensAt ||
          timestamp(item.value.closesAt, "WeeklyJackpot close") !== closesAt) {
        throw new Error("WeeklyJackpot PDA is invalid");
      }
      requirePublicKey(
        item.value,
        "arcadeConfig",
        arcadeConfigPda(),
        "WeeklyJackpot ArcadeConfig",
      );
      const status = periodStatus(item.value.status, "WeeklyJackpot status");
      const availableLamports = availableLedgerLamports(item.value.ledger, "WeeklyJackpot");
      const potLamports = status === "finalized"
        ? fundedLedgerLamports(item.value.ledger, "WeeklyJackpot")
        : availableLamports;
      if (status === "finalized" && availableLamports !== 0n) {
        throw new Error("finalized WeeklyJackpot retains unsettled ledger lamports");
      }
      await this.assertSpendable(item.account, availableLamports, "WeeklyJackpot");
      const qualificationDailiesComplete = range(
        qualificationStartDay,
        weekStartDay(weekId) + DAYS_PER_WEEK - 1,
      ).every((dayId) => dailyById.get(dayId)?.status === "finalized");
      output.push({
        weekId,
        qualificationStartDay,
        status,
        closesAt,
        potLamports,
        predecessorRolloverRequired: weekId !== launchWeekId,
        predecessorRolloverApplied: boolean(
          item.value.predecessorRolloverApplied,
          "WeeklyJackpot predecessor flag",
        ),
        qualificationDailiesComplete,
        profileSyncMask: u16(
          item.value.profileSyncMask,
          "WeeklyJackpot profile sync mask",
        ),
        ...(status !== "funding" ? {
          settlement: await this.weeklySettlement(item.value, potLamports),
        } : {}),
      });
    }
    return output;
  }

  private async loadSeasons(
    ids: readonly number[],
    launchSeasonId: number,
    launchDayId: number,
    dailies: readonly { loaded: LoadedAccount; snapshot: DailySnapshot }[],
  ): Promise<SeasonSnapshot[]> {
    const loaded = await this.loadKnown(
      "season",
      ids.map((id) => ({ id, address: seasonPda(id) })),
      ARCADE_ACCOUNT_VERSION,
    );
    void dailies;
    const output: SeasonSnapshot[] = [];
    for (const item of loaded) {
      const seasonId = u32(item.value.seasonId, "Season id");
      const qualificationStartDay = u32(
        item.value.qualificationStartDay,
        "Season qualification start",
      );
      const opensAt = (seasonId * DAYS_PER_SEASON + 4) * SECONDS_PER_DAY;
      const closesAt =
        (seasonId * DAYS_PER_SEASON + 4 + DAYS_PER_SEASON) * SECONDS_PER_DAY;
      const expectedQualificationStart = seasonId === launchSeasonId
        ? launchDayId
        : seasonStartDay(seasonId);
      if (!item.address.equals(seasonPda(seasonId)) ||
          qualificationStartDay !== expectedQualificationStart ||
          timestamp(item.value.opensAt, "Season open") !== opensAt ||
          timestamp(item.value.closesAt, "Season close") !== closesAt) {
        throw new Error("Season PDA is invalid");
      }
      requirePublicKey(
        item.value,
        "arcadeConfig",
        arcadeConfigPda(),
        "Season ArcadeConfig",
      );
      const status = periodStatus(item.value.status, "Season status");
      const availableLamports = availableLedgerLamports(item.value.ledger, "Season");
      const potLamports = status === "finalized"
        ? fundedLedgerLamports(item.value.ledger, "Season")
        : availableLamports;
      if (status === "finalized" && availableLamports !== 0n) {
        throw new Error("finalized Season retains unsettled ledger lamports");
      }
      await this.assertSpendable(item.account, availableLamports, "Season");
      output.push({
        seasonId,
        qualificationStartDay,
        status,
        closesAt,
        potLamports,
        predecessorRolloverRequired: seasonId !== launchSeasonId,
        predecessorRolloverApplied: boolean(
          item.value.predecessorRolloverApplied,
          "Season predecessor flag",
        ),
        sealedDailies: u8(item.value.sealedDailies, "Season sealed Dailies"),
        profileSyncMask: u8(item.value.profileSyncMask, "Season profile sync mask"),
        ...(status !== "funding" ? {
          settlement: await this.rankedSettlement(
            array(item.value.entries, "Season entries"),
            potLamports,
            "season",
          ),
        } : {}),
      });
    }
    return output;
  }

  private async loadDailySeasonPlayers(
    dailies: readonly { loaded: LoadedAccount; snapshot: DailySnapshot }[],
    seasons: readonly SeasonSnapshot[],
  ): Promise<DailySeasonPlayerSnapshot[]> {
    const qualificationStarts = new Map(
      seasons.map(({ seasonId, qualificationStartDay }) =>
        [seasonId, qualificationStartDay]),
    );
    const eligible: Array<{
      dayId: number;
      daily: PublicKey;
      loaded: LoadedAccount;
      owner: PublicKey;
    }> = [];
    for (const daily of dailies) {
      if (daily.snapshot.status !== "finalized" || daily.snapshot.seasonRollupSealed) continue;
      const qualificationStart = qualificationStarts.get(
        seasonIdForDay(daily.snapshot.dayId),
      );
      if (qualificationStart === undefined || daily.snapshot.dayId < qualificationStart) {
        continue;
      }
      const accounts = await this.scanAccounts(
        "arenaPlayer",
        ARCADE_ACCOUNT_VERSION,
        MAX_ARENA_PLAYERS_PER_DAILY,
        [{ memcmp: { offset: 9, bytes: daily.loaded.address.toBase58() } }],
      );
      for (const player of accounts) {
        const challenge = publicKey(player.value.challenge, "ArenaPlayer challenge");
        const owner = publicKey(player.value.player, "ArenaPlayer owner");
        if (!challenge.equals(daily.loaded.address) ||
            !player.address.equals(arenaPlayerPda(challenge, owner))) {
          throw new Error("ArenaPlayer PDA or Daily relationship is invalid");
        }
        if (u32(player.value.resolvedEntries, "ArenaPlayer resolved entries") >
            u32(player.value.paidEntries, "ArenaPlayer paid entries")) {
          throw new Error("ArenaPlayer resolved entries exceed paid entries");
        }
        eligible.push({ dayId: daily.snapshot.dayId, daily: challenge, loaded: player, owner });
      }
    }
    const seasonAddresses = new Map<number, PublicKey>(
      seasons.map(({ seasonId }) => [seasonId, seasonPda(seasonId)]),
    );
    const seasonPlayerAddresses = eligible.map(({ dayId, owner }) => {
      const season = seasonAddresses.get(seasonIdForDay(dayId));
      if (!season) throw new Error("ArenaPlayer references an undiscovered Season");
      return seasonPlayerPda(season, owner);
    });
    const infos = await this.getMultiple(seasonPlayerAddresses);
    return eligible.map(({ dayId, loaded, owner }, index) => {
      const info = infos[index];
      if (info) {
        const season = seasonAddresses.get(seasonIdForDay(dayId))!;
        const decoded = this.decodeAccount(
          "seasonPlayer",
          seasonPlayerAddresses[index]!,
          info,
          ARCADE_ACCOUNT_VERSION,
          seasonPlayerAddresses[index]!,
        );
        requirePublicKey(decoded.value, "season", season, "SeasonPlayer Season");
        requirePublicKey(decoded.value, "player", owner, "SeasonPlayer owner");
        if (u8(decoded.value.resultCount, "SeasonPlayer result count") > 20) {
          throw new Error("SeasonPlayer result count is invalid");
        }
      }
      const paid = u32(loaded.value.paidEntries, "ArenaPlayer paid entries");
      const resolved = u32(loaded.value.resolvedEntries, "ArenaPlayer resolved entries");
      return {
        dayId,
        owner,
        dailyResolved: paid === resolved,
        hasBestScore: boolean(loaded.value.hasBest, "ArenaPlayer best flag"),
        seasonRolled: boolean(
          loaded.value.seasonRolledUp,
          "ArenaPlayer Season rollup flag",
        ),
        seasonPlayerExists: !!info,
      };
    });
  }

  private async loadParticipantClosures(
    dailies: readonly { loaded: LoadedAccount; snapshot: DailySnapshot }[],
    seasons: readonly SeasonSnapshot[],
    archive: ArcadeArchiveSnapshot | undefined,
  ): Promise<{
    arenaPlayers: ArenaPlayerClosureSnapshot[];
    seasonPlayers: SeasonPlayerClosureSnapshot[];
    arenaCadenceBlockers: Set<number>;
    seasonCadenceBlockers: Set<number>;
  }> {
    const arenaCandidates: Array<{ dayId: number; owner: PublicKey }> = [];
    const arenaCadenceBlockers = new Set<number>();
    const today = currentDayId(this.input.nowUnix);
    const firstDay = this.requiredRelease().launchDayId;
    const dayByAddress = new Map(
      range(firstDay, today).map((dayId) => [arenaDailyPda(dayId).toBase58(), dayId]),
    );
    const liveDaily = new Map(
      dailies.map(({ snapshot }) => [snapshot.dayId, snapshot]),
    );
    const discoveredArenaPlayers = await this.scanAccounts(
      "arenaPlayer",
      ARCADE_ACCOUNT_VERSION,
      MAX_ARENA_PLAYERS_PER_DAILY,
    );
    for (const player of discoveredArenaPlayers) {
      const challenge = publicKey(player.value.challenge, "ArenaPlayer challenge");
      const owner = publicKey(player.value.player, "ArenaPlayer owner");
      const dayId = dayByAddress.get(challenge.toBase58());
      if (dayId === undefined ||
          !player.address.equals(arenaPlayerPda(challenge, owner))) {
        throw new Error("ArenaPlayer cleanup PDA or Daily relationship is invalid");
      }
      if (liveDaily.has(dayId)) arenaCadenceBlockers.add(dayId);
      if (archive?.lastDailyId !== undefined &&
          dayId <= archive.lastDailyId &&
          liveDaily.has(dayId) &&
          liveDaily.get(dayId)?.status !== "finalized") {
        throw new Error("archived Daily was recreated or mutated");
      }
      // Archive requires finalized on-chain. If the account is absent below
      // the checkpoint, close_arena_daily additionally proves resolution,
      // Season sealing, profile sync, and removal of participant blockers.
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
      const hasBest = boolean(player.value.hasBest, "ArenaPlayer best flag");
      const seasonRolled = boolean(
        player.value.seasonRolledUp,
        "ArenaPlayer Season rollup flag",
      );
      if (activePaidRunId === 0n && (!hasBest || seasonRolled)) {
        arenaCandidates.push({ dayId, owner });
      }
    }

    const seasonCandidates: Array<{ seasonId: number; owner: PublicKey }> = [];
    const seasonCadenceBlockers = new Set<number>();
    const firstSeason = seasonIdForDay(firstDay);
    const currentSeason = seasonIdForDay(today);
    const seasonByAddress = new Map(
      range(firstSeason, currentSeason)
        .map((seasonId) => [seasonPda(seasonId).toBase58(), seasonId]),
    );
    const liveSeason = new Map(seasons.map((value) => [value.seasonId, value]));
    const discoveredSeasonPlayers = await this.scanAccounts(
      "seasonPlayer",
      ARCADE_ACCOUNT_VERSION,
      MAX_SEASON_PLAYERS_PER_SEASON,
    );
    for (const player of discoveredSeasonPlayers) {
      const storedSeason = publicKey(player.value.season, "SeasonPlayer Season");
      const owner = publicKey(player.value.player, "SeasonPlayer owner");
      const seasonId = seasonByAddress.get(storedSeason.toBase58());
      if (seasonId === undefined ||
          !player.address.equals(seasonPlayerPda(storedSeason, owner))) {
        throw new Error("SeasonPlayer cleanup PDA or Season relationship is invalid");
      }
      if (liveSeason.has(seasonId)) seasonCadenceBlockers.add(seasonId);
      if (archive?.lastSeasonId !== undefined &&
          seasonId <= archive.lastSeasonId &&
          liveSeason.has(seasonId) &&
          liveSeason.get(seasonId)?.status !== "finalized") {
        throw new Error("archived Season was recreated or mutated");
      }
      // Archive requires finalized on-chain; an absent account below the
      // checkpoint is the canonical closed System placeholder accepted by
      // close_season_player.
      const finalized = liveSeason.get(seasonId)?.status === "finalized" ||
        (archive?.lastSeasonId !== undefined &&
          seasonId <= archive.lastSeasonId);
      if (finalized &&
          seasonId >= Math.max(0, currentSeason - KEEPER_RECENT_SEASON_CADENCES)) {
        seasonCandidates.push({ seasonId, owner });
      }
    }

    const allOwners = [
      ...arenaCandidates.map(({ owner }) => owner),
      ...seasonCandidates.map(({ owner }) => owner),
    ];
    const fundingInfos = await this.getMultiple(
      allOwners.map((owner) => playerFundingPda(owner)),
    );
    // A canonical, not-yet-created PDA is a valid close destination: the
    // runtime presents it as an empty System account and the recycled rent
    // creates it. Existing accounts must still be exact System zero-data.
    const validFunding = fundingInfos.map((info) => !info || (!info.executable &&
      info.owner.equals(SystemProgram.programId) && info.data.length === 0));
    let fundingIndex = 0;
    const arenaPlayers = arenaCandidates.flatMap(({ dayId, owner }) => {
      const valid = validFunding[fundingIndex++] ?? false;
      return valid ? [{ dayId, owner, rentRecipient: playerFundingPda(owner) }] : [];
    });
    const seasonPlayers = seasonCandidates.flatMap(({ seasonId, owner }) => {
      const valid = validFunding[fundingIndex++] ?? false;
      return valid ? [{ seasonId, owner, rentRecipient: playerFundingPda(owner) }] : [];
    });
    return {
      arenaPlayers,
      seasonPlayers,
      arenaCadenceBlockers,
      seasonCadenceBlockers,
    };
  }

  private async loadPlayerStates(): Promise<PlayerStateRecord[]> {
    const accounts = await this.scanAccounts(
      "playerState",
      [PROTOCOL_ACCOUNT_VERSION, PLAYER_STATE_ACCOUNT_VERSION],
      MAX_DISCOVERED_PLAYER_STATES,
    );
    return accounts.map((loaded) => {
      const owner = publicKey(loaded.value.owner, "PlayerState owner");
      if (!loaded.address.equals(playerStatePda(owner))) {
        throw new Error("PlayerState PDA is invalid");
      }
      const version = u8(loaded.value.version, "PlayerState version");
      const nextRunId = bigint(loaded.value.nextRunId, "PlayerState next run id");
      let activeRunId = bigint(loaded.value.activeRunId, "PlayerState active run id");
      let campaignActiveRunId = bigint(
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
      if (
        version === PROTOCOL_ACCOUNT_VERSION &&
        activeRunId !== 0n &&
        activeRunMode === "campaign"
      ) {
        if (
          campaignActiveRunId !== 0n ||
          !activeRunDaily.equals(SystemProgram.programId) ||
          activeRunDeadlineAt !== 0 ||
          orphanRunId !== 0n
        ) {
          throw new Error("legacy Campaign reservation is inconsistent");
        }
        campaignActiveRunId = activeRunId;
        activeRunId = 0n;
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
        version,
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
    dailies: readonly { loaded: LoadedAccount; snapshot: DailySnapshot }[],
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
          const ranked = player.activeRunMode === "ranked";
          const cadence = daily
            ? {
              challengeDayId: daily.dayId,
              deadlineDayId: ranked ? daily.dayId : daily.dayId + 1,
            }
            : practiceCadenceFromDeadline(
              player.activeRunMode,
              player.activeRunDaily,
              player.activeRunDeadlineAt,
            );
          const arenaPlayerExists = ranked
            ? await this.loadArenaPlayerExists(player.activeRunDaily, player.owner)
            : false;
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
      mode: "campaign" | "ranked" | "practice";
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
      ? {
        challengeDayId: daily.dayId,
        deadlineDayId: mode === "ranked" ? daily.dayId : daily.dayId + 1,
      }
      : practiceCadenceFromDeadline(mode, dailyAddress, deadlineAt);
    const arenaPlayerExists = mode === "ranked"
      ? await this.loadArenaPlayerExists(dailyAddress, owner)
      : false;
    if (mode === "ranked" && !arenaPlayerExists) {
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

  private async rankedSettlement(
    entries: readonly unknown[],
    potLamports: bigint,
    competition: "daily" | "season",
  ): Promise<SettlementSnapshot> {
    const winners = entries.slice(0, 5).map((entry, index) => ({
      owner: publicKey(record(entry, `${competition} entry`).player, `${competition} winner`),
      rank: index + 1,
    }));
    const plan = winners.length > 0
      ? payoutPlan(potLamports, DAILY_PRIZE_WEIGHTS, winners.length)
      : { payouts: [], paidLamports: 0n, rolloverLamports: potLamports };
    const valid = await this.walletValidity(winners.map(({ owner }) => owner));
    return {
      winners: winners.map(({ owner, rank }, index) => ({
        owner,
        rank,
        payoutLamports: plan.payouts[index] ?? 0n,
        destinationValid: valid[index] ?? false,
      })),
      rolloverLamports: plan.rolloverLamports,
    };
  }

  private async weeklySettlement(
    value: Record<string, unknown>,
    potLamports: bigint,
  ): Promise<SettlementSnapshot> {
    const budgetPlan = equalBudgetPlan(potLamports, 3);
    const positions: Array<Omit<WinnerSnapshot, "destinationValid">> = [];
    const boardFields = ["comboEntries", "actionEntries", "runEntries"] as const;
    for (const [bountyIndex, field] of boardFields.entries()) {
      const board = array(value[field], `WeeklyJackpot ${field}`)
        .map((entry) => record(entry, `WeeklyJackpot ${field} entry`))
        .slice(0, 3);
      const winnerCount = board.findIndex(
        (entry) => bigint(entry.value, "Weekly metric value") === 0n,
      );
      const winners = winnerCount === -1 ? board : board.slice(0, winnerCount);
      const plan = winners.length > 0
        ? payoutPlan(
          budgetPlan.budgets[bountyIndex]!,
          WEEKLY_PRIZE_WEIGHTS,
          winners.length,
        )
        : { payouts: [], paidLamports: 0n, rolloverLamports: budgetPlan.budgets[bountyIndex]! };
      winners.forEach((entry, rank) => positions.push({
        owner: publicKey(entry.player, "Weekly winner"),
        payoutLamports: plan.payouts[rank] ?? 0n,
        rank: rank + 1,
        bountyIndex: bountyIndex as 0 | 1 | 2,
      }));
    }
    const valid = await this.walletValidity(positions.map(({ owner }) => owner));
    const payouts = positions.reduce((sum, winner) => sum + winner.payoutLamports, 0n);
    return {
      winners: positions.map((winner, index) => ({
        ...winner,
        destinationValid: valid[index] ?? false,
      })),
      rolloverLamports: potLamports - payouts,
    };
  }

  private async walletValidity(owners: readonly PublicKey[]): Promise<boolean[]> {
    const infos = await this.getMultiple(owners);
    return infos.map((info) => !!info && !info.executable &&
      info.owner.equals(SystemProgram.programId) && info.data.length === 0);
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
    "weekId",
    "seasonId",
    "arcadeConfig",
    "rulesVersion",
    "contentVersion",
    "catalogHash",
    "rulesHash",
    "mapId",
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
    "seasonEligiblePlayers",
    "entries",
  ],
  weekly: [
    "version",
    "weekId",
    "qualificationStartDay",
    "arcadeConfig",
    "metrics",
    "rulesHash",
    "opensAt",
    "closesAt",
    "finalizedAt",
    "ledger",
    "comboEntries",
    "actionEntries",
    "runEntries",
  ],
  season: [
    "version",
    "seasonId",
    "qualificationStartDay",
    "arcadeConfig",
    "opensAt",
    "closesAt",
    "finalizedAt",
    "ledger",
    "entries",
  ],
} as const;

export function canonicalCadenceResultHash(
  idl: Idl,
  competition: "daily" | "weekly" | "season",
  value: Record<string, unknown>,
): string {
  const definitionName = competition === "daily"
    ? "arenaDaily"
    : competition === "weekly"
      ? "weeklyJackpot"
      : "season";
  const fields = RESULT_FIELDS[competition];
  const definitions = array(
    (idl as unknown as Record<string, unknown>).types,
    "Anchor IDL types",
  );
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
  const syntheticName = `keeper${definitionName}Result`;
  const synthetic = {
    ...(idl as unknown as Record<string, unknown>),
    types: [
      ...definitions,
      {
        name: syntheticName,
        type: { kind: "struct", fields: selected },
      },
    ],
  } as unknown as Idl;
  const encoded = new BorshCoder(synthetic).types.encode(syntheticName, value);
  return createHash("sha256")
    .update(Buffer.from(`zkube-arcade-${competition}-result-v1`, "utf8"))
    .update(encoded)
    .digest("hex");
}

function cadenceRoot(
  competition: "daily" | "weekly" | "season",
  priorRoot: string,
  cadenceId: number,
  resultHash: string,
): string {
  const id = Buffer.alloc(4);
  id.writeUInt32LE(cadenceId);
  return createHash("sha256")
    .update(Buffer.from(`zkube-arcade-${competition}-root-v1`, "utf8"))
    .update(Buffer.from(priorRoot, "hex"))
    .update(id)
    .update(Buffer.from(resultHash, "hex"))
    .digest("hex");
}

function profileSyncMask(
  period: DailySnapshot | WeeklySnapshot | SeasonSnapshot,
): number {
  let mask = 0;
  for (const winner of period.settlement?.winners ?? []) {
    if (winner.payoutLamports === 0n) continue;
    const bit = winner.bountyIndex === undefined
      ? winner.rank - 1
      : winner.bountyIndex * 3 + winner.rank - 1;
    if (!Number.isSafeInteger(bit) || bit < 0 || bit > 8) {
      throw new Error("cadence payout position is invalid");
    }
    mask |= 1 << bit;
  }
  return mask;
}

function canonicalJsonString(value: unknown): string {
  return JSON.stringify(sortCanonicalJson(value));
}

function sortCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortCanonicalJson(child)]));
  }
  return value;
}

function practiceCadenceFromDeadline(
  mode: "campaign" | "ranked" | "practice",
  dailyAddress: PublicKey,
  deadlineAt: number,
): { challengeDayId: number; deadlineDayId: number } {
  if (mode !== "practice") {
    throw new Error("ActiveRun references an undiscovered Daily");
  }
  const deadlineDayId = Math.floor(deadlineAt / SECONDS_PER_DAY);
  const challengeDayId = deadlineDayId - 1;
  if (challengeDayId < 0 ||
      ![
        DAILY_RUN_CLOSE_OFFSET,
        LEGACY_DAILY_RUN_CLOSE_OFFSET,
      ].includes(deadlineAt - deadlineDayId * SECONDS_PER_DAY) ||
      !dailyAddress.equals(arenaDailyPda(challengeDayId))) {
    throw new Error("Practice ActiveRun closed-Daily cadence is invalid");
  }
  return { challengeDayId, deadlineDayId };
}

function validDailyWindow(
  dayStart: number,
  entriesCloseAt: number,
  runsCloseAt: number,
): boolean {
  return (entriesCloseAt === dayStart + DAILY_ENTRY_CLOSE_OFFSET &&
      runsCloseAt === dayStart + DAILY_RUN_CLOSE_OFFSET) ||
    (entriesCloseAt === dayStart + LEGACY_DAILY_ENTRY_CLOSE_OFFSET &&
      runsCloseAt === dayStart + LEGACY_DAILY_RUN_CLOSE_OFFSET);
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

function runMode(value: unknown, label: string): "campaign" | "ranked" | "practice" {
  const variant = enumVariant(value, label);
  if (variant === "campaign") return "campaign";
  if (variant === "daily") return "ranked";
  if (variant === "practice") return "practice";
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

function u16(value: unknown, label: string): number {
  const parsed = safeInteger(value, label);
  if (parsed > 0xffff) throw new Error(`${label} is outside u16`);
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
  const bytes = value instanceof Uint8Array
    ? value
    : Array.isArray(value) && value.length === 32 &&
        value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ? Uint8Array.from(value as number[])
      : undefined;
  if (!bytes || bytes.length !== 32) throw new Error(`${label} is not 32 bytes`);
  return Buffer.from(bytes).toString("hex");
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

function checkedNext(value: number, label: string): number {
  assertCadenceId(value, label);
  if (value === 0xffff_ffff) throw new Error(`${label} successor overflows u32`);
  return value + 1;
}

function requiredRulesCatalog(value: PublicKey | undefined): PublicKey {
  if (!value) throw new Error("IDL materializer has no validated rules catalog");
  return value;
}

function requiredOwner(value: PublicKey | undefined): PublicKey {
  if (!value) throw new Error("IDL materializer is missing run/player owner");
  return value;
}

function requiredWeeklyQualificationDays(
  context: KeeperPlanContext,
  weekId: number,
): readonly number[] {
  const start = requiredNumber(context.qualificationStartDay, "Weekly qualification start");
  const last = weekStartDay(weekId) + DAYS_PER_WEEK - 1;
  if (context.finalDayId !== last || start < weekStartDay(weekId) || start > last ||
      !context.qualificationDayIds ||
      context.qualificationDayIds.length !== last - start + 1 ||
      context.qualificationDayIds.some((dayId, index) => dayId !== start + index)) {
    throw new Error("IDL materializer rejects Weekly qualification accounts");
  }
  return context.qualificationDayIds;
}

function writableRemaining(
  owners: readonly PublicKey[] | undefined,
): RemainingAccountMeta[] {
  return (owners ?? []).map((pubkey) => ({ pubkey, isWritable: true }));
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
