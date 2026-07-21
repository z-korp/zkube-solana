import { PublicKey, type Connection } from "@solana/web3.js";

import {
  DAILY_ENTRY_CLOSE_OFFSET,
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAYS_PER_SEASON,
  DAYS_PER_WEEK,
  KEEPER_RECENT_DAILY_CADENCES,
  KEEPER_RECENT_SEASON_CADENCES,
  KEEPER_RECENT_WEEKLY_CADENCES,
  PERIOD_SETTLEMENT_DELAY_SECONDS,
  SECONDS_PER_DAY,
  SOL_PAYOUT_UNIT_LAMPORTS,
  assertCadenceId,
  currentDayId,
  seasonIdForDay,
  seasonStartDay,
  weekIdForDay,
  weekStartDay,
  type KeeperInstructionPlan,
  type KeeperPlanContext,
} from "./arcadeChain.js";
import { deriveSessionPda } from "./sessionCleanup.js";

export interface KeeperPlanPolicyInput {
  plan: KeeperInstructionPlan;
  keeper: PublicKey;
  programId: PublicKey;
  connection: Connection;
  nowUnix: number;
}

/**
 * Validates semantic authority, cadence, and accounting before exact IDL
 * materialization. RPC is retained in the boundary so a materializer cannot
 * bypass the fresh account checks performed by the snapshot adapter.
 */
