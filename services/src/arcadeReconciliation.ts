import { PublicKey } from "@solana/web3.js";

import {
  DAILY_ENTRY_CLOSE_OFFSET,
  DAILY_PRIZE_WEIGHTS,
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  DAYS_PER_SEASON,
  DAYS_PER_WEEK,
  KEEPER_RECENT_DAILY_CADENCES,
  KEEPER_RECENT_SEASON_CADENCES,
  KEEPER_RECENT_WEEKLY_CADENCES,
  PERIOD_SETTLEMENT_DELAY_SECONDS,
  RUN_RECOVERY_SECONDS,
  SECONDS_PER_DAY,
  SOL_PAYOUT_UNIT_LAMPORTS,
  WEEKLY_PRIZE_WEIGHTS,
  assertCadenceId,
  assertLamports,
  assertPayoutLamports,
  assertSafeTimestamp,
  currentDayId,
  arcadeArchivePda,
  cadenceFundingPda,
  playerFundingPda,
  seasonIdForDay,
  seasonStartDay,
  validationOnlyPlan,
  weekIdForDay,
  weekStartDay,
  type CompetitionKind,
  type KeeperInstructionPlan,
  type RunMode,
} from "./arcadeChain.js";

export type PeriodStatus = "funding" | "open" | "finalized";
const LEGACY_DAILY_RUN_CLOSE_OFFSET = 23 * 60 * 60 + 30 * 60;
export type RunLifecycle =
  | "prepared"
  | "delegated"
  | "awaiting_vrf"
  | "playing"
  | "terminal"
  | "unavailable";
export type RunLocation = "base" | "ephemeral_rollup" | "unavailable";

export interface WinnerSnapshot {
  owner: PublicKey;
  payoutLamports: bigint;
  rank: number;
  /** Present only for the three Weekly skill boards. */
  bountyIndex?: 0 | 1 | 2;
  /** True only after validating a zero-data System-owned wallet account. */
  destinationValid: boolean;
}

export interface SettlementSnapshot {
  winners: readonly WinnerSnapshot[];
  rolloverLamports: bigint;
}

export interface DailySnapshot {
  dayId: number;
  status: PeriodStatus;
  runsCloseAt: number;
  recoveryDeadlineAt: number;
  entriesPaid: bigint;
  entriesScored: bigint;
  entriesExpired: bigint;
  potLamports: bigint;
  predecessorRolloverRequired: boolean;
  predecessorRolloverApplied: boolean;
  seasonEligiblePlayers: number;
  seasonRollups: number;
  seasonRollupSealed: boolean;
  /** Finalized payout positions already reflected in durable PlayerState profiles. */
  profileSyncMask: number;
  settlement?: SettlementSnapshot;
}

export interface WeeklySnapshot {
  weekId: number;
  qualificationStartDay: number;
  status: PeriodStatus;
  closesAt: number;
  potLamports: bigint;
  predecessorRolloverRequired: boolean;
  predecessorRolloverApplied: boolean;
  qualificationDailiesComplete: boolean;
  /** Nine bits: three ranks for each of the three skill boards. */
  profileSyncMask: number;
  settlement?: SettlementSnapshot;
}

export interface SeasonSnapshot {
  seasonId: number;
  qualificationStartDay: number;
  status: PeriodStatus;
  closesAt: number;
  potLamports: bigint;
  predecessorRolloverRequired: boolean;
  predecessorRolloverApplied: boolean;
  sealedDailies: number;
  /** Finalized payout positions already reflected in durable PlayerState profiles. */
  profileSyncMask: number;
  settlement?: SettlementSnapshot;
}

export interface DailySeasonPlayerSnapshot {
  dayId: number;
  owner: PublicKey;
  dailyResolved: boolean;
  hasBestScore: boolean;
  seasonRolled: boolean;
  seasonPlayerExists: boolean;
}

export interface ArenaPlayerClosureSnapshot {
  dayId: number;
  owner: PublicKey;
  rentRecipient: PublicKey;
}

export interface SeasonPlayerClosureSnapshot {
  seasonId: number;
  owner: PublicKey;
  rentRecipient: PublicKey;
}

export interface RunSnapshot {
  owner: PublicKey;
  runId: bigint;
  mode: RunMode;
  /** Required for ranked and Practice, absent for Campaign. */
  challengeDayId?: number;
  /** Ranked uses its challenge day; Practice uses the following UTC day. */
  deadlineDayId?: number;
  arenaPlayerExists: boolean;
  lifecycle: RunLifecycle;
  location: RunLocation;
  acceptedActions: number;
  runsCloseAt?: number;
  recoveryDeadlineAt?: number;
  /** False means durable state has moved this id to the orphan reservation. */
  reservationActive: boolean;
}

export interface ArcadeArchiveSnapshot {
  address: PublicKey;
  cadenceFunding: PublicKey;
  lastDailyId?: number;
  lastWeeklyId?: number;
  lastSeasonId?: number;
}

export interface CadenceArchiveCandidate {
  competition: CompetitionKind;
  cadenceId: number;
  /** Canonical archive JSON carrying the exact result bytes/hash contract. */
  canonicalJson: string;
  fileSha256: string;
  resultHash: string;
  requiredProfileSyncMask: number;
  /** True only after relationship-checking the on-chain ArcadeArchive root. */
  committed: boolean;
  /** Includes every protocol close gate and absence of a live dependency. */
  closeEligible: boolean;
  closeEligibleAt: number;
}

export interface ProtocolSnapshot {
  paused: boolean;
  launchDayId: number;
  rulesCatalog: PublicKey;
  dailies: readonly DailySnapshot[];
  weeklies: readonly WeeklySnapshot[];
  seasons: readonly SeasonSnapshot[];
  runs: readonly RunSnapshot[];
  dailySeasonPlayers: readonly DailySeasonPlayerSnapshot[];
  /** Relationship-checked canonical PlayerState owners available for profile sync. */
  playerStateOwners: readonly PublicKey[];
  arenaPlayerClosures: readonly ArenaPlayerClosureSnapshot[];
  seasonPlayerClosures: readonly SeasonPlayerClosureSnapshot[];
  /** Present only when the deployed archive ABI has been fully validated. */
  archiveState?: ArcadeArchiveSnapshot;
  archiveCandidates?: readonly CadenceArchiveCandidate[];
}

export interface DomainQuarantine {
  kind: CompetitionKind;
  id: number;
  reason: string;
}

export interface ReconciliationDiscovery {
  plans: KeeperInstructionPlan[];
  quarantines: DomainQuarantine[];
}

export const EMPTY_PROTOCOL_SNAPSHOT: ProtocolSnapshot = Object.freeze({
  paused: true,
  launchDayId: 4,
  rulesCatalog: PublicKey.default,
  dailies: Object.freeze([]),
  weeklies: Object.freeze([]),
  seasons: Object.freeze([]),
  runs: Object.freeze([]),
  dailySeasonPlayers: Object.freeze([]),
  playerStateOwners: Object.freeze([]),
  arenaPlayerClosures: Object.freeze([]),
  seasonPlayerClosures: Object.freeze([]),
  archiveCandidates: Object.freeze([]),
});

