import { createHash } from "node:crypto";

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
  ZKUBE_PROGRAM_ID,
  arenaDailyPda,
  assertCadenceId,
  currentDayId,
  arcadeArchivePda,
  cadenceFundingPda,
  playerFundingPda,
  seasonIdForDay,
  seasonPda,
  seasonStartDay,
  weekIdForDay,
  weekStartDay,
  weeklyJackpotPda,
  type KeeperInstructionPlan,
  type KeeperPlanContext,
} from "./arcadeChain.js";
import { parseCanonicalArchive } from "./archiveContract.js";
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
      assertCadenceFunding(context);
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
      assertCadenceFunding(context);
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
      assertCadenceFunding(context);
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
    case "expire_unresolved_practice_run":
      assertArenaRunContext(context, today, "practice");
      assertRunDeadlines(context);
      if (context.recoveryDeadlineAt! > input.nowUnix ||
          context.runLocation === "ephemeral_rollup" ||
          context.includeArenaPlayer) {
        throw new Error("keeper policy rejects unresolved Practice expiry");
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
          context.seasonId !== seasonIdForDay(context.dayId) ||
          !validQualificationDay(context.dayId, context.qualificationStartDay)) {
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
          context.seasonId !== seasonIdForDay(context.dayId) ||
          !validQualificationDay(context.dayId, context.qualificationStartDay)) {
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
      assertWeeklyQualificationAccounts(context);
      assertAtomicFinalization(context, today, currentWeek, currentSeason);
      return;
    case "finalize_season": {
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
      if (context.seasonId === undefined || context.qualificationStartDay === undefined) {
        throw new Error("keeper policy rejects incomplete Season sealing");
      }
      const seasonStart = seasonStartDay(context.seasonId);
      const seasonEnd = seasonStart + DAYS_PER_SEASON - 1;
      if (context.qualificationStartDay < seasonStart ||
          context.qualificationStartDay > seasonEnd ||
          context.sealedDailies !== seasonEnd - context.qualificationStartDay + 1) {
        throw new Error("keeper policy rejects incomplete Season sealing");
      }
      assertAtomicFinalization(context, today, currentWeek, currentSeason);
      return;
    }
    case "sync_daily_profile":
      assertProfileSync(context, "daily", today, currentWeek, currentSeason, 0x001f);
      return;
    case "sync_weekly_profile":
      assertProfileSync(context, "weekly", today, currentWeek, currentSeason, 0x01ff);
      return;
    case "sync_season_profile":
      assertProfileSync(context, "season", today, currentWeek, currentSeason, 0x001f);
      return;
    case "archive_arena_daily":
      assertCadenceArchive(context, "daily", context.dayId, today,
        KEEPER_RECENT_DAILY_CADENCES, false, input.nowUnix);
      return;
    case "archive_weekly_jackpot":
      assertCadenceArchive(context, "weekly", context.weekId, currentWeek,
        KEEPER_RECENT_WEEKLY_CADENCES, false, input.nowUnix);
      return;
    case "archive_season":
      assertCadenceArchive(context, "season", context.seasonId, currentSeason,
        KEEPER_RECENT_SEASON_CADENCES, false, input.nowUnix);
      return;
    case "close_arena_daily":
      assertCadenceArchive(context, "daily", context.dayId, today,
        KEEPER_RECENT_DAILY_CADENCES, true, input.nowUnix);
      return;
    case "close_weekly_jackpot":
      assertCadenceArchive(context, "weekly", context.weekId, currentWeek,
        KEEPER_RECENT_WEEKLY_CADENCES, true, input.nowUnix);
      return;
    case "close_season":
      assertCadenceArchive(context, "season", context.seasonId, currentSeason,
        KEEPER_RECENT_SEASON_CADENCES, true, input.nowUnix);
      return;
    case "close_arena_player":
      assertParticipantClosure(
        context,
        context.dayId,
        today,
        KEEPER_RECENT_DAILY_CADENCES,
        "ArenaPlayer",
      );
      return;
    case "close_season_player":
      assertParticipantClosure(
        context,
        context.seasonId,
        currentSeason,
        KEEPER_RECENT_SEASON_CADENCES,
        "SeasonPlayer",
      );
      return;
  }
}

function assertCadenceFunding(context: KeeperPlanContext): void {
  if (!context.cadenceFunding?.equals(cadenceFundingPda())) {
    throw new Error("keeper policy rejects cadence funding identity");
  }
}

