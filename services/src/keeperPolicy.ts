import { createHash } from "node:crypto";

import { PublicKey, type Connection } from "@solana/web3.js";

import {
  ARENA_BOARD_CAPACITY,
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  KEEPER_RECENT_DAILY_CADENCES,
  SECONDS_PER_DAY,
  SOL_PAYOUT_UNIT_LAMPORTS,
  ZKUBE_PROGRAM_ID,
  arcadeArchivePda,
  arenaBoardPda,
  arenaDailyPda,
  assertCadenceId,
  cadenceFundingPda,
  currentDayId,
  dailyContentSelection,
  dailyIsScheduled,
  nextScheduledDaily,
  playerFundingPda,
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

/** Validates semantic authority and accounting before exact IDL materialization. */
export function assertKeeperPlanPolicy(input: KeeperPlanPolicyInput): void {
  void input.keeper;
  void input.connection;
  if (!input.programId.equals(ZKUBE_PROGRAM_ID)) {
    throw new Error("keeper policy rejects an unexpected program ID");
  }
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

  switch (input.plan.operation) {
    case "prepare_arena_daily":
      assertRulesCatalog(context);
      assertCadenceFunding(context);
      assertExactSuccessor(context, today);
      assertDailyContent(context);
      return;
    case "activate_arena_daily":
      assertActivation(context, today, input.nowUnix);
      return;
    case "force_finish_deadline":
      assertRankedRunContext(context, today);
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
      assertRankedRunContext(context, today);
      assertRunDeadlines(context);
      if (context.runLocation !== "base") {
        throw new Error("keeper policy rejects Arena consumption routing");
      }
      return;
    case "expire_unresolved_arena_run":
      assertRankedRunContext(context, today);
      assertRunDeadlines(context);
      if (context.recoveryDeadlineAt! > input.nowUnix ||
          context.runLocation === "ephemeral_rollup") {
        throw new Error("keeper policy rejects unresolved run expiry");
      }
      return;
    case "cleanup_orphan_active_run":
      assertAnyRunContext(context, today);
      if (context.runLocation !== "base" ||
          (context.runMode !== "campaign" &&
            (context.recoveryDeadlineAt === undefined ||
              context.recoveryDeadlineAt > input.nowUnix))) {
        throw new Error("keeper policy rejects orphan cleanup timing or routing");
      }
      return;
    case "finalize_arena_daily":
      assertRecentDaily(context.dayId, today, "Daily");
      assertSuccessor(context.dayId, context.followingDayId, today);
      assertAtomicFinalization(context, today);
      assertCadenceFunding(context);
      return;
    case "submit_arena_board_chunk":
      assertBoardChunk(context, today);
      return;
    case "sync_daily_profile":
      assertProfileSync(context, today);
      return;
    case "archive_arena_daily":
      assertCadenceArchive(context, today, "archive", input.nowUnix);
      return;
    case "expire_daily_claims":
      assertCadenceArchive(context, today, "expire", input.nowUnix);
      assertExpiryTarget(context, today, input.nowUnix);
      return;
    case "close_arena_daily":
      assertCadenceArchive(context, today, "close", input.nowUnix);
      return;
    case "close_arena_player":
      assertParticipantClosure(context, today);
      return;
  }
}

function assertBoardChunk(context: KeeperPlanContext, today: number): void {
  assertRecentDaily(context.dayId, today, "Daily board");
  const cursor = context.boardCursor;
  const payoutCount = context.boardPayoutCount;
  const entries = context.boardEntries;
  if (context.competition !== "daily" ||
      (context.boardKind !== "score" && context.boardKind !== "theme") ||
      !Number.isSafeInteger(cursor) || cursor === undefined || cursor < 0 ||
      !Number.isSafeInteger(payoutCount) || payoutCount === undefined ||
      payoutCount < 1 || payoutCount > ARENA_BOARD_CAPACITY || !entries ||
      entries.length < 1 || entries.length > 10 || cursor + entries.length > payoutCount ||
      context.sealBoard !== (cursor + entries.length === payoutCount)) {
    throw new Error("keeper policy rejects payout board chunk");
  }
  for (const entry of entries) {
    if (!(entry.source instanceof PublicKey) ||
        !Number.isSafeInteger(entry.score) || entry.score < 0 || entry.score > 0xffff_ffff ||
        entry.objectiveTotal < 0n || entry.objectiveTotal > 0xffff_ffff_ffff_ffffn ||
        !Number.isSafeInteger(entry.finalizedAt) || entry.finalizedAt < 0 ||
        entry.replayHash.length !== 32) {
      throw new Error("keeper policy rejects payout board entry");
    }
  }
}

function assertCadenceFunding(context: KeeperPlanContext): void {
  if (!context.cadenceFunding?.equals(cadenceFundingPda())) {
    throw new Error("keeper policy rejects cadence funding identity");
  }
}

function assertCadenceArchive(
  context: KeeperPlanContext,
  today: number,
  mode: "archive" | "expire" | "close",
  nowUnix: number,
): void {
  assertRecentDaily(context.dayId, today, "Daily archive");
  if (context.competition !== "daily" ||
      !context.arcadeArchive?.equals(arcadeArchivePda()) ||
      !context.cadenceFunding?.equals(cadenceFundingPda()) ||
      !/^[0-9a-f]{64}$/.test(context.archiveResultHash ?? "") ||
      !/^[0-9a-f]{64}$/.test(context.archiveCurrentRoot ?? "") ||
      !validPayoutMask(context.requiredScoreProfileSyncMask) ||
      !validPayoutMask(context.requiredThemeProfileSyncMask) ||
      !Number.isSafeInteger(context.closeEligibleAt) ||
      context.closeEligibleAt === undefined || context.closeEligibleAt < 0) {
    throw new Error("keeper policy rejects cadence archive identity");
  }
  if (context.archiveFirstCadenceId === undefined ||
      context.previousCadenceId === undefined) {
    throw new Error("keeper policy rejects incomplete archive checkpoint");
  }
  assertCadenceId(context.archiveFirstCadenceId, "first archived Daily id");
  assertCadenceId(context.previousCadenceId, "last archived Daily id");
  if (context.archiveFirstCadenceId > context.dayId! ||
      (mode === "archive"
        ? context.previousCadenceId >= context.dayId!
        : context.previousCadenceId < context.dayId!)) {
    throw new Error("keeper policy rejects non-sequential cadence archive");
  }
  if (mode !== "archive") {
    if (!context.archiveCommitted || context.archiveCanonicalJson !== undefined ||
        context.archiveFileSha256 !== undefined ||
        context.closeEligibleAt > nowUnix) {
      throw new Error("keeper policy rejects uncommitted expired cadence");
    }
    if (context.claimsExpired !== (mode === "close")) {
      throw new Error("keeper policy rejects cadence claim-expiry state");
    }
    return;
  }
  if (context.archiveCommitted || context.archiveCanonicalJson === undefined ||
      !/^[0-9a-f]{64}$/.test(context.archiveFileSha256 ?? "")) {
    throw new Error("keeper policy rejects committed or incomplete cadence archive");
  }
  const actualHash = createHash("sha256")
    .update(Buffer.from(context.archiveCanonicalJson, "utf8"))
    .digest("hex");
  if (actualHash !== context.archiveFileSha256) {
    throw new Error("keeper policy rejects cadence archive file hash");
  }
  try {
    const { contract } = parseCanonicalArchive(context.archiveCanonicalJson);
    const daily = arenaDailyPda(context.dayId!);
    if (contract.competition !== "daily" ||
        contract.periodId !== context.dayId ||
        contract.programId !== ZKUBE_PROGRAM_ID.toBase58() ||
        contract.account !== daily.toBase58() ||
        contract.scoreBoard !== arenaBoardPda(daily, "score").toBase58() ||
        contract.themeBoard !== arenaBoardPda(daily, "theme").toBase58() ||
        contract.resultHash !== context.archiveResultHash) {
      throw new Error("mismatch");
    }
  } catch {
    throw new Error("keeper policy rejects cadence archive commitment");
  }
}

function assertExpiryTarget(
  context: KeeperPlanContext,
  today: number,
  nowUnix: number,
): void {
  assertRulesCatalog(context);
  const startsDay = context.catalogStartsDay;
  const entryCount = context.poolEntryCount;
  if (startsDay === undefined || entryCount === undefined ||
      context.followingDayId !== nextScheduledDaily(today, startsDay, entryCount) ||
      context.claimCloseAt !== context.closeEligibleAt ||
      context.claimCloseAt === undefined || context.claimCloseAt >= nowUnix) {
    throw new Error("keeper policy rejects Daily claim-expiry target");
  }
  assertCadenceId(startsDay, "catalog start day");
  assertAmount(context.unclaimedLamports, "unclaimed payout");
}

function assertParticipantClosure(context: KeeperPlanContext, today: number): void {
  assertRecentDaily(context.dayId, today, "ArenaPlayer");
  if (context.competition !== "daily" || !context.owner || !context.rentRecipient ||
      !context.rentRecipient.equals(playerFundingPda(context.owner))) {
    throw new Error("keeper policy rejects ArenaPlayer cleanup recipient");
  }
}

function assertProfileSync(context: KeeperPlanContext, today: number): void {
  if (!context.owner || context.competition !== "daily" ||
      (context.boardKind !== "score" && context.boardKind !== "theme") ||
      !validPayoutMask(context.winnerPositionMask) || context.winnerPositionMask === 0n) {
    throw new Error("keeper policy rejects profile sync context");
  }
  assertRecentDaily(context.dayId, today, "Daily");
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
  if (context.runMode === "campaign") assertCampaignRunContext(context);
  else {
    assertRankedRunContext(context, today);
    assertRunDeadlines(context);
  }
}

function assertRankedRunContext(context: KeeperPlanContext, today: number): void {
  if (context.challengeDayId === undefined || context.deadlineDayId === undefined ||
      !context.owner || context.runId === undefined || context.runMode !== "ranked") {
    throw new Error("keeper policy rejects incomplete Arena run context");
  }
  assertRunId(context.runId);
  assertCadenceId(context.challengeDayId, "run challenge day id");
  assertCadenceId(context.deadlineDayId, "run deadline day id");
  if (context.challengeDayId > today ||
      context.challengeDayId < Math.max(0, today - KEEPER_RECENT_DAILY_CADENCES) ||
      context.challengeDayId !== context.deadlineDayId ||
      context.includeArenaPlayer !== true) {
    throw new Error("keeper policy rejects Arena run cadence relationship");
  }
}

function assertRunId(runId: bigint): void {
  if (runId < 1n || runId > 0xffff_ffff_ffff_ffffn) {
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

function assertExactSuccessor(context: KeeperPlanContext, today: number): void {
  const current = context.dayId;
  const following = context.followingDayId;
  const launch = context.launchCadenceId;
  const startsDay = context.catalogStartsDay;
  const entryCount = context.poolEntryCount;
  if (current === undefined || following === undefined || launch === undefined ||
      startsDay === undefined || entryCount === undefined ||
      following <= current || following <= launch ||
      !dailyIsScheduled(following, startsDay, entryCount) ||
      following !== nextScheduledDaily(current, startsDay, entryCount) ||
      following > nextScheduledDaily(today, startsDay, entryCount) ||
      following < Math.max(launch + 1, today - KEEPER_RECENT_DAILY_CADENCES)) {
    throw new Error("keeper policy rejects following Daily preparation");
  }
  assertCadenceId(current, "Daily id");
  assertCadenceId(following, "following Daily id");
  assertCadenceId(launch, "launch Daily id");
  assertCadenceId(startsDay, "catalog start day");
}

function assertActivation(
  context: KeeperPlanContext,
  today: number,
  nowUnix: number,
): void {
  const dayId = context.dayId;
  if (dayId === undefined) throw new Error("keeper policy rejects Daily activation");
  assertCadenceId(dayId, "Daily id");
  if (context.recoveryActivation) {
    const expectedDeadline = dayId * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET;
    if (dayId > today || dayId < Math.max(0, today - KEEPER_RECENT_DAILY_CADENCES) ||
        context.preactivation || context.predecessorRolloverApplied !== true ||
        context.recoveryDeadlineAt !== expectedDeadline || nowUnix < expectedDeadline) {
      throw new Error("keeper policy rejects Daily recovery activation");
    }
    return;
  }
  if (context.catalogStartsDay === undefined || context.poolEntryCount === undefined) {
    throw new Error("keeper policy rejects Daily activation catalog");
  }
  assertRulesCatalog(context);
  const currentScheduled = dailyIsScheduled(
    today,
    context.catalogStartsDay,
    context.poolEntryCount,
  )
    ? today
    : nextScheduledDaily(today - 1, context.catalogStartsDay, context.poolEntryCount);
  const followingScheduled = nextScheduledDaily(
    currentScheduled,
    context.catalogStartsDay,
    context.poolEntryCount,
  );
  if (dayId === currentScheduled) {
    if (context.recoveryActivation || context.preactivation ||
        nowUnix >= today * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET) {
      throw new Error("keeper policy rejects Daily activation");
    }
    return;
  }
  if (dayId === followingScheduled) {
    if (context.preactivation !== true || context.recoveryActivation) {
      throw new Error("keeper policy rejects Daily preactivation");
    }
    return;
  }
  throw new Error("keeper policy rejects Daily activation");
}

function assertRecentDaily(
  value: number | undefined,
  today: number,
  label: string,
): asserts value is number {
  if (value === undefined || !Number.isSafeInteger(value) ||
      value < Math.max(0, today - KEEPER_RECENT_DAILY_CADENCES) || value > today) {
    throw new Error(`keeper policy rejects non-recent or invalid ${label}`);
  }
}

function assertSuccessor(
  current: number | undefined,
  following: number | undefined,
  maximumCurrent: number,
): void {
  if (current === undefined || following === undefined) {
    throw new Error("keeper policy rejects Daily successor");
  }
  assertCadenceId(current, "Daily id");
  assertCadenceId(following, "following Daily id");
  if (current > maximumCurrent || following <= current) {
    throw new Error("keeper policy rejects Daily successor");
  }
}

function assertAtomicFinalization(context: KeeperPlanContext, today: number): void {
  if (context.competition !== "daily") {
    throw new Error("keeper policy rejects competition context");
  }
  assertRecentDaily(context.dayId, today, "Daily");
  assertBoardCount(context.scorePayoutCount, "Score");
  assertBoardCount(context.themePayoutCount, "Theme");
  if (typeof context.scoreCapacityLimited !== "boolean" ||
      typeof context.themeCapacityLimited !== "boolean") {
    throw new Error("keeper policy rejects payout capacity condition");
  }
  assertAmount(context.payoutTotalLamports, "payout total");
  assertAmount(context.potLamports, "competition pot");
  assertAmount(context.rolloverLamports, "competition rollover");
  if (context.payoutTotalLamports! % SOL_PAYOUT_UNIT_LAMPORTS !== 0n ||
      context.payoutTotalLamports! + context.rolloverLamports! !== context.potLamports) {
    throw new Error("keeper policy rejects payout conservation mismatch");
  }
}

function assertBoardCount(value: number | undefined, label: string): void {
  if (!Number.isSafeInteger(value) || value === undefined || value < 0 ||
      value > ARENA_BOARD_CAPACITY) {
    throw new Error(`keeper policy rejects ${label} payout count`);
  }
}

function assertDailyContent(context: KeeperPlanContext): void {
  if (context.followingDayId === undefined || context.contentVersion === undefined ||
      context.contentVersion < 1 || context.catalogStartsDay === undefined ||
      context.poolEntryCount === undefined || !context.poolEntries ||
      context.poolEntries.length !== context.poolEntryCount) {
    throw new Error("keeper policy rejects Daily content context");
  }
  const selected = dailyContentSelection(
    context.catalogStartsDay,
    context.followingDayId,
    context.poolEntryCount,
  );
  const entry = context.poolEntries[selected.poolIndex];
  if (context.poolIndex !== selected.poolIndex || !entry ||
      context.realmMapId !== entry.realmMapId) {
    throw new Error("keeper policy rejects Daily content selection");
  }
}

function validPayoutMask(mask: bigint | undefined): mask is bigint {
  return mask !== undefined && mask >= 0n &&
    mask < (1n << BigInt(ARENA_BOARD_CAPACITY));
}

function assertAmount(value: bigint | undefined, label: string): void {
  if (value === undefined || value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`keeper policy rejects ${label} amount`);
  }
}