/**
 * Produces non-executable semantic plans from an already decoded and
 * relationship-checked protocol snapshot.
 */
export function discoverReconciliation(args: {
  snapshot: ProtocolSnapshot;
  nowUnix: number;
}): ReconciliationDiscovery {
  assertSafeTimestamp(args.nowUnix);
  validateProtocolSnapshot(args.snapshot);
  const quarantines = collectDomainQuarantines(args.snapshot);

  const plans: KeeperInstructionPlan[] = [];
  const today = currentDayId(args.nowUnix);
  const thisWeek = weekIdForDay(today);
  const thisSeason = seasonIdForDay(today);
  const oldestKeeperDay = Math.max(0, today - KEEPER_RECENT_DAILY_CADENCES);
  const oldestKeeperWeek = Math.max(0, thisWeek - KEEPER_RECENT_WEEKLY_CADENCES);
  const oldestKeeperSeason = Math.max(0, thisSeason - KEEPER_RECENT_SEASON_CADENCES);
  const dailyById = new Map(args.snapshot.dailies.map((value) => [value.dayId, value]));
  const weeklyById = new Map(args.snapshot.weeklies.map((value) => [value.weekId, value]));
  const seasonById = new Map(args.snapshot.seasons.map((value) => [value.seasonId, value]));
  const playerStateOwners = new Set(
    args.snapshot.playerStateOwners.map((owner) => owner.toBase58()),
  );
  const isQuarantined = (kind: CompetitionKind, id: number) =>
    quarantines.some((record) => record.kind === kind && record.id === id);
  appendCadenceArchivePlans(
    plans,
    args.snapshot,
    today,
    thisWeek,
    thisSeason,
    isQuarantined,
  );

  if (!args.snapshot.paused) {
    for (const daily of args.snapshot.dailies) {
      if (daily.status !== "funding") continue;
      if (daily.dayId === today &&
          args.nowUnix < today * SECONDS_PER_DAY + DAILY_ENTRY_CLOSE_OFFSET) {
        plans.push(validationOnlyPlan("activate_arena_daily", { dayId: today }));
      } else if (daily.dayId === today + 1) {
        plans.push(validationOnlyPlan("activate_arena_daily", {
          dayId: daily.dayId,
          preactivation: true,
        }));
      } else if (daily.dayId >= oldestKeeperDay && daily.dayId < today &&
          daily.predecessorRolloverApplied &&
          args.nowUnix >= daily.recoveryDeadlineAt) {
        plans.push(validationOnlyPlan("activate_arena_daily", {
          dayId: daily.dayId,
          predecessorRolloverApplied: true,
          recoveryActivation: true,
          recoveryDeadlineAt: daily.recoveryDeadlineAt,
        }));
      }
    }
    for (const weekly of args.snapshot.weeklies) {
      if (weekly.status !== "funding") continue;
      if (weekly.weekId === thisWeek) {
        plans.push(validationOnlyPlan("activate_weekly_jackpot", { weekId: thisWeek }));
      } else if (weekly.weekId === thisWeek + 1) {
        plans.push(validationOnlyPlan("activate_weekly_jackpot", {
          weekId: weekly.weekId,
          preactivation: true,
        }));
      } else if (weekly.weekId >= oldestKeeperWeek && weekly.weekId < thisWeek &&
          weekly.predecessorRolloverApplied &&
          args.nowUnix >= weekly.closesAt + PERIOD_SETTLEMENT_DELAY_SECONDS) {
        plans.push(validationOnlyPlan("activate_weekly_jackpot", {
          weekId: weekly.weekId,
          predecessorRolloverApplied: true,
          recoveryActivation: true,
          deadlineAt: weekly.closesAt,
        }));
      }
    }
    for (const season of args.snapshot.seasons) {
      if (season.status !== "funding") continue;
      if (season.seasonId === thisSeason) {
        plans.push(validationOnlyPlan("activate_season", { seasonId: thisSeason }));
      } else if (season.seasonId === thisSeason + 1) {
        plans.push(validationOnlyPlan("activate_season", {
          seasonId: season.seasonId,
          preactivation: true,
        }));
      } else if (season.seasonId >= oldestKeeperSeason && season.seasonId < thisSeason &&
          season.predecessorRolloverApplied &&
          args.nowUnix >= season.closesAt + PERIOD_SETTLEMENT_DELAY_SECONDS) {
        plans.push(validationOnlyPlan("activate_season", {
          seasonId: season.seasonId,
          predecessorRolloverApplied: true,
          recoveryActivation: true,
          deadlineAt: season.closesAt,
        }));
      }
    }
  }

  const missingDay = firstMissingCadence(
    args.snapshot.launchDayId,
    today + 1,
    dailyById,
    args.snapshot.archiveState?.lastDailyId,
  );
  if (missingDay !== undefined && missingDay >= oldestKeeperDay) {
    plans.push(validationOnlyPlan("prepare_arena_daily", {
      dayId: missingDay - 1,
      followingDayId: missingDay,
      launchCadenceId: args.snapshot.launchDayId,
      rulesCatalog: args.snapshot.rulesCatalog,
      cadenceFunding: cadenceFundingPda(),
    }));
  }
  const launchWeek = weekIdForDay(args.snapshot.launchDayId);
  const missingWeek = firstMissingCadence(
    launchWeek,
    thisWeek + 1,
    weeklyById,
    args.snapshot.archiveState?.lastWeeklyId,
  );
  if (missingWeek !== undefined && missingWeek >= oldestKeeperWeek) {
    plans.push(validationOnlyPlan("prepare_weekly_jackpot", {
      weekId: missingWeek - 1,
      followingWeekId: missingWeek,
      launchCadenceId: launchWeek,
      rulesCatalog: args.snapshot.rulesCatalog,
      cadenceFunding: cadenceFundingPda(),
    }));
  }
  const launchSeason = seasonIdForDay(args.snapshot.launchDayId);
  const missingSeason = firstMissingCadence(
    launchSeason,
    thisSeason + 1,
    seasonById,
    args.snapshot.archiveState?.lastSeasonId,
  );
  if (missingSeason !== undefined && missingSeason >= oldestKeeperSeason) {
    plans.push(validationOnlyPlan("prepare_season", {
      seasonId: missingSeason - 1,
      followingSeasonId: missingSeason,
      launchCadenceId: launchSeason,
      cadenceFunding: cadenceFundingPda(),
    }));
  }

  for (const run of args.snapshot.runs) {
    if (run.mode === "campaign" ||
        (run.challengeDayId !== undefined && run.challengeDayId >= oldestKeeperDay)) {
      appendRunPlan(plans, run, args.nowUnix);
    }
  }

  const initializedSeasonPlayers = new Set<string>();
  for (const player of args.snapshot.dailySeasonPlayers) {
    if (player.dayId < oldestKeeperDay) continue;
    const daily = dailyById.get(player.dayId);
    if (daily?.status !== "finalized" || !player.dailyResolved ||
        !player.hasBestScore || player.seasonRolled) continue;
    const seasonId = seasonIdForDay(player.dayId);
    const season = seasonById.get(seasonId);
    if (!season || player.dayId < season.qualificationStartDay) continue;
    if (isQuarantined("daily", player.dayId) ||
        isQuarantined("season", seasonId)) continue;
    const key = `${seasonId}:${player.owner.toBase58()}`;
    if (!player.seasonPlayerExists) {
      if (!initializedSeasonPlayers.has(key)) {
        plans.push(validationOnlyPlan("initialize_season_player", {
          seasonId,
          owner: player.owner,
        }));
        initializedSeasonPlayers.add(key);
      }
      continue;
    }
    plans.push(validationOnlyPlan("rollup_arena_to_season", {
      dayId: player.dayId,
      seasonId,
      qualificationStartDay: season.qualificationStartDay,
      owner: player.owner,
    }));
  }

  for (const daily of args.snapshot.dailies) {
    if (daily.dayId < oldestKeeperDay) continue;
    if (isQuarantined("daily", daily.dayId)) continue;
    const resolved = daily.entriesScored + daily.entriesExpired;
    appendFinalizationPlan(
      plans,
      "daily",
      daily.dayId,
      daily.status === "open" && args.nowUnix >= daily.runsCloseAt &&
        resolved === daily.entriesPaid &&
        (!daily.predecessorRolloverRequired || daily.predecessorRolloverApplied),
      daily.settlement,
      dailyById.has(daily.dayId + 1),
    );
    const dailySeason = seasonById.get(seasonIdForDay(daily.dayId));
    if (daily.status === "finalized" && dailySeason &&
        daily.dayId >= dailySeason.qualificationStartDay &&
        !daily.seasonRollupSealed &&
        daily.seasonRollups === daily.seasonEligiblePlayers) {
      plans.push(validationOnlyPlan("seal_arena_season_rollups", {
        dayId: daily.dayId,
        seasonId: seasonIdForDay(daily.dayId),
        qualificationStartDay: dailySeason.qualificationStartDay,
      }));
    }
    appendProfileSyncPlans(
      plans,
      "daily",
      daily.dayId,
      daily.status,
      daily.settlement,
      daily.profileSyncMask,
      playerStateOwners,
    );
  }

  for (const weekly of args.snapshot.weeklies) {
    if (weekly.weekId < oldestKeeperWeek) continue;
    if (isQuarantined("weekly", weekly.weekId)) continue;
    const finalQualifiedDay = weekStartDay(weekly.weekId) + DAYS_PER_WEEK - 1;
    appendFinalizationPlan(
      plans,
      "weekly",
      weekly.weekId,
      weekly.status === "open" &&
        args.nowUnix >= weekly.closesAt + PERIOD_SETTLEMENT_DELAY_SECONDS &&
        weekly.qualificationDailiesComplete &&
        weeklyArchiveCheckpointComplete(args.snapshot, weekly) &&
        (!weekly.predecessorRolloverRequired || weekly.predecessorRolloverApplied),
      weekly.settlement,
      weeklyById.has(weekly.weekId + 1),
      finalQualifiedDay,
      undefined,
      weekly.qualificationStartDay,
      cadenceRange(
        weekly.qualificationStartDay,
        finalQualifiedDay,
      ),
      args.snapshot.archiveState?.lastDailyId,
    );
    appendProfileSyncPlans(
      plans,
      "weekly",
      weekly.weekId,
      weekly.status,
      weekly.settlement,
      weekly.profileSyncMask,
      playerStateOwners,
    );
  }

  for (const season of args.snapshot.seasons) {
    const requiredSeals = seasonRequiredDailies(season);
    if (season.seasonId < oldestKeeperSeason) continue;
    if (isQuarantined("season", season.seasonId)) continue;
    appendFinalizationPlan(
      plans,
      "season",
      season.seasonId,
      season.status === "open" &&
        args.nowUnix >= season.closesAt + PERIOD_SETTLEMENT_DELAY_SECONDS &&
        season.sealedDailies === requiredSeals &&
        qualificationDailies(
          args.snapshot,
          season.qualificationStartDay,
          requiredSeals,
          true,
        ) &&
        (!season.predecessorRolloverRequired || season.predecessorRolloverApplied),
      season.settlement,
      seasonById.has(season.seasonId + 1),
      undefined,
      season.sealedDailies,
      season.qualificationStartDay,
    );
    appendProfileSyncPlans(
      plans,
      "season",
      season.seasonId,
      season.status,
      season.settlement,
      season.profileSyncMask,
      playerStateOwners,
    );
  }

  for (const candidate of args.snapshot.arenaPlayerClosures) {
    if (candidate.dayId < oldestKeeperDay) continue;
    if (isQuarantined("daily", candidate.dayId)) continue;
    plans.push(validationOnlyPlan("close_arena_player", {
      dayId: candidate.dayId,
      owner: candidate.owner,
      rentRecipient: candidate.rentRecipient,
    }));
  }
  for (const candidate of args.snapshot.seasonPlayerClosures) {
    if (candidate.seasonId < oldestKeeperSeason) continue;
    if (isQuarantined("season", candidate.seasonId)) continue;
    plans.push(validationOnlyPlan("close_season_player", {
      seasonId: candidate.seasonId,
      owner: candidate.owner,
      rentRecipient: candidate.rentRecipient,
    }));
  }
  return {
    plans: plans.filter((plan) =>
      !planTouchesQuarantine(plan, quarantines)),
    quarantines,
  };
}