export function assertKeeperPlanPolicy(input: KeeperPlanPolicyInput): void {
  void input.keeper;
  void input.connection;
  if (input.plan.operation === "revoke_expired_session") {
    assertSessionCleanupPlan(input.plan, input.programId, input.nowUnix);
    return;
  }
  if (input.plan.execution !== "validation_only" ||
      input.plan.instruction || input.plan.instructions) {
    throw new Error("keeper policy rejects unvalidated instruction bytes");
  }
  const context = requiredContext(input.plan.context);
  const today = currentDayId(input.nowUnix);
  const currentWeek = weekIdForDay(today);
  const currentSeason = seasonIdForDay(today);

  switch (input.plan.operation) {
    case "prepare_arena_daily":
      assertRulesCatalog(context);
      assertExactSuccessor(
        context.dayId,
        context.followingDayId,
        context.launchCadenceId,
        today,
        KEEPER_RECENT_DAILY_CADENCES,
        "Daily",
      );
      return;
    case "prepare_weekly_jackpot":
      assertRulesCatalog(context);
      assertExactSuccessor(
        context.weekId,
        context.followingWeekId,
        context.launchCadenceId,
        currentWeek,
        KEEPER_RECENT_WEEKLY_CADENCES,
        "Weekly",
      );
      return;
    case "prepare_season":
      assertExactSuccessor(
        context.seasonId,
        context.followingSeasonId,
        context.launchCadenceId,
        currentSeason,
        KEEPER_RECENT_SEASON_CADENCES,
        "Season",
      );
      return;
    case "activate_arena_daily":
      assertActivation(
        context,
        context.dayId,
        today,
        KEEPER_RECENT_DAILY_CADENCES,
        input.nowUnix,
        "Daily",
      );
      return;
    case "activate_weekly_jackpot":
      assertActivation(
        context,
        context.weekId,
        currentWeek,
        KEEPER_RECENT_WEEKLY_CADENCES,
        input.nowUnix,
        "Weekly",
      );
      return;
    case "activate_season":
      assertActivation(
        context,
        context.seasonId,
        currentSeason,
        KEEPER_RECENT_SEASON_CADENCES,
        input.nowUnix,
        "Season",
      );
      return;
    case "force_finish_deadline":
      assertArenaRunContext(context, today);
      assertRunDeadlines(context);
      if (context.runLocation !== "ephemeral_rollup" ||
          context.deadlineAt! > input.nowUnix) {
        throw new Error("keeper policy rejects deadline finish timing or routing");
      }
      return;
    case "commit_run":
      assertAnyRunContext(context, today);
      if (context.runLocation !== "ephemeral_rollup") {
        throw new Error("keeper policy rejects run commit routing");
      }
      return;
    case "consume_campaign_run":
      assertCampaignRunContext(context);
      if (context.runLocation !== "base") {
        throw new Error("keeper policy rejects Campaign consumption routing");
      }
      return;
    case "consume_arena_run":
      assertArenaRunContext(context, today, "ranked");
      assertRunDeadlines(context);
      if (context.runLocation !== "base") {
        throw new Error("keeper policy rejects Arena consumption routing");
      }
      return;
    case "consume_practice_run":
      assertArenaRunContext(context, today, "practice");
      assertRunDeadlines(context);
      if (context.runLocation !== "base") {
        throw new Error("keeper policy rejects Practice consumption routing");
      }
      return;
    case "expire_unresolved_arena_run":
      assertArenaRunContext(context, today);
      assertRunDeadlines(context);
      if (context.recoveryDeadlineAt! > input.nowUnix ||
          context.runLocation === "ephemeral_rollup" ||
          (context.runMode === "practice" && context.includeArenaPlayer)) {
        throw new Error("keeper policy rejects unresolved run expiry");
      }
      return;
    case "cleanup_orphan_active_run":
      assertAnyRunContext(context, today);
      if (context.runLocation !== "base" ||
          context.recoveryDeadlineAt === undefined ||
          context.recoveryDeadlineAt > input.nowUnix) {
        throw new Error("keeper policy rejects orphan cleanup timing or routing");
      }
      return;
    case "initialize_season_player":
      if (!context.owner) throw new Error("keeper policy rejects SeasonPlayer owner");
      assertRecentPastOrCurrent(
        context.seasonId,
        currentSeason,
        KEEPER_RECENT_SEASON_CADENCES,
        "Season",
      );
      return;
    case "rollup_arena_to_season":
      assertRecentPastOrCurrent(
        context.dayId,
        today,
        KEEPER_RECENT_DAILY_CADENCES,
        "Daily",
      );
      if (!context.owner || context.dayId === undefined ||
          context.seasonId !== seasonIdForDay(context.dayId)) {
        throw new Error("keeper policy rejects Daily-to-Season relationship");
      }
      return;
    case "seal_arena_season_rollups":
      assertRecentPastOrCurrent(
        context.dayId,
        today,
        KEEPER_RECENT_DAILY_CADENCES,
        "Daily",
      );
      if (context.dayId === undefined ||
          context.seasonId !== seasonIdForDay(context.dayId)) {
        throw new Error("keeper policy rejects Daily Season seal relationship");
      }
      return;
    case "finalize_arena_daily":
      assertRecentPastOrCurrent(
        context.dayId,
        today,
        KEEPER_RECENT_DAILY_CADENCES,
        "Daily",
      );
      assertSuccessor(context.dayId, context.followingDayId, today, "Daily");
      assertAtomicFinalization(context, today, currentWeek, currentSeason);
      return;
    case "finalize_weekly_jackpot":
      assertRecentPastOrCurrent(
        context.weekId,
        currentWeek,
        KEEPER_RECENT_WEEKLY_CADENCES,
        "Weekly",
      );
      assertSuccessor(
        context.weekId,
        context.followingWeekId,
        currentWeek,
        "Weekly",
      );
      if (context.weekId === undefined ||
          context.finalDayId !== weekStartDay(context.weekId) + DAYS_PER_WEEK - 1) {
        throw new Error("keeper policy rejects Weekly final Daily");
      }
      assertAtomicFinalization(context, today, currentWeek, currentSeason);
      return;
    case "finalize_season":
      assertRecentPastOrCurrent(
        context.seasonId,
        currentSeason,
        KEEPER_RECENT_SEASON_CADENCES,
        "Season",
      );
      assertSuccessor(
        context.seasonId,
        context.followingSeasonId,
        currentSeason,
        "Season",
      );
      if (context.sealedDailies !== DAYS_PER_SEASON) {
        throw new Error("keeper policy rejects incomplete Season sealing");
      }
      assertAtomicFinalization(context, today, currentWeek, currentSeason);
      return;
  }
}

function assertSessionCleanupPlan(
  plan: KeeperInstructionPlan,
  programId: PublicKey,
  nowUnix: number,
): void {
  const owner = plan.context?.owner;
  const sessionSigner = plan.context?.sessionSigner;
  const sessionAddress = plan.context?.sessionAddress;
  const validUntil = plan.context?.sessionValidUntil;
  if (plan.execution !== "validation_only" || plan.instruction || plan.instructions ||
      !owner || !sessionSigner || !sessionAddress || validUntil === undefined ||
      !Number.isSafeInteger(validUntil) || validUntil < 0 || validUntil > nowUnix) {
    throw new Error("keeper policy rejects expired session context");
  }
  if (!sessionAddress.equals(deriveSessionPda(programId, owner, sessionSigner))) {
    throw new Error("keeper policy rejects expired session account layout");
  }
}