function assertCadenceArchive(
  context: KeeperPlanContext,
  competition: "daily" | "weekly" | "season",
  cadenceId: number | undefined,
  currentCadence: number,
  recentWindow: number,
  closing: boolean,
  nowUnix: number,
): void {
  assertRecentPastOrCurrent(
    cadenceId,
    currentCadence,
    recentWindow,
    `${competition} archive`,
  );
  if (context.competition !== competition ||
      !context.arcadeArchive?.equals(arcadeArchivePda()) ||
      !context.cadenceFunding?.equals(cadenceFundingPda()) ||
      !/^[0-9a-f]{64}$/.test(context.archiveFileSha256 ?? "") ||
      !/^[0-9a-f]{64}$/.test(context.archiveResultHash ?? "") ||
      !Number.isSafeInteger(context.requiredProfileSyncMask) ||
      context.requiredProfileSyncMask === undefined ||
      context.requiredProfileSyncMask < 0 ||
      context.closeEligibleAt === undefined ||
      !Number.isSafeInteger(context.closeEligibleAt) ||
      context.closeEligibleAt < 0) {
    throw new Error("keeper policy rejects cadence archive identity");
  }
  if (context.previousCadenceId !== undefined) {
    assertCadenceId(context.previousCadenceId, "previous archived cadence id");
    if (cadenceId !== context.previousCadenceId + 1 &&
        !(closing && cadenceId === context.previousCadenceId)) {
      throw new Error("keeper policy rejects non-sequential cadence archive");
    }
  }
  if (closing) {
    if (!context.archiveCommitted || context.archiveCanonicalJson === undefined ||
        context.closeEligibleAt > nowUnix) {
      throw new Error("keeper policy rejects uncommitted cadence closure");
    }
  } else {
    if (context.archiveCommitted || context.archiveCanonicalJson === undefined) {
      throw new Error("keeper policy rejects committed or incomplete cadence archive");
    }
  }
  const actualHash = createHash("sha256")
    .update(Buffer.from(context.archiveCanonicalJson, "utf8"))
    .digest("hex");
  if (actualHash !== context.archiveFileSha256) {
    throw new Error("keeper policy rejects cadence archive file hash");
  }
  try {
    const { contract, resultData } = parseCanonicalArchive(
      context.archiveCanonicalJson,
    );
    const expectedAccount = competition === "daily"
      ? arenaDailyPda(cadenceId!)
      : competition === "weekly"
        ? weeklyJackpotPda(cadenceId!)
        : seasonPda(cadenceId!);
    if (contract.schemaVersion !== 2 || !resultData ||
        contract.competition !== competition ||
        contract.periodId !== cadenceId ||
        contract.programId !== ZKUBE_PROGRAM_ID.toBase58() ||
        contract.account !== expectedAccount.toBase58() ||
        contract.resultHash !== context.archiveResultHash) {
      throw new Error("mismatch");
    }
  } catch {
    throw new Error("keeper policy rejects cadence archive v2 commitment");
  }
}

function validQualificationDay(dayId: number, qualificationStartDay: number | undefined): boolean {
  return qualificationStartDay !== undefined && qualificationStartDay <= dayId;
}

function assertWeeklyQualificationAccounts(context: KeeperPlanContext): void {
  const weekId = context.weekId;
  const start = context.qualificationStartDay;
  const days = context.qualificationDayIds;
  if (weekId === undefined || start === undefined || !days) {
    throw new Error("keeper policy rejects Weekly qualification accounts");
  }
  const first = weekStartDay(weekId);
  const last = first + DAYS_PER_WEEK - 1;
  if (start < first || start > last || days.length !== last - start + 1 ||
      days.some((dayId, index) => dayId !== start + index)) {
    throw new Error("keeper policy rejects Weekly qualification accounts");
  }
  if (context.archiveLastDailyId === undefined) {
    throw new Error("keeper policy rejects incomplete Weekly archive checkpoint");
  }
  assertCadenceId(context.archiveLastDailyId, "Weekly archive Daily checkpoint");
  if (context.archiveLastDailyId < last) {
    throw new Error("keeper policy rejects incomplete Weekly archive checkpoint");
  }
}

function assertParticipantClosure(
  context: KeeperPlanContext,
  cadenceId: number | undefined,
  currentCadence: number,
  recentWindow: number,
  label: string,
): void {
  assertRecentPastOrCurrent(cadenceId, currentCadence, recentWindow, label);
  if (!context.owner || !context.rentRecipient ||
      !context.rentRecipient.equals(playerFundingPda(context.owner))) {
    throw new Error(`keeper policy rejects ${label} cleanup recipient`);
  }
}

function assertProfileSync(
  context: KeeperPlanContext,
  competition: "daily" | "weekly" | "season",
  today: number,
  currentWeek: number,
  currentSeason: number,
  maximumMask: number,
): void {
  if (!context.owner || context.competition !== competition ||
      !Number.isSafeInteger(context.winnerPositionMask) ||
      context.winnerPositionMask === undefined || context.winnerPositionMask <= 0 ||
      (context.winnerPositionMask & ~maximumMask) !== 0) {
    throw new Error("keeper policy rejects profile sync context");
  }
  assertCompetitionContext(context, today, currentWeek, currentSeason);
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
    if (context.recoveryActivation || context.preactivation ||
        (label === "Daily" &&
          nowUnix >= current * SECONDS_PER_DAY + DAILY_ENTRY_CLOSE_OFFSET)) {
      throw new Error(`keeper policy rejects ${label} activation`);
    }
    return;
  }
  if (id === current + 1) {
    if (context.preactivation !== true || context.recoveryActivation) {
      throw new Error(`keeper policy rejects ${label} preactivation`);
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
