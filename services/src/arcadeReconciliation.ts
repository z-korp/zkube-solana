import { PublicKey } from "@solana/web3.js";

import {
  DAILY_ENTRY_CLOSE_OFFSET,
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  DAYS_PER_SEASON,
  DAYS_PER_WEEK,
  KEEPER_RECENT_DAILY_CADENCES,
  KEEPER_RECENT_SEASON_CADENCES,
  KEEPER_RECENT_WEEKLY_CADENCES,
  PERIOD_SETTLEMENT_DELAY_SECONDS,
  SECONDS_PER_DAY,
  SOL_PAYOUT_UNIT_LAMPORTS,
  assertCadenceId,
  assertLamports,
  assertPayoutLamports,
  assertSafeTimestamp,
  currentDayId,
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
});

/**
 * Produces non-executable semantic plans from an already decoded and
 * relationship-checked protocol snapshot.
 */
export function discoverReconciliationPlans(args: {
  snapshot: ProtocolSnapshot;
  nowUnix: number;
}): KeeperInstructionPlan[] {
  assertSafeTimestamp(args.nowUnix);
  validateProtocolSnapshot(args.snapshot);

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

  if (!args.snapshot.paused) {
    for (const daily of args.snapshot.dailies) {
      if (daily.status !== "funding") continue;
      if (daily.dayId === today &&
          args.nowUnix < today * SECONDS_PER_DAY + DAILY_ENTRY_CLOSE_OFFSET) {
        plans.push(validationOnlyPlan("activate_arena_daily", { dayId: today }));
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
  );
  if (missingDay !== undefined && missingDay >= oldestKeeperDay) {
    plans.push(validationOnlyPlan("prepare_arena_daily", {
      dayId: missingDay - 1,
      followingDayId: missingDay,
      launchCadenceId: args.snapshot.launchDayId,
      rulesCatalog: args.snapshot.rulesCatalog,
    }));
  }
  const launchWeek = weekIdForDay(args.snapshot.launchDayId);
  const missingWeek = firstMissingCadence(launchWeek, thisWeek + 1, weeklyById);
  if (missingWeek !== undefined && missingWeek >= oldestKeeperWeek) {
    plans.push(validationOnlyPlan("prepare_weekly_jackpot", {
      weekId: missingWeek - 1,
      followingWeekId: missingWeek,
      launchCadenceId: launchWeek,
      rulesCatalog: args.snapshot.rulesCatalog,
    }));
  }
  const launchSeason = seasonIdForDay(args.snapshot.launchDayId);
  const missingSeason = firstMissingCadence(
    launchSeason,
    thisSeason + 1,
    seasonById,
  );
  if (missingSeason !== undefined && missingSeason >= oldestKeeperSeason) {
    plans.push(validationOnlyPlan("prepare_season", {
      seasonId: missingSeason - 1,
      followingSeasonId: missingSeason,
      launchCadenceId: launchSeason,
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
      owner: player.owner,
    }));
  }

  for (const daily of args.snapshot.dailies) {
    if (daily.dayId < oldestKeeperDay) continue;
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
    if (daily.status === "finalized" &&
        seasonById.has(seasonIdForDay(daily.dayId)) &&
        !daily.seasonRollupSealed &&
        daily.seasonRollups === daily.seasonEligiblePlayers) {
      plans.push(validationOnlyPlan("seal_arena_season_rollups", {
        dayId: daily.dayId,
        seasonId: seasonIdForDay(daily.dayId),
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
    appendFinalizationPlan(
      plans,
      "weekly",
      weekly.weekId,
      weekly.status === "open" &&
        args.nowUnix >= weekly.closesAt + PERIOD_SETTLEMENT_DELAY_SECONDS &&
        weekly.qualificationDailiesComplete &&
        (!weekly.predecessorRolloverRequired || weekly.predecessorRolloverApplied),
      weekly.settlement,
      weeklyById.has(weekly.weekId + 1),
      weekStartDay(weekly.weekId) + DAYS_PER_WEEK - 1,
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
    if (season.seasonId < oldestKeeperSeason) continue;
    appendFinalizationPlan(
      plans,
      "season",
      season.seasonId,
      season.status === "open" &&
        args.nowUnix >= season.closesAt + PERIOD_SETTLEMENT_DELAY_SECONDS &&
        season.sealedDailies === DAYS_PER_SEASON &&
        qualificationDailies(
          args.snapshot,
          seasonStartDay(season.seasonId),
          DAYS_PER_SEASON,
          true,
        ) &&
        (!season.predecessorRolloverRequired || season.predecessorRolloverApplied),
      season.settlement,
      seasonById.has(season.seasonId + 1),
      undefined,
      season.sealedDailies,
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
  return plans;
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
    plans.push(validationOnlyPlan("expire_unresolved_arena_run", {
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

  for (const daily of snapshot.dailies) {
    assertCadenceId(daily.dayId, "day id");
    assertSafeTimestamp(daily.runsCloseAt);
    assertSafeTimestamp(daily.recoveryDeadlineAt);
    const start = daily.dayId * SECONDS_PER_DAY;
    if (daily.runsCloseAt !== start + DAILY_RUN_CLOSE_OFFSET ||
        daily.recoveryDeadlineAt !== start + DAILY_RECOVERY_DEADLINE_OFFSET) {
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
    if (daily.seasonRollups > daily.seasonEligiblePlayers ||
        (daily.seasonRollupSealed &&
          (daily.status !== "finalized" ||
            daily.seasonRollups !== daily.seasonEligiblePlayers))) {
      throw new Error("Daily Season rollup counters are inconsistent");
    }
    validateSettlement("daily", daily.potLamports, daily.settlement, 5);
    validateProfileSyncMask("daily", daily.profileSyncMask, daily.settlement);
  }

  for (const weekly of snapshot.weeklies) {
    assertCadenceId(weekly.weekId, "week id");
    assertSafeTimestamp(weekly.closesAt);
    if (weekly.closesAt !== (weekStartDay(weekly.weekId) + DAYS_PER_WEEK) * SECONDS_PER_DAY) {
      throw new Error("Weekly close does not match its cadence id");
    }
    validatePredecessorFlag(
      weekly.weekId !== launchWeekId,
      weekly.predecessorRolloverRequired,
      "Weekly",
    );
    assertLamports(weekly.potLamports, "Weekly pot");
    if (weekly.status === "finalized" && !weekly.qualificationDailiesComplete) {
      throw new Error("finalized Weekly qualification is incomplete");
    }
    if (weekly.qualificationDailiesComplete &&
        !qualificationDailies(snapshot, weekStartDay(weekly.weekId), DAYS_PER_WEEK, false)) {
      throw new Error("Weekly qualification is incomplete");
    }
    validateSettlement("weekly", weekly.potLamports, weekly.settlement, 9);
    validateProfileSyncMask("weekly", weekly.profileSyncMask, weekly.settlement);
  }

  for (const season of snapshot.seasons) {
    assertCadenceId(season.seasonId, "season id");
    assertSafeTimestamp(season.closesAt);
    if (season.closesAt !==
        (seasonStartDay(season.seasonId) + DAYS_PER_SEASON) * SECONDS_PER_DAY) {
      throw new Error("Season close does not match its cadence id");
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
    const qualificationCount = seasonQualificationDailies(
      snapshot,
      seasonStartDay(season.seasonId),
    );
    if (season.sealedDailies !== qualificationCount) {
      throw new Error("Season qualification is incomplete");
    }
    if (season.status === "finalized" && season.sealedDailies !== DAYS_PER_SEASON) {
      throw new Error("finalized Season qualification is incomplete");
    }
    validateSettlement("season", season.potLamports, season.settlement, 5);
    validateProfileSyncMask("season", season.profileSyncMask, season.settlement);
  }

  for (const run of snapshot.runs) validateRun(snapshot, run);
  validateDailySeasonPlayers(snapshot);
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
      !snapshot.dailies.some(({ dayId }) => dayId === run.challengeDayId) ||
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
    if (!daily) throw new Error("ArenaPlayer references an undiscovered Daily");
    const seasonId = seasonIdForDay(player.dayId);
    if (!snapshot.seasons.some((season) => season.seasonId === seasonId)) {
      throw new Error("ArenaPlayer references an undiscovered Season");
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

function appendFinalizationPlan(
  plans: KeeperInstructionPlan[],
  competition: CompetitionKind,
  id: number,
  ready: boolean,
  settlement?: SettlementSnapshot,
  successorExists = false,
  finalDayId?: number,
  sealedDailies?: number,
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
      assertExpectedPayouts(winners, budget, [60n, 25n, 15n]);
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
  assertExpectedPayouts(winners, potLamports, [45n, 25n, 15n, 10n, 5n]);
}

function assertExpectedPayouts(
  winners: readonly WinnerSnapshot[],
  budget: bigint,
  weights: readonly bigint[],
): void {
  if (winners.length === 0) return;
  const denominator = weights.slice(0, winners.length)
    .reduce((sum, weight) => sum + weight, 0n);
  winners.forEach((winner, index) => {
    const expected = floorPayout((budget * weights[index]!) / denominator);
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
  return Array.from({ length: count }, (_, offset) => dailies.get(startDay + offset))
    .every((daily) => daily?.status === "finalized" &&
      (!requireSeasonSeal || daily.seasonRollupSealed));
}

function seasonQualificationDailies(snapshot: ProtocolSnapshot, startDay: number): number {
  const dailies = new Map(snapshot.dailies.map((daily) => [daily.dayId, daily]));
  return Array.from({ length: DAYS_PER_SEASON }, (_, offset) => dailies.get(startDay + offset))
    .filter((daily) => daily?.status === "finalized" && daily.seasonRollupSealed)
    .length;
}

function firstMissingCadence<T>(
  first: number,
  lastInclusive: number,
  values: ReadonlyMap<number, T>,
): number | undefined {
  assertCadenceId(first, "cadence recovery start");
  assertCadenceId(lastInclusive, "cadence recovery end");
  if (lastInclusive < first || lastInclusive - first >= 10_000) {
    throw new Error("cadence recovery range is invalid or unbounded");
  }
  // Production snapshot loading requires all three launch accounts. Keeping
  // partial semantic fixtures inert here prevents invention of a predecessor
  // before the launch seed.
  if (!values.has(first)) return undefined;
  for (let id = first + 1; id <= lastInclusive; id += 1) {
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