function requiredContext(context: KeeperPlanContext | undefined): KeeperPlanContext {
  if (!context) throw new Error("keeper policy rejects missing operation context");
  return context;
}

function assertRulesCatalog(context: KeeperPlanContext): void {
  if (!(context.rulesCatalog instanceof PublicKey) ||
      context.rulesCatalog.equals(PublicKey.default)) {
    throw new Error("keeper policy rejects rules catalog identity");
  }
}

function assertCampaignRunContext(context: KeeperPlanContext): void {
  if (!context.owner || context.runId === undefined || context.runMode !== "campaign" ||
      context.challengeDayId !== undefined || context.deadlineDayId !== undefined ||
      context.deadlineAt !== undefined || context.recoveryDeadlineAt !== undefined ||
      context.includeArenaPlayer) {
    throw new Error("keeper policy rejects Campaign run context");
  }
  assertRunId(context.runId);
}

function assertAnyRunContext(context: KeeperPlanContext, today: number): void {
  if (context.runMode === "campaign") {
    assertCampaignRunContext(context);
  } else {
    assertArenaRunContext(context, today);
    assertRunDeadlines(context);
  }
}

function assertArenaRunContext(
  context: KeeperPlanContext,
  today: number,
  expectedMode?: "ranked" | "practice",
): void {
  if (context.challengeDayId === undefined || context.deadlineDayId === undefined ||
      !context.owner || context.runId === undefined ||
      (context.runMode !== "ranked" && context.runMode !== "practice") ||
      (expectedMode && context.runMode !== expectedMode)) {
    throw new Error("keeper policy rejects incomplete Arena run context");
  }
  assertRunId(context.runId);
  assertCadenceId(context.challengeDayId, "run challenge day id");
  assertCadenceId(context.deadlineDayId, "run deadline day id");
  if (context.challengeDayId > today || context.deadlineDayId > today ||
      context.challengeDayId < Math.max(0, today - KEEPER_RECENT_DAILY_CADENCES) ||
      (context.runMode === "ranked" &&
        context.challengeDayId !== context.deadlineDayId) ||
      (context.runMode === "practice" &&
        context.challengeDayId + 1 !== context.deadlineDayId) ||
      (context.runMode === "ranked" && context.includeArenaPlayer !== true) ||
      (context.runMode === "practice" &&
        typeof context.includeArenaPlayer !== "boolean")) {
    throw new Error("keeper policy rejects Arena run cadence relationship");
  }
}

function assertRunId(runId: bigint): void {
  if (runId < 0n || runId > 0xffff_ffff_ffff_ffffn) {
    throw new Error("keeper policy rejects run id");
  }
}

function assertRunDeadlines(context: KeeperPlanContext): void {
  if (context.deadlineAt === undefined || context.recoveryDeadlineAt === undefined ||
      !Number.isSafeInteger(context.deadlineAt) ||
      !Number.isSafeInteger(context.recoveryDeadlineAt) ||
      context.deadlineAt < 0 || context.recoveryDeadlineAt <= context.deadlineAt) {
    throw new Error("keeper policy rejects invalid run deadlines");
  }
}

function assertExactSuccessor(
  current: number | undefined,
  following: number | undefined,
  launch: number | undefined,
  expectedCurrent: number,
  recentWindow: number,
  label: string,
): void {
  if (current === undefined || following === undefined || launch === undefined ||
      following !== current + 1 ||
      following <= launch || following > expectedCurrent + 1 ||
      following < Math.max(launch + 1, expectedCurrent - recentWindow)) {
    throw new Error(`keeper policy rejects following ${label} preparation`);
  }
  assertCadenceId(current, `${label} id`);
  assertCadenceId(following, `following ${label} id`);
  assertCadenceId(launch, `launch ${label} id`);
}