export function discoverReconciliationPlans(args: {
  snapshot: ProtocolSnapshot;
  nowUnix: number;
}): KeeperInstructionPlan[] {
  return discoverReconciliation(args).plans;
}

function appendCadenceArchivePlans(
  plans: KeeperInstructionPlan[],
  snapshot: ProtocolSnapshot,
  today: number,
  currentWeek: number,
  currentSeason: number,
  isQuarantined: (kind: CompetitionKind, id: number) => boolean,
): void {
  const state = snapshot.archiveState;
  const candidates = snapshot.archiveCandidates ?? [];
  if (!state || candidates.length === 0) return;
  const lastByKind: Record<CompetitionKind, number | undefined> = {
    daily: state.lastDailyId,
    weekly: state.lastWeeklyId,
    season: state.lastSeasonId,
  };
  const currentByKind: Record<CompetitionKind, number> = {
    daily: today,
    weekly: currentWeek,
    season: currentSeason,
  };
  for (const kind of ["daily", "weekly", "season"] as const) {
    const ordered = candidates
      .filter((candidate) => candidate.competition === kind)
      .sort((left, right) => left.cadenceId - right.cadenceId);
    const last = lastByKind[kind];
    const next = ordered.find((candidate) =>
      candidate.committed
        ? candidate.cadenceId === last
        : last === undefined || candidate.cadenceId === last + 1
    );
    if (!next || next.cadenceId > currentByKind[kind]) continue;
    if (isQuarantined(kind, next.cadenceId)) continue;
    const identity = kind === "daily"
      ? { dayId: next.cadenceId }
      : kind === "weekly"
        ? { weekId: next.cadenceId }
        : { seasonId: next.cadenceId };
    const context = {
      competition: kind,
      ...identity,
      previousCadenceId: last,
      cadenceFunding: state.cadenceFunding,
      arcadeArchive: state.address,
      archiveCanonicalJson: next.canonicalJson,
      archiveFileSha256: next.fileSha256,
      archiveResultHash: next.resultHash,
      archiveCommitted: next.committed,
      requiredProfileSyncMask: next.requiredProfileSyncMask,
      closeEligibleAt: next.closeEligibleAt,
    };
    if (!next.committed) {
      if (kind === "daily") {
        const daily = snapshot.dailies.find(({ dayId }) =>
          dayId === next.cadenceId);
        if (!daily?.seasonRollupSealed) continue;
      }
      plans.push(validationOnlyPlan(
        kind === "daily"
          ? "archive_arena_daily"
          : kind === "weekly"
            ? "archive_weekly_jackpot"
            : "archive_season",
        context,
      ));
    } else if (next.closeEligible) {
      plans.push(validationOnlyPlan(
        kind === "daily"
          ? "close_arena_daily"
          : kind === "weekly"
            ? "close_weekly_jackpot"
            : "close_season",
        context,
      ));
    }
  }
}