function assertActivation(
  context: KeeperPlanContext,
  id: number | undefined,
  current: number,
  recentWindow: number,
  nowUnix: number,
  label: "Daily" | "Weekly" | "Season",
): void {
  if (id === undefined) throw new Error(`keeper policy rejects ${label} activation`);
  assertCadenceId(id, `${label} id`);
  if (id === current) {
    if (context.recoveryActivation ||
        (label === "Daily" &&
          nowUnix >= current * SECONDS_PER_DAY + DAILY_ENTRY_CLOSE_OFFSET)) {
      throw new Error(`keeper policy rejects ${label} activation`);
    }
    return;
  }
  const expectedDeadline = label === "Daily"
    ? id * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET
    : label === "Weekly"
      ? (weekStartDay(id) + DAYS_PER_WEEK) * SECONDS_PER_DAY
      : (seasonStartDay(id) + DAYS_PER_SEASON) * SECONDS_PER_DAY;
  const suppliedDeadline = label === "Daily"
    ? context.recoveryDeadlineAt
    : context.deadlineAt;
  const readyAt = label === "Daily"
    ? expectedDeadline
    : expectedDeadline + PERIOD_SETTLEMENT_DELAY_SECONDS;
  if (id > current || id < Math.max(0, current - recentWindow) ||
      context.recoveryActivation !== true ||
      context.predecessorRolloverApplied !== true ||
      suppliedDeadline !== expectedDeadline || nowUnix < readyAt) {
    throw new Error(`keeper policy rejects ${label} recovery activation`);
  }
}

function assertRecentPastOrCurrent(
  value: number | undefined,
  current: number,
  recentWindow: number,
  label: string,
): void {
  if (value === undefined || !Number.isSafeInteger(value) ||
      value < Math.max(0, current - recentWindow) || value > current) {
    throw new Error(`keeper policy rejects non-recent or invalid ${label}`);
  }
}

function assertSuccessor(
  current: number | undefined,
  following: number | undefined,
  maximumCurrent: number,
  label: string,
): void {
  if (current === undefined || following === undefined) {
    throw new Error(`keeper policy rejects ${label} successor`);
  }
  assertCadenceId(current, `${label} id`);
  assertCadenceId(following, `following ${label} id`);
  if (current > maximumCurrent || following !== current + 1) {
    throw new Error(`keeper policy rejects ${label} successor`);
  }
}

function assertAtomicFinalization(
  context: KeeperPlanContext,
  today: number,
  currentWeek: number,
  currentSeason: number,
): void {
  assertCompetitionContext(context, today, currentWeek, currentSeason);
  assertOwners(context.owners, context.competition === "weekly" ? 9 : 5);
  if (!context.payoutLamports ||
      context.payoutLamports.length !== context.owners?.length) {
    throw new Error("keeper policy rejects payout recipient mismatch");
  }
  let total = 0n;
  for (const payout of context.payoutLamports) {
    if (payout <= 0n || payout > 0xffff_ffff_ffff_ffffn ||
        payout % SOL_PAYOUT_UNIT_LAMPORTS !== 0n) {
      throw new Error("keeper policy rejects noncanonical SOL payout");
    }
    total += payout;
    if (total > 0xffff_ffff_ffff_ffffn) {
      throw new Error("keeper policy rejects payout total overflow");
    }
  }
  assertAmount(context.payoutTotalLamports, "payout total");
  assertAmount(context.potLamports, "competition pot");
  assertAmount(context.rolloverLamports, "competition rollover");
  if (total !== context.payoutTotalLamports ||
      total + context.rolloverLamports! !== context.potLamports) {
    throw new Error("keeper policy rejects payout conservation mismatch");
  }
}

function assertCompetitionContext(
  context: KeeperPlanContext,
  today: number,
  currentWeek: number,
  currentSeason: number,
): void {
  if (context.competition === "daily" && context.dayId !== undefined) {
    assertRecentPastOrCurrent(
      context.dayId,
      today,
      KEEPER_RECENT_DAILY_CADENCES,
      "Daily",
    );
    return;
  }
  if (context.competition === "weekly" && context.weekId !== undefined) {
    assertRecentPastOrCurrent(
      context.weekId,
      currentWeek,
      KEEPER_RECENT_WEEKLY_CADENCES,
      "Weekly",
    );
    return;
  }
  if (context.competition === "season" && context.seasonId !== undefined) {
    assertRecentPastOrCurrent(
      context.seasonId,
      currentSeason,
      KEEPER_RECENT_SEASON_CADENCES,
      "Season",
    );
    return;
  }
  throw new Error("keeper policy rejects competition context");
}

function assertOwners(owners: readonly PublicKey[] | undefined, maximum: number): void {
  if (!owners || owners.length > maximum ||
      new Set(owners.map((owner) => owner.toBase58())).size !== owners.length) {
    throw new Error("keeper policy rejects payout owners");
  }
}

function assertAmount(value: bigint | undefined, label: string): void {
  if (value === undefined || value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`keeper policy rejects ${label} amount`);
  }
}