function appendRunPlan(
  plans: KeeperInstructionPlan[],
  run: RunSnapshot,
  nowUnix: number,
): void {
  const inProgress = ["prepared", "delegated", "awaiting_vrf", "playing"]
    .includes(run.lifecycle);
  const forceFinishEligible = ["delegated", "awaiting_vrf", "playing"]
    .includes(run.lifecycle);
  const context = {
    challengeDayId: run.challengeDayId,
    deadlineDayId: run.deadlineDayId,
    owner: run.owner,
    runId: run.runId,
    runMode: run.mode,
    runLocation: run.location,
    includeArenaPlayer: run.arenaPlayerExists,
    deadlineAt: run.runsCloseAt,
    recoveryDeadlineAt: run.recoveryDeadlineAt,
  } as const;

  if (run.mode !== "campaign" && forceFinishEligible &&
      run.location === "ephemeral_rollup" && run.runsCloseAt !== undefined &&
      nowUnix >= run.runsCloseAt) {
    plans.push(validationOnlyPlan("force_finish_deadline", context));
    return;
  }
  if (run.mode !== "campaign" && run.reservationActive &&
      (inProgress || run.lifecycle === "unavailable") &&
      run.recoveryDeadlineAt !== undefined && nowUnix >= run.recoveryDeadlineAt) {
    plans.push(validationOnlyPlan(
      run.mode === "practice"
        ? "expire_unresolved_practice_run"
        : "expire_unresolved_arena_run", {
      ...context,
      includeArenaPlayer: run.mode === "ranked",
    }));
    return;
  }
  if (run.lifecycle === "terminal" && run.location === "ephemeral_rollup") {
    plans.push(validationOnlyPlan("commit_run", context));
    return;
  }
  if (run.reservationActive && run.lifecycle === "terminal" && run.location === "base") {
    const operation = run.mode === "campaign"
      ? "consume_campaign_run"
      : run.mode === "ranked"
        ? "consume_arena_run"
        : "consume_practice_run";
    plans.push(validationOnlyPlan(operation, context));
    return;
  }
  if (!run.reservationActive && run.location === "base" &&
      run.recoveryDeadlineAt !== undefined && nowUnix >= run.recoveryDeadlineAt) {
    plans.push(validationOnlyPlan("cleanup_orphan_active_run", context));
  }
}

export function validateProtocolSnapshot(snapshot: ProtocolSnapshot): void {
  if (typeof snapshot.paused !== "boolean") {
    throw new Error("protocol pause state is invalid");
  }
  if (!(snapshot.rulesCatalog instanceof PublicKey) ||
      snapshot.rulesCatalog.equals(PublicKey.default)) {
    throw new Error("rules catalog identity is invalid");
  }
  assertCadenceId(snapshot.launchDayId, "launch day id");
  const launchWeekId = weekIdForDay(snapshot.launchDayId);
  const launchSeasonId = seasonIdForDay(snapshot.launchDayId);
  assertUnique(snapshot.dailies.map(({ dayId }) => dayId), "Daily id");
  assertUnique(snapshot.weeklies.map(({ weekId }) => weekId), "Weekly id");
  assertUnique(snapshot.seasons.map(({ seasonId }) => seasonId), "Season id");
  assertUnique(snapshot.runs.map(({ owner, runId }) => `${owner.toBase58()}:${runId}`), "run");
  assertUnique(
    snapshot.dailySeasonPlayers.map(({ dayId, owner }) => `${dayId}:${owner.toBase58()}`),
    "ArenaPlayer",
  );
  assertUnique(
    snapshot.playerStateOwners.map((owner) => owner.toBase58()),
    "PlayerState owner",
  );
  assertUnique(
    snapshot.arenaPlayerClosures.map(({ dayId, owner }) =>
      `${dayId}:${owner.toBase58()}`),
    "ArenaPlayer closure",
  );
  assertUnique(
    snapshot.seasonPlayerClosures.map(({ seasonId, owner }) =>
      `${seasonId}:${owner.toBase58()}`),
    "SeasonPlayer closure",
  );
  validateArchiveSnapshot(snapshot);

  for (const daily of snapshot.dailies) {
    assertCadenceId(daily.dayId, "day id");
    assertSafeTimestamp(daily.runsCloseAt);
    assertSafeTimestamp(daily.recoveryDeadlineAt);
    const start = daily.dayId * SECONDS_PER_DAY;
    const currentWindow =
      daily.runsCloseAt === start + DAILY_RUN_CLOSE_OFFSET &&
      daily.recoveryDeadlineAt === start + DAILY_RECOVERY_DEADLINE_OFFSET;
    const legacyWindow =
      daily.runsCloseAt === start + LEGACY_DAILY_RUN_CLOSE_OFFSET &&
      daily.recoveryDeadlineAt ===
        start + LEGACY_DAILY_RUN_CLOSE_OFFSET + RUN_RECOVERY_SECONDS;
    if (!currentWindow && !legacyWindow) {
      throw new Error("Daily timing does not match its cadence id");
    }
    validatePredecessorFlag(
      daily.dayId !== snapshot.launchDayId,
      daily.predecessorRolloverRequired,
      "Daily",
    );
    for (const [label, amount] of Object.entries({
      entriesPaid: daily.entriesPaid,
      entriesScored: daily.entriesScored,
      entriesExpired: daily.entriesExpired,
      pot: daily.potLamports,
    })) assertLamports(amount, `Daily ${label}`);
    if (daily.entriesScored + daily.entriesExpired > daily.entriesPaid) {
      throw new Error("Daily resolved entries exceed paid entries");
    }
    assertCounter(daily.seasonEligiblePlayers, "Daily Season eligible players");
    assertCounter(daily.seasonRollups, "Daily Season rollups");
  }

  for (const weekly of snapshot.weeklies) {
    assertCadenceId(weekly.weekId, "week id");
    assertSafeTimestamp(weekly.closesAt);
    if (weekly.closesAt !== (weekStartDay(weekly.weekId) + DAYS_PER_WEEK) * SECONDS_PER_DAY) {
      throw new Error("Weekly close does not match its cadence id");
    }
    const expectedQualificationStart = weekly.weekId === launchWeekId
      ? snapshot.launchDayId
      : weekStartDay(weekly.weekId);
    if (weekly.qualificationStartDay !== expectedQualificationStart) {
      throw new Error("Weekly qualification start is invalid");
    }
    validatePredecessorFlag(
      weekly.weekId !== launchWeekId,
      weekly.predecessorRolloverRequired,
      "Weekly",
    );
    assertLamports(weekly.potLamports, "Weekly pot");
  }

  for (const season of snapshot.seasons) {
    assertCadenceId(season.seasonId, "season id");
    assertSafeTimestamp(season.closesAt);
    if (season.closesAt !==
        (seasonStartDay(season.seasonId) + DAYS_PER_SEASON) * SECONDS_PER_DAY) {
      throw new Error("Season close does not match its cadence id");
    }
    const expectedQualificationStart = season.seasonId === launchSeasonId
      ? snapshot.launchDayId
      : seasonStartDay(season.seasonId);
    if (season.qualificationStartDay !== expectedQualificationStart) {
      throw new Error("Season qualification start is invalid");
    }
    validatePredecessorFlag(
      season.seasonId !== launchSeasonId,
      season.predecessorRolloverRequired,
      "Season",
    );
    assertLamports(season.potLamports, "Season pot");
    if (!Number.isSafeInteger(season.sealedDailies) || season.sealedDailies < 0 ||
        season.sealedDailies > DAYS_PER_SEASON) {
      throw new Error("Season sealed Dailies count is invalid");
    }
  }

  for (const run of snapshot.runs) validateRun(snapshot, run);
  validateDailySeasonPlayers(snapshot);
  validateParticipantClosures(snapshot);
}

function collectDomainQuarantines(
  snapshot: ProtocolSnapshot,
): DomainQuarantine[] {
  const quarantines: DomainQuarantine[] = [];
  const quarantine = (
    kind: CompetitionKind,
    id: number,
    validate: () => void,
  ) => {
    try {
      validate();
    } catch (error) {
      quarantines.push({
        kind,
        id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };

  for (const daily of snapshot.dailies) {
    quarantine("daily", daily.dayId, () => {
      if (daily.status === "finalized" &&
          daily.entriesScored + daily.entriesExpired !== daily.entriesPaid) {
        throw new Error("finalized Daily retains unresolved paid entries");
      }
      if (daily.seasonRollups > daily.seasonEligiblePlayers ||
          (daily.seasonRollupSealed &&
            (daily.status !== "finalized" ||
              daily.seasonRollups !== daily.seasonEligiblePlayers))) {
        throw new Error("Daily Season rollup counters are inconsistent");
      }
      validateSettlement("daily", daily.potLamports, daily.settlement, 5);
      validateProfileSyncMask("daily", daily.profileSyncMask, daily.settlement);
    });
  }

  for (const weekly of snapshot.weeklies) {
    quarantine("weekly", weekly.weekId, () => {
      if (weekly.status === "finalized" &&
          !weekly.qualificationDailiesComplete) {
        throw new Error("finalized Weekly qualification is incomplete");
      }
      if (weekly.status === "finalized" &&
          !weeklyArchiveCheckpointComplete(snapshot, weekly)) {
        throw new Error("finalized Weekly archive checkpoint is incomplete");
      }
      if (weekly.qualificationDailiesComplete &&
          !qualificationDailies(
            snapshot,
            weekly.qualificationStartDay,
            weeklyRequiredDailies(weekly),
            false,
          )) {
        throw new Error("Weekly qualification is incomplete");
      }
      validateSettlement("weekly", weekly.potLamports, weekly.settlement, 9);
      validateProfileSyncMask("weekly", weekly.profileSyncMask, weekly.settlement);
    });
  }

  for (const season of snapshot.seasons) {
    quarantine("season", season.seasonId, () => {
      const requiredDailies = seasonRequiredDailies(season);
      const qualificationCount = seasonQualificationDailies(
        snapshot,
        season.qualificationStartDay,
        requiredDailies,
      );
      if (season.sealedDailies !== qualificationCount) {
        throw new Error("Season qualification is incomplete");
      }
      if (season.status === "finalized" &&
          season.sealedDailies !== requiredDailies) {
        throw new Error("finalized Season qualification is incomplete");
      }
      validateSettlement("season", season.potLamports, season.settlement, 5);
      validateProfileSyncMask("season", season.profileSyncMask, season.settlement);
    });
  }
  return quarantines;
}

function planTouchesQuarantine(
  plan: KeeperInstructionPlan,
  quarantines: readonly DomainQuarantine[],
): boolean {
  if (plan.operation.startsWith("prepare_") ||
      plan.operation.startsWith("activate_")) {
    return false;
  }
  const context = plan.context;
  if (!context) return false;
  // Campaign has no competitive cadence dependency. Ranked and legacy
  // Practice lifecycle writes remain subject to a quarantined Daily so a
  // domain inconsistency can only narrow recurring write authority.
  if (context.runMode === "campaign") return false;
  return quarantines.some(({ kind, id }) => {
    if (kind === "daily") {
      return context.dayId === id ||
        context.challengeDayId === id ||
        context.qualificationDayIds?.includes(id) === true ||
        (context.weekId !== undefined && weekIdForDay(id) === context.weekId) ||
        (context.seasonId !== undefined &&
          seasonIdForDay(id) === context.seasonId);
    }
    if (kind === "weekly") return context.weekId === id;
    return context.seasonId === id;
  });
}

function validateArchiveSnapshot(snapshot: ProtocolSnapshot): void {
  const candidates = snapshot.archiveCandidates ?? [];
  const state = snapshot.archiveState;
  if (candidates.length === 0 && !state) return;
  if (!state || !state.address.equals(arcadeArchivePda()) ||
      !state.cadenceFunding.equals(cadenceFundingPda())) {
    throw new Error("Arcade archive or cadence funding identity is invalid");
  }
  for (const value of [
    state.lastDailyId,
    state.lastWeeklyId,
    state.lastSeasonId,
  ]) {
    if (value !== undefined) assertCadenceId(value, "last archived cadence id");
  }
  assertUnique(
    candidates.map(({ competition, cadenceId }) => `${competition}:${cadenceId}`),
    "cadence archive",
  );
  for (const candidate of candidates) {
    assertCadenceId(candidate.cadenceId, "archive cadence id");
    if (!/^[0-9a-f]{64}$/.test(candidate.fileSha256) ||
        !/^[0-9a-f]{64}$/.test(candidate.resultHash)) {
      throw new Error("cadence archive hashes are invalid");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate.canonicalJson);
    } catch {
      throw new Error("cadence archive JSON is invalid");
    }
    if (JSON.stringify(sortJson(parsed)) !== candidate.canonicalJson) {
      throw new Error("cadence archive JSON is not canonical");
    }
    const period = candidate.competition === "daily"
      ? snapshot.dailies.find(({ dayId }) => dayId === candidate.cadenceId)
      : candidate.competition === "weekly"
        ? snapshot.weeklies.find(({ weekId }) => weekId === candidate.cadenceId)
        : snapshot.seasons.find(({ seasonId }) => seasonId === candidate.cadenceId);
    const maximumMask = candidate.competition === "weekly" ? 0x01ff : 0x001f;
    if (!period || period.status !== "finalized" ||
        !Number.isSafeInteger(candidate.requiredProfileSyncMask) ||
        candidate.requiredProfileSyncMask < 0 ||
        (candidate.requiredProfileSyncMask & ~maximumMask) !== 0) {
      throw new Error("cadence archive candidate is not terminal");
    }
    assertSafeTimestamp(candidate.closeEligibleAt);
    if (candidate.competition === "daily" &&
        candidate.closeEligibleAt < (period as DailySnapshot).runsCloseAt) {
      throw new Error("Daily archive closes before the ranked run deadline");
    }
    if (candidate.closeEligible && (!candidate.committed ||
        period.profileSyncMask !== candidate.requiredProfileSyncMask ||
        (candidate.competition === "daily" &&
          !(period as DailySnapshot).seasonRollupSealed))) {
      throw new Error("uncommitted cadence archive cannot be close eligible");
    }
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]));
  }
  return value;
}

function validateRun(snapshot: ProtocolSnapshot, run: RunSnapshot): void {
  assertLamports(run.runId, "run id");
  if (!["campaign", "ranked", "practice"].includes(run.mode) ||
      !["prepared", "delegated", "awaiting_vrf", "playing", "terminal", "unavailable"]
        .includes(run.lifecycle) ||
      !["base", "ephemeral_rollup", "unavailable"].includes(run.location) ||
      !Number.isSafeInteger(run.acceptedActions) || run.acceptedActions < 0 ||
      (run.lifecycle === "unavailable") !== (run.location === "unavailable")) {
    throw new Error("run state is invalid");
  }
  if (run.mode === "campaign") {
    if (run.challengeDayId !== undefined || run.deadlineDayId !== undefined ||
        run.runsCloseAt !== undefined || run.recoveryDeadlineAt !== undefined ||
        run.arenaPlayerExists) {
      throw new Error("Campaign run carries Arena cadence state");
    }
    return;
  }
  if (run.challengeDayId === undefined || run.deadlineDayId === undefined ||
      run.runsCloseAt === undefined || run.recoveryDeadlineAt === undefined) {
    throw new Error("Arena run is missing cadence state");
  }
  assertCadenceId(run.challengeDayId, "run challenge day id");
  assertCadenceId(run.deadlineDayId, "run deadline day id");
  assertSafeTimestamp(run.runsCloseAt);
  assertSafeTimestamp(run.recoveryDeadlineAt);
  const deadlineStart = run.deadlineDayId * SECONDS_PER_DAY;
  if ((run.mode === "ranked" && run.challengeDayId !== run.deadlineDayId) ||
      (run.mode === "practice" && run.challengeDayId + 1 !== run.deadlineDayId) ||
      (run.mode === "ranked" &&
        !snapshot.dailies.some(({ dayId }) => dayId === run.challengeDayId)) ||
      run.runsCloseAt !== deadlineStart + DAILY_RUN_CLOSE_OFFSET ||
      run.recoveryDeadlineAt !== deadlineStart + DAILY_RECOVERY_DEADLINE_OFFSET ||
      (run.mode === "ranked" && !run.arenaPlayerExists)) {
    throw new Error("Arena run timing or player relationship is invalid");
  }
}

function validateDailySeasonPlayers(snapshot: ProtocolSnapshot): void {
  const seasonPlayerExistence = new Map<string, boolean>();
  for (const player of snapshot.dailySeasonPlayers) {
    assertCadenceId(player.dayId, "ArenaPlayer day id");
    const daily = snapshot.dailies.find(({ dayId }) => dayId === player.dayId);
    if (!daily) {
      const archivedThrough = snapshot.archiveState?.lastDailyId;
      if (archivedThrough !== undefined && player.dayId <= archivedThrough) {
        // Absence below the archive checkpoint means close_arena_daily already
        // succeeded. The on-chain close gate proves the Daily was finalized,
        // Season-sealed, archived, and free of live ArenaPlayer dependencies.
        continue;
      }
      throw new Error("ArenaPlayer references an undiscovered Daily");
    }
    const seasonId = seasonIdForDay(player.dayId);
    const season = snapshot.seasons.find((value) => value.seasonId === seasonId);
    if (!season) {
      throw new Error("ArenaPlayer references an undiscovered Season");
    }
    if (player.dayId < season.qualificationStartDay) {
      throw new Error("ArenaPlayer predates Season qualification");
    }
    if (player.seasonRolled &&
        (!player.dailyResolved || !player.hasBestScore || daily.status !== "finalized")) {
      throw new Error("ArenaPlayer Season rollup state is inconsistent");
    }
    if (daily.seasonRollupSealed && player.hasBestScore && !player.seasonRolled) {
      throw new Error("sealed Daily contains an unrolled ArenaPlayer");
    }
    const key = `${seasonId}:${player.owner.toBase58()}`;
    const prior = seasonPlayerExistence.get(key);
    if (prior !== undefined && prior !== player.seasonPlayerExists) {
      throw new Error("SeasonPlayer existence is inconsistent across Daily snapshots");
    }
    seasonPlayerExistence.set(key, player.seasonPlayerExists);
  }
}

function validateParticipantClosures(snapshot: ProtocolSnapshot): void {
  for (const candidate of snapshot.arenaPlayerClosures) {
    assertCadenceId(candidate.dayId, "ArenaPlayer closure day id");
    const daily = snapshot.dailies.find(({ dayId }) =>
      dayId === candidate.dayId);
    const closed = !daily &&
      snapshot.archiveState?.lastDailyId !== undefined &&
      candidate.dayId <= snapshot.archiveState.lastDailyId;
    if (daily?.status !== "finalized" && !closed) {
      throw new Error("ArenaPlayer closure requires a finalized Daily");
    }
    validateClosureRecipient(candidate.owner, candidate.rentRecipient, "ArenaPlayer");
  }
  for (const candidate of snapshot.seasonPlayerClosures) {
    assertCadenceId(candidate.seasonId, "SeasonPlayer closure Season id");
    const season = snapshot.seasons.find(({ seasonId }) =>
      seasonId === candidate.seasonId);
    const closed = !season &&
      snapshot.archiveState?.lastSeasonId !== undefined &&
      candidate.seasonId <= snapshot.archiveState.lastSeasonId;
    if (season?.status !== "finalized" && !closed) {
      throw new Error("SeasonPlayer closure requires a finalized Season");
    }
    validateClosureRecipient(candidate.owner, candidate.rentRecipient, "SeasonPlayer");
  }
}

function validateClosureRecipient(
  owner: PublicKey,
  rentRecipient: PublicKey,
  label: string,
): void {
  if (!rentRecipient.equals(playerFundingPda(owner))) {
    throw new Error(`${label} closure rent recipient is not canonical`);
  }
}

function appendFinalizationPlan(
  plans: KeeperInstructionPlan[],
  competition: CompetitionKind,
  id: number,
  ready: boolean,
  settlement?: SettlementSnapshot,
  successorExists = false,
  finalDayId?: number,
  sealedDailies?: number,
  qualificationStartDay?: number,
  qualificationDayIds?: readonly number[],
  archiveLastDailyId?: number,
): void {
  if (!ready || !settlement || !successorExists) return;
  const recipients = aggregateWinners(
    canonicalWinnerOrder(competition, settlement.winners)
      .filter(({ payoutLamports }) => payoutLamports > 0n),
  );
  if (recipients.some(({ destinationValid }) => !destinationValid)) return;
  const operation = competition === "daily"
    ? "finalize_arena_daily"
    : competition === "weekly"
      ? "finalize_weekly_jackpot"
      : "finalize_season";
  const payoutTotal = recipients.reduce((sum, winner) => sum + winner.payoutLamports, 0n);
  plans.push(validationOnlyPlan(operation, {
    ...periodContext(competition, id),
    ...successorContext(competition, id),
    ...(finalDayId === undefined ? {} : { finalDayId }),
    ...(sealedDailies === undefined ? {} : { sealedDailies }),
    ...(qualificationStartDay === undefined ? {} : { qualificationStartDay }),
    ...(qualificationDayIds === undefined ? {} : { qualificationDayIds }),
    ...(archiveLastDailyId === undefined ? {} : { archiveLastDailyId }),
    competition,
    owners: recipients.map(({ owner }) => owner),
    payoutLamports: recipients.map(({ payoutLamports }) => payoutLamports),
    payoutTotalLamports: payoutTotal,
    potLamports: payoutTotal + settlement.rolloverLamports,
    rolloverLamports: settlement.rolloverLamports,
  }));
}

function appendProfileSyncPlans(
  plans: KeeperInstructionPlan[],
  competition: CompetitionKind,
  id: number,
  status: PeriodStatus,
  settlement: SettlementSnapshot | undefined,
  syncedMask: number,
  playerStateOwners: ReadonlySet<string>,
): void {
  if (status !== "finalized" || !settlement) return;
  const outstandingByOwner = new Map<string, { owner: PublicKey; mask: number }>();
  for (const winner of settlement.winners) {
    if (winner.payoutLamports === 0n) continue;
    if (!playerStateOwners.has(winner.owner.toBase58())) continue;
    const bit = winnerPositionBit(competition, winner);
    if ((syncedMask & bit) !== 0) continue;
    const key = winner.owner.toBase58();
    const current = outstandingByOwner.get(key);
    if (current) current.mask |= bit;
    else outstandingByOwner.set(key, { owner: winner.owner, mask: bit });
  }
  const operation = competition === "daily"
    ? "sync_daily_profile"
    : competition === "weekly"
      ? "sync_weekly_profile"
      : "sync_season_profile";
  for (const { owner, mask } of outstandingByOwner.values()) {
    plans.push(validationOnlyPlan(operation, {
      ...periodContext(competition, id),
      competition,
      owner,
      winnerPositionMask: mask,
    }));
  }
}

function validateProfileSyncMask(
  competition: CompetitionKind,
  syncedMask: number,
  settlement: SettlementSnapshot | undefined,
): void {
  const maximumMask = competition === "weekly" ? 0x01ff : 0x001f;
  if (!Number.isSafeInteger(syncedMask) || syncedMask < 0 ||
      (syncedMask & ~maximumMask) !== 0) {
    throw new Error(`${competition} profile sync mask is invalid`);
  }
  if (syncedMask === 0) return;
  if (!settlement) {
    throw new Error(`${competition} profile sync mask has no finalized settlement`);
  }
  const winnerMask = settlement.winners.reduce(
    (mask, winner) => winner.payoutLamports > 0n
      ? mask | winnerPositionBit(competition, winner)
      : mask,
    0,
  );
  if ((syncedMask & ~winnerMask) !== 0) {
    throw new Error(`${competition} profile sync mask references a non-winner`);
  }
}

function winnerPositionBit(
  competition: CompetitionKind,
  winner: WinnerSnapshot,
): number {
  if (competition === "weekly") {
    if (winner.bountyIndex === undefined) {
      throw new Error("Weekly payout position is missing a bounty index");
    }
    return 1 << (winner.bountyIndex * 3 + winner.rank - 1);
  }
  return 1 << (winner.rank - 1);
}

function validateSettlement(
  competition: CompetitionKind,
  potLamports: bigint,
  settlement: SettlementSnapshot | undefined,
  maximumPositions: number,
): void {
  if (!settlement) return;
  if (settlement.winners.length > maximumPositions) {
    throw new Error(`${competition} has too many payout positions`);
  }
  if (competition !== "weekly") {
    assertUnique(settlement.winners.map(({ owner }) => owner.toBase58()), `${competition} winner`);
  }
  for (const winner of settlement.winners) {
    if (!Number.isSafeInteger(winner.rank) || winner.rank < 1 ||
        winner.rank > (competition === "weekly" ? 3 : 5)) {
      throw new Error(`${competition} winner rank is invalid`);
    }
    assertPayoutLamports(winner.payoutLamports, `${competition} payout`);
  }
  aggregateWinners(settlement.winners);
  assertLamports(settlement.rolloverLamports, `${competition} rollover`);
  const payouts = settlement.winners.reduce((sum, winner) => sum + winner.payoutLamports, 0n);
  if (payouts + settlement.rolloverLamports !== potLamports) {
    throw new Error(`${competition} payouts and rollover do not conserve the pot`);
  }
  validatePrizeSchedule(competition, potLamports, settlement);
}

function validatePrizeSchedule(
  competition: CompetitionKind,
  potLamports: bigint,
  settlement: SettlementSnapshot,
): void {
  if (competition === "weekly") {
    const budget = floorPayout(potLamports / 3n);
    for (const bountyIndex of [0, 1, 2] as const) {
      const winners = settlement.winners
        .filter((winner) => winner.bountyIndex === bountyIndex)
        .sort((left, right) => left.rank - right.rank);
      assertContiguousRanks(winners, `Weekly bounty ${bountyIndex}`);
      assertUnique(winners.map(({ owner }) => owner.toBase58()), `Weekly bounty ${bountyIndex} winner`);
      assertExpectedPayouts(winners, budget, WEEKLY_PRIZE_WEIGHTS);
    }
    if (settlement.winners.some(({ bountyIndex }) => bountyIndex === undefined)) {
      throw new Error("Weekly payout position is missing a bounty index");
    }
    return;
  }
  const winners = [...settlement.winners].sort((left, right) => left.rank - right.rank);
  if (winners.some(({ bountyIndex }) => bountyIndex !== undefined)) {
    throw new Error(`${competition} payout cannot carry a bounty index`);
  }
  assertContiguousRanks(winners, competition);
  assertExpectedPayouts(winners, potLamports, DAILY_PRIZE_WEIGHTS);
}

function assertExpectedPayouts(
  winners: readonly WinnerSnapshot[],
  budget: bigint,
  weights: readonly number[],
): void {
  if (winners.length === 0) return;
  const denominator = weights.slice(0, winners.length)
    .reduce((sum, weight) => sum + BigInt(weight), 0n);
  winners.forEach((winner, index) => {
    const expected = floorPayout((budget * BigInt(weights[index]!)) / denominator);
    if (winner.payoutLamports !== expected) {
      throw new Error("winner payout does not match the canonical prize schedule");
    }
  });
}

function aggregateWinners(winners: readonly WinnerSnapshot[]): WinnerSnapshot[] {
  const aggregated = new Map<string, WinnerSnapshot>();
  for (const winner of winners) {
    const key = winner.owner.toBase58();
    const existing = aggregated.get(key);
    if (!existing) {
      aggregated.set(key, { ...winner });
      continue;
    }
    if (existing.destinationValid !== winner.destinationValid) {
      throw new Error("repeated winner has inconsistent destination state");
    }
    existing.payoutLamports += winner.payoutLamports;
  }
  return [...aggregated.values()];
}

function qualificationDailies(
  snapshot: ProtocolSnapshot,
  startDay: number,
  count: number,
  requireSeasonSeal: boolean,
): boolean {
  const dailies = new Map(snapshot.dailies.map((daily) => [daily.dayId, daily]));
  const archivedThrough = snapshot.archiveState?.lastDailyId;
  return Array.from({ length: count }, (_, offset) => startDay + offset)
    .every((dayId) => {
      const daily = dailies.get(dayId);
      if (!daily && archivedThrough !== undefined && dayId <= archivedThrough) {
        return true;
      }
      return daily?.status === "finalized" &&
        daily.entriesScored + daily.entriesExpired === daily.entriesPaid &&
        (!requireSeasonSeal || daily.seasonRollupSealed);
    });
}

function seasonQualificationDailies(
  snapshot: ProtocolSnapshot,
  startDay: number,
  count: number,
): number {
  const dailies = new Map(snapshot.dailies.map((daily) => [daily.dayId, daily]));
  const archivedThrough = snapshot.archiveState?.lastDailyId;
  return Array.from({ length: count }, (_, offset) => startDay + offset)
    .filter((dayId) => {
      const daily = dailies.get(dayId);
      if (!daily && archivedThrough !== undefined && dayId <= archivedThrough) {
        return true;
      }
      return daily?.status === "finalized" &&
        daily.entriesScored + daily.entriesExpired === daily.entriesPaid &&
        daily.seasonRollupSealed;
    })
    .length;
}

function weeklyRequiredDailies(weekly: WeeklySnapshot): number {
  return weekStartDay(weekly.weekId) + DAYS_PER_WEEK - weekly.qualificationStartDay;
}

function weeklyArchiveCheckpointComplete(
  snapshot: ProtocolSnapshot,
  weekly: WeeklySnapshot,
): boolean {
  const archivedThrough = snapshot.archiveState?.lastDailyId;
  return archivedThrough !== undefined &&
    archivedThrough >= weekStartDay(weekly.weekId) + DAYS_PER_WEEK - 1;
}

function seasonRequiredDailies(season: SeasonSnapshot): number {
  return seasonStartDay(season.seasonId) + DAYS_PER_SEASON - season.qualificationStartDay;
}

function cadenceRange(first: number, lastInclusive: number): number[] {
  if (lastInclusive < first || lastInclusive - first >= DAYS_PER_SEASON) {
    throw new Error("qualification cadence range is invalid");
  }
  return Array.from({ length: lastInclusive - first + 1 }, (_, offset) => first + offset);
}

function firstMissingCadence<T>(
  first: number,
  lastInclusive: number,
  values: ReadonlyMap<number, T>,
  archivedThrough?: number,
): number | undefined {
  assertCadenceId(first, "cadence recovery start");
  assertCadenceId(lastInclusive, "cadence recovery end");
  if (lastInclusive < first || lastInclusive - first >= 10_000) {
    throw new Error("cadence recovery range is invalid or unbounded");
  }
  if (archivedThrough !== undefined) {
    assertCadenceId(archivedThrough, "archived cadence checkpoint");
    if (archivedThrough < first - 1 || archivedThrough > lastInclusive) {
      throw new Error("archived cadence checkpoint is outside recovery");
    }
  } else if (!values.has(first)) {
    // Production snapshot loading requires all three launch accounts.
    return undefined;
  }
  const scanStart = archivedThrough === undefined
    ? first + 1
    : Math.max(first, archivedThrough + 1);
  for (let id = scanStart; id <= lastInclusive; id += 1) {
    if (!values.has(id)) return id;
  }
  return undefined;
}

function validatePredecessorFlag(expected: boolean, actual: boolean, label: string): void {
  if (expected !== actual) {
    throw new Error(`${label} predecessor rollover requirement is inconsistent`);
  }
}

function assertCounter(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${label} is outside u32`);
  }
}

function assertContiguousRanks(winners: readonly WinnerSnapshot[], label: string): void {
  if (winners.some((winner, index) => winner.rank !== index + 1)) {
    throw new Error(`${label} payout ranks are not contiguous`);
  }
}

function floorPayout(lamports: bigint): bigint {
  return (lamports / SOL_PAYOUT_UNIT_LAMPORTS) * SOL_PAYOUT_UNIT_LAMPORTS;
}

function canonicalWinnerOrder(
  competition: CompetitionKind,
  winners: readonly WinnerSnapshot[],
): WinnerSnapshot[] {
  return [...winners].sort((left, right) => competition === "weekly"
    ? (left.bountyIndex! - right.bountyIndex!) || (left.rank - right.rank)
    : left.rank - right.rank);
}

function periodContext(competition: CompetitionKind, id: number) {
  if (competition === "daily") return { dayId: id };
  if (competition === "weekly") return { weekId: id };
  return { seasonId: id };
}

function successorContext(competition: CompetitionKind, id: number) {
  if (competition === "daily") return { followingDayId: id + 1 };
  if (competition === "weekly") return { followingWeekId: id + 1 };
  return { followingSeasonId: id + 1 };
}

function assertUnique(values: readonly (number | string)[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} is duplicated`);
}
