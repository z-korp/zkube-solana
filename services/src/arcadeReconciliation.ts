import { PublicKey } from "@solana/web3.js";

import {
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  KEEPER_RECENT_DAILY_CADENCES,
  ARENA_BOARD_CAPACITY,
  ARENA_BOARD_CHUNK_CAPACITY,
  ARENA_ENTRY_LAMPORTS,
  SOL_PAYOUT_UNIT_LAMPORTS,
  arcadeConfigPda,
  assertCadenceId,
  assertLamports,
  assertPayoutLamports,
  assertSafeTimestamp,
  cadenceFundingPda,
  currentDayId,
  dailyPairForDay,
  nextScheduledDaily,
  validationOnlyPlan,
  type DailyBoardKind,
  type KeeperPlanContext,
  type KeeperInstructionPlan,
} from "./arcadeChain.js";
import { dailyBoardPools, payoutPlan, dailyWindow, scheduledDailyWindow } from "./zkubeCore.js";

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
  board: DailyBoardKind;
  owner: PublicKey;
  payoutLamports: bigint;
  rank: number;
}

export interface SettlementSnapshot {
  winners: readonly WinnerSnapshot[];
  rolloverLamports: bigint;
  scoreCapacityLimited: boolean;
  themeCapacityLimited: boolean;
}

export interface BoardSourceSnapshot {
  source: PublicKey;
  owner: PublicKey;
  score: number;
  objectiveTotal: bigint;
  finalizedAt: number;
  replayHash: Uint8Array;
}

export interface BoardConstructionSnapshot {
  kind: DailyBoardKind;
  payoutCount: number;
  widthCount: number;
  cursor: number;
  sealed: boolean;
  sealedAt: number;
  claimedLamports: bigint;
  claimedCount: number;
  capacityLimited: boolean;
}

export interface DailySnapshot {
  dayId: number;
  status: PeriodStatus;
  finalizedAt: number;
  runsCloseAt: number;
  recoveryDeadlineAt: number;
  entriesPaid: bigint;
  entriesScored: bigint;
  entriesExpired: bigint;
  potLamports: bigint;
  predecessorRolloverRequired: boolean;
  predecessorRolloverApplied: boolean;
  scoreQualifiedPlayers: number;
  themeQualifiedPlayers: number;
  /** Finalized payout positions already reflected in durable PlayerState profiles. */
  scoreClaimedMask: bigint;
  themeClaimedMask: bigint;
  claimsExpired: boolean;
  scoreSources?: readonly BoardSourceSnapshot[];
  themeSources?: readonly BoardSourceSnapshot[];
  scoreBoard?: BoardConstructionSnapshot;
  themeBoard?: BoardConstructionSnapshot;
  settlement?: SettlementSnapshot;
}

export interface RunSnapshot {
  owner: PublicKey;
  rentPayer?: PublicKey;
  runId: bigint;
  /** The Daily owning this arcade run. */
  challengeDayId?: number;
  /** Ranked runs use their challenge day. */
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

export interface ArcadeRootSnapshot {
  address: PublicKey;
  cadenceFunding: PublicKey;
  lastDailyId?: number;
  dailyRoot: string;
}

export interface CadenceArchiveCandidate {
  cadenceId: number;
  claimsExpired: boolean;
  committed: boolean;
  closeEligibleAt: number;
}

export interface ClosedArenaPlayerSnapshot {
  dayId: number;
  owner: PublicKey;
  rentPayer: PublicKey;
}

export interface ProtocolSnapshot {
  paused: boolean;
  launchDayId: number;
  suspendedUntilDay: number;
  dailies: readonly DailySnapshot[];
  runs: readonly RunSnapshot[];
  closedArenaPlayers?: readonly ClosedArenaPlayerSnapshot[];
  /** Validated permanent result root and cadence funding identity. */
  archiveState?: ArcadeRootSnapshot;
  archiveCandidates?: readonly CadenceArchiveCandidate[];
}

export interface ReconciliationDiscovery {
  plans: KeeperInstructionPlan[];
  rejectedPlans: number;
}

export const EMPTY_PROTOCOL_SNAPSHOT: ProtocolSnapshot = Object.freeze({
  paused: true,
  launchDayId: 4,
  suspendedUntilDay: 0,
  dailies: Object.freeze([]),
  runs: Object.freeze([]),
  archiveCandidates: Object.freeze([]),
});

/** Produces non-executable plans from a relationship-checked protocol snapshot. */
export function discoverReconciliation(args: {
  snapshot: ProtocolSnapshot;
  nowUnix: number;
}): ReconciliationDiscovery {
  assertSafeTimestamp(args.nowUnix);
  validateProtocolSnapshot(args.snapshot);
  const plans: KeeperInstructionPlan[] = [];
  const today = currentDayId(args.nowUnix);
  const oldestKeeperDay = Math.max(0, today - KEEPER_RECENT_DAILY_CADENCES);
  const dailyById = new Map(args.snapshot.dailies.map((daily) => [daily.dayId, daily]));
  appendCadenceArchivePlan(
    plans,
    args.snapshot,
    today,
    args.nowUnix,
  );

  if (!args.snapshot.paused) {
    const activationCurrent = scheduledDailyWindow(today, args.snapshot.suspendedUntilDay).first;
    const activationFollowing = nextScheduledDaily(
      activationCurrent,
      args.snapshot.suspendedUntilDay,
    );
    for (const daily of args.snapshot.dailies) {
      if (daily.status !== "funding") continue;
      if (daily.dayId < args.snapshot.suspendedUntilDay) {
        if (dailyById.has(args.snapshot.suspendedUntilDay)) {
          plans.push(validationOnlyPlan("skip_suspended_arena_daily", {
            dayId: daily.dayId,
            followingDayId: args.snapshot.suspendedUntilDay,
            suspendedUntilDay: args.snapshot.suspendedUntilDay,
            cadenceFunding: cadenceFundingPda(),
          }));
        }
      } else if (daily.dayId === activationCurrent &&
          args.nowUnix < dailyWindow(today).runsCloseAt) {
        plans.push(validationOnlyPlan("activate_arena_daily", {
          dayId: daily.dayId,
          suspendedUntilDay: args.snapshot.suspendedUntilDay,
        }));
      } else if (daily.dayId === activationFollowing) {
        plans.push(validationOnlyPlan("activate_arena_daily", {
          dayId: daily.dayId,
          preactivation: true,
          suspendedUntilDay: args.snapshot.suspendedUntilDay,
        }));
      }
    }
  }

  const missingDay = firstMissingScheduledCadence(
    scheduledDailyWindow(args.snapshot.launchDayId, args.snapshot.suspendedUntilDay).first,
    nextScheduledDaily(today, args.snapshot.suspendedUntilDay),
    dailyById,
  );
  // Preparation deliberately ignores `paused`: the staged launch initializes
  // the protocol paused and still needs its cadences prepared, and stopping
  // day spend is suspension's job — an unscheduled day is never missing.
  if (missingDay !== undefined && missingDay > args.snapshot.launchDayId &&
      missingDay >= oldestKeeperDay) {
    const content = dailyPairForDay(missingDay);
    const predecessor = [...dailyById.keys()]
      .filter((dayId) => dayId < missingDay)
      .sort((left, right) => right - left)[0] ?? missingDay - 1;
    plans.push(validationOnlyPlan("prepare_arena_daily", {
      dayId: predecessor,
      followingDayId: missingDay,
      launchCadenceId: args.snapshot.launchDayId,
      suspendedUntilDay: args.snapshot.suspendedUntilDay,
      pairIndex: content.pairIndex,
      realmMapId: content.realmMapId,
      cadenceFunding: cadenceFundingPda(),
    }));
  }

  for (const run of args.snapshot.runs) {
    if (run.challengeDayId !== undefined && run.challengeDayId >= oldestKeeperDay) {
      appendRunPlan(plans, run, args.nowUnix);
    }
  }

  for (const daily of args.snapshot.dailies) {
    if (daily.dayId < oldestKeeperDay) continue;
    const resolved = daily.entriesScored + daily.entriesExpired;
    appendFinalizationPlan(
      plans,
      daily,
      args.nowUnix >= daily.runsCloseAt && resolved === daily.entriesPaid &&
        (!daily.predecessorRolloverRequired || daily.predecessorRolloverApplied),
      [...dailyById.keys()]
        .filter((dayId) => dayId > daily.dayId)
        .sort((left, right) => left - right)[0],
    );
    appendBoardConstructionPlans(plans, daily);
  }

  for (const player of [...(args.snapshot.closedArenaPlayers ?? [])].sort((left, right) =>
    left.dayId - right.dayId || Buffer.compare(left.owner.toBuffer(), right.owner.toBuffer()))) {
    if (player.dayId < oldestKeeperDay) continue;
    plans.push(validationOnlyPlan("close_arena_player", {
      dayId: player.dayId, owner: player.owner, rentRecipient: player.rentPayer,
      parentDailyClosed: true,
    }));
  }

  const validated: KeeperInstructionPlan[] = [];
  let rejectedPlans = 0;
  for (const plan of plans) {
    try {
      validateKeeperPlan(plan, args.nowUnix);
      validated.push(plan);
    } catch {
      rejectedPlans += 1;
    }
  }
  return {
    plans: validated,
    rejectedPlans,
  };
}

function appendBoardConstructionPlans(
  plans: KeeperInstructionPlan[],
  daily: DailySnapshot,
): void {
  if (daily.status !== "finalized") return;
  for (const kind of ["score", "theme"] as const) {
    const board = kind === "score" ? daily.scoreBoard : daily.themeBoard;
    const sources = kind === "score" ? daily.scoreSources : daily.themeSources;
    if (!board || board.sealed || !sources) continue;
    const entries = sources.slice(
      board.cursor,
      Math.min(board.payoutCount, board.cursor + ARENA_BOARD_CHUNK_CAPACITY),
    );
    if (entries.length === 0) {
      // A malformed source window cannot advance the board.
      continue;
    }
    plans.push(validationOnlyPlan("submit_arena_board_chunk", {

      dayId: daily.dayId,
      boardKind: kind,
      boardCursor: board.cursor,
      boardPayoutCount: board.payoutCount,
      boardEntries: entries,
    }));
  }
}

export function discoverReconciliationPlans(args: {
  snapshot: ProtocolSnapshot;
  nowUnix: number;
}): KeeperInstructionPlan[] {
  return discoverReconciliation(args).plans;
}

/** The one semantic validation boundary between discovery and materialization. */
function validateKeeperPlan(plan: KeeperInstructionPlan, nowUnix: number): void {
  if (plan.execution !== "validation_only" || plan.instruction ||
      plan.instructions || !plan.context) {
    throw new Error("keeper discovery produced executable or incomplete plan data");
  }
  const context = plan.context;
  const today = currentDayId(nowUnix);
  switch (plan.operation) {
    case "prepare_arena_daily": {
      requireCadenceFunding(context);
      if (context.followingDayId === undefined || context.dayId === undefined ||
          context.followingDayId <= context.dayId ||
          context.followingDayId > nextScheduledDaily(today, context.suspendedUntilDay ?? 0)) {
        throw new Error("Daily preparation is not the exact missing successor");
      }
      const selected = dailyPairForDay(context.followingDayId);
      if (context.pairIndex !== selected.pairIndex ||
          context.realmMapId !== selected.realmMapId) {
        throw new Error("Daily preparation content is not core-derived");
      }
      return;
    }
    case "activate_arena_daily":
      if (context.dayId === undefined || context.dayId < 0 ||
          context.dayId > today + 1) {
        throw new Error("Daily activation is outside the cadence boundary");
      }
      return;
    case "skip_suspended_arena_daily":
      requireCadenceFunding(context);
      if (context.dayId === undefined || context.followingDayId === undefined ||
          context.suspendedUntilDay === undefined ||
          context.dayId >= context.suspendedUntilDay ||
          context.followingDayId !== context.suspendedUntilDay) {
        throw new Error("suspended Daily skip is not exact");
      }
      return;
    case "finish_run":
      requireRunContext(context);
      if (context.runLocation !== "ephemeral_rollup" ||
          context.deadlineAt === undefined || context.deadlineAt > nowUnix) {
        throw new Error("deadline finish timing or routing is invalid");
      }
      return;
    case "commit_run":
      requireRunContext(context);
      if (context.runLocation !== "ephemeral_rollup") {
        throw new Error("run commit routing is invalid");
      }
      return;
    case "consume_arena_run":
      requireRunContext(context);
      requireRentRecipient(context);
      if (context.runLocation !== "base" || typeof context.includeArenaPlayer !== "boolean") {
        throw new Error("Arena consumption routing is invalid");
      }
      return;
    case "expire_unresolved_arena_run":
      requireRunContext(context);
      if (context.runLocation === "ephemeral_rollup" ||
          context.recoveryDeadlineAt === undefined ||
          context.recoveryDeadlineAt > nowUnix) {
        throw new Error("unresolved run expiry is invalid");
      }
      return;
    case "finalize_arena_daily":
      requireCadenceFunding(context);
      requireRecentDay(context.dayId, today);
      if (context.followingDayId === undefined ||
          context.followingDayId <= context.dayId! ||
          context.payoutTotalLamports === undefined ||
          context.rolloverLamports === undefined ||
          context.potLamports !== context.payoutTotalLamports + context.rolloverLamports) {
        throw new Error("Daily finalization does not conserve its pot");
      }
      return;
    case "submit_arena_board_chunk":
      requireRecentDay(context.dayId, today);
      if ((context.boardKind !== "score" && context.boardKind !== "theme") ||
          context.boardCursor === undefined || context.boardPayoutCount === undefined ||
          !context.boardEntries || context.boardEntries.length < 1 ||
          context.boardEntries.length > ARENA_BOARD_CHUNK_CAPACITY ||
          context.boardCursor + context.boardEntries.length > context.boardPayoutCount) {
        throw new Error("Daily board chunk is invalid");
      }
      return;
    case "archive_arena_daily":
      requireArchiveContext(context, today);
      if (context.archiveCommitted !== false) {
        throw new Error("Daily root append is already committed");
      }
      return;
    case "expire_daily_claims":
      requireArchiveContext(context, today);
      if (!context.archiveCommitted || context.claimsExpired ||
          context.claimCloseAt === undefined || context.claimCloseAt >= nowUnix ||
          context.followingDayId !==
            nextScheduledDaily(today, context.suspendedUntilDay ?? 0)) {
        throw new Error("Daily claim expiry is invalid");
      }
      return;
    case "close_arena_daily":
      requireArchiveContext(context, today);
      if (!context.archiveCommitted || !context.claimsExpired ||
          context.claimCloseAt === undefined || context.claimCloseAt >= nowUnix) {
        throw new Error("Daily closure is not root-gated and expired");
      }
      return;
    case "close_arena_player":
      requireRecentDay(context.dayId, today);
      requireRentRecipient(context);
      if (!context.owner || context.owner.equals(PublicKey.default) || context.parentDailyClosed !== true) {
        throw new Error("ArenaPlayer closure requires its owner and closed parent Daily");
      }
      return;
    default:
      throw new Error(`keeper operation is outside the exact allowlist: ${String(plan.operation)}`);
  }
}

function requireRunContext(
  context: KeeperPlanContext,
): void {
  if (!context.owner || context.owner.equals(PublicKey.default) ||
      context.runId === undefined || context.runId < 1n) {
    throw new Error("keeper run identity is invalid");
  }
}

function requireRentRecipient(context: KeeperPlanContext): void {
  if (!context.rentRecipient || context.rentRecipient.equals(PublicKey.default)) {
    throw new Error("keeper close recipient is invalid");
  }
}

function requireCadenceFunding(context: KeeperPlanContext): void {
  if (!context.cadenceFunding?.equals(cadenceFundingPda())) {
    throw new Error("keeper cadence funding identity is invalid");
  }
}

function requireArchiveContext(context: KeeperPlanContext, today: number): void {
  requireRecentDay(context.dayId, today);
  if (!context.arcadeConfig?.equals(arcadeConfigPda()) ||
      !context.cadenceFunding?.equals(cadenceFundingPda())) {
    throw new Error("keeper Daily root identity is invalid");
  }
}

function requireRecentDay(dayId: number | undefined, today: number): void {
  if (dayId === undefined || dayId > today ||
      dayId < Math.max(0, today - KEEPER_RECENT_DAILY_CADENCES)) {
    throw new Error("keeper Daily is outside its bounded window");
  }
}

function appendCadenceArchivePlan(
  plans: KeeperInstructionPlan[],
  snapshot: ProtocolSnapshot,
  today: number,
  nowUnix: number,
): void {
  const state = snapshot.archiveState;
  if (!state) return;
  const ordered = [...(snapshot.archiveCandidates ?? [])]
    .sort((left, right) => left.cadenceId - right.cadenceId);
  const nextArchiveId = state.lastDailyId === undefined ||
      state.lastDailyId < snapshot.launchDayId
    ? snapshot.launchDayId
    : ordered.find(({ cadenceId }) => cadenceId > state.lastDailyId!)?.cadenceId;
  const contextFor = (candidate: CadenceArchiveCandidate) => ({

    dayId: candidate.cadenceId,
    cadenceFunding: state.cadenceFunding,
    arcadeConfig: state.address,
    archiveCommitted: candidate.committed,
    claimsExpired: candidate.claimsExpired,
    claimCloseAt: candidate.closeEligibleAt,
  });
  const nextArchive = ordered.find((candidate) =>
    !candidate.committed && candidate.cadenceId === nextArchiveId
  );
  if (nextArchive && nextArchive.cadenceId <= today) {
    plans.push(validationOnlyPlan(
      "archive_arena_daily",
      contextFor(nextArchive),
    ));
  }

  for (const candidate of ordered) {
    if (!candidate.committed || candidate.cadenceId > today) continue;
    const context = contextFor(candidate);
    if (!candidate.claimsExpired && nowUnix > candidate.closeEligibleAt) {
      const followingDayId = nextScheduledDaily(
        today,
        snapshot.suspendedUntilDay,
      );
      const following = snapshot.dailies.find(({ dayId }) => dayId === followingDayId);
      const daily = snapshot.dailies.find(({ dayId }) => dayId === candidate.cadenceId);
      if ((following?.status === "funding" || following?.status === "open") &&
          daily?.settlement) {
        plans.push(validationOnlyPlan("expire_daily_claims", {
          ...context,
          followingDayId,
          suspendedUntilDay: snapshot.suspendedUntilDay,
        }));
      }
    } else if (candidate.claimsExpired && nowUnix > candidate.closeEligibleAt) {
      plans.push(validationOnlyPlan("close_arena_daily", context));
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
    rentRecipient: run.rentPayer,
    runId: run.runId,
    runLocation: run.location,
    includeArenaPlayer: run.arenaPlayerExists,
    deadlineAt: run.runsCloseAt,
    recoveryDeadlineAt: run.recoveryDeadlineAt,
  } as const;

  if (forceFinishEligible &&
      run.location === "ephemeral_rollup" && run.runsCloseAt !== undefined &&
      nowUnix >= run.runsCloseAt) {
    plans.push(validationOnlyPlan("finish_run", context));
    return;
  }
  if (run.reservationActive &&
      (inProgress || run.lifecycle === "unavailable") &&
      run.recoveryDeadlineAt !== undefined && nowUnix >= run.recoveryDeadlineAt) {
    plans.push(validationOnlyPlan("expire_unresolved_arena_run", {
      ...context,
      includeArenaPlayer: true,
    }));
    return;
  }
  if (run.lifecycle === "terminal" && run.location === "ephemeral_rollup") {
    plans.push(validationOnlyPlan("commit_run", context));
    return;
  }
  if (run.reservationActive && run.lifecycle === "terminal" && run.location === "base") {
    plans.push(validationOnlyPlan(
      "consume_arena_run",
      context,
    ));
    return;
  }
  if (!run.reservationActive && run.location === "base" &&
      run.recoveryDeadlineAt !== undefined && nowUnix >= run.recoveryDeadlineAt) {
    plans.push(validationOnlyPlan("consume_arena_run", { ...context, includeArenaPlayer: false }));
  }
}

export function validateProtocolSnapshot(snapshot: ProtocolSnapshot): void {
  if (typeof snapshot.paused !== "boolean") {
    throw new Error("protocol pause state is invalid");
  }
  assertCadenceId(snapshot.launchDayId, "launch day id");
  assertCadenceId(snapshot.suspendedUntilDay, "suspended-until day");
  assertUnique(snapshot.dailies.map(({ dayId }) => dayId), "Daily id");
  assertUnique(snapshot.runs.map(({ owner, runId }) => `${owner.toBase58()}:${runId}`), "run");
  validateArchiveSnapshot(snapshot);

  for (const daily of snapshot.dailies) {
    assertCadenceId(daily.dayId, "day id");
    assertSafeTimestamp(daily.runsCloseAt);
    assertSafeTimestamp(daily.recoveryDeadlineAt);
    assertSafeTimestamp(daily.finalizedAt);
    const window = dailyWindow(daily.dayId);
    if (daily.runsCloseAt !== window.runsCloseAt ||
        daily.recoveryDeadlineAt !== window.recoveryDeadlineAt) {
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
    for (const [label, count] of Object.entries({
      scoreQualifiedPlayers: daily.scoreQualifiedPlayers,
      themeQualifiedPlayers: daily.themeQualifiedPlayers,
    })) assertCadenceId(count, `Daily ${label}`);
    if (!["funding", "open", "finalized"].includes(daily.status)) {
      throw new Error("Daily status is invalid");
    }
    if ((daily.status === "finalized") !== (daily.finalizedAt > 0) ||
        typeof daily.claimsExpired !== "boolean" ||
        (daily.claimsExpired && daily.status !== "finalized") ||
        !validPayoutMask(daily.scoreClaimedMask) ||
        !validPayoutMask(daily.themeClaimedMask)) {
      throw new Error("Daily claim state is invalid");
    }
    if (daily.status === "finalized") {
      for (const [label, board] of [
        ["Score", daily.scoreBoard],
        ["Theme", daily.themeBoard],
      ] as const) {
        if (!board || board.payoutCount > ARENA_BOARD_CAPACITY ||
            board.cursor > board.payoutCount ||
            board.sealed !== (board.cursor === board.payoutCount) ||
            board.sealed !== (board.sealedAt > 0) ||
            board.claimedCount > board.payoutCount) {
          throw new Error(`Daily ${label} board construction is invalid`);
        }
      }
      if (daily.entriesScored + daily.entriesExpired !== daily.entriesPaid) {
        throw new Error("finalized Daily retains unresolved paid entries");
      }
    } else if (daily.scoreBoard || daily.themeBoard) {
      throw new Error("non-finalized Daily has payout board accounts");
    }
    validateSettlement(
      daily.potLamports,
      daily.scoreQualifiedPlayers,
      daily.themeQualifiedPlayers,
      daily.settlement,
    );
    validateClaimMask("score", daily.scoreClaimedMask, daily.settlement);
    validateClaimMask("theme", daily.themeClaimedMask, daily.settlement);
  }
  const closed = snapshot.closedArenaPlayers ?? [];
  assertUnique(closed.map((player) => `${player.dayId}:${player.owner.toBase58()}`), "closed ArenaPlayer");
  for (const player of closed) {
    assertCadenceId(player.dayId, "closed ArenaPlayer day");
    if (player.dayId < snapshot.launchDayId ||
        player.dayId > (snapshot.archiveState?.lastDailyId ?? -1) ||
        snapshot.dailies.some(({ dayId }) => dayId === player.dayId) ||
        player.owner.equals(PublicKey.default) || player.rentPayer.equals(PublicKey.default)) {
      throw new Error("ArenaPlayer cleanup is not bound to a closed archived Daily");
    }
  }
  for (const run of snapshot.runs) validateRun(snapshot, run);
}

function validateArchiveSnapshot(snapshot: ProtocolSnapshot): void {
  const candidates = snapshot.archiveCandidates ?? [];
  const state = snapshot.archiveState;
  if (candidates.length === 0 && !state) return;
  if (!state || !state.address.equals(arcadeConfigPda()) ||
      !state.cadenceFunding.equals(cadenceFundingPda()) ||
      !/^[0-9a-f]{64}$/.test(state.dailyRoot)) {
    throw new Error("Arcade root or cadence funding identity is invalid");
  }
  if (state.lastDailyId !== undefined) {
    assertCadenceId(state.lastDailyId, "last archived Daily id");
  }
  assertUnique(candidates.map(({ cadenceId }) => cadenceId), "cadence archive");
  for (const candidate of candidates) {
    assertCadenceId(candidate.cadenceId, "archive cadence id");
    const daily = snapshot.dailies.find(({ dayId }) => dayId === candidate.cadenceId);
    if (!daily || daily.status !== "finalized" ||
        typeof candidate.claimsExpired !== "boolean") {
      throw new Error("cadence archive candidate is not terminal");
    }
    assertSafeTimestamp(candidate.closeEligibleAt);
    const boardClaimCloseAt = Math.max(
      daily.scoreBoard!.sealedAt,
      daily.themeBoard!.sealedAt,
    ) + DAILY_REWARD_CLAIM_WINDOW_SECONDS;
    if (candidate.closeEligibleAt !== boardClaimCloseAt) {
      throw new Error("Daily archive claim-close time is invalid");
    }
  }
}

function validateRun(snapshot: ProtocolSnapshot, run: RunSnapshot): void {
  if (!(run.owner instanceof PublicKey) || run.owner.equals(PublicKey.default)) {
    throw new Error("run owner is invalid");
  }
  if (run.runId < 1n || run.runId > 0xffff_ffff_ffff_ffffn) {
    throw new Error("run id is invalid");
  }
  if (!Number.isSafeInteger(run.acceptedActions) || run.acceptedActions < 0 ||
      run.acceptedActions > 0xffff_ffff) {
    throw new Error("run accepted-action count is invalid");
  }
  if (run.challengeDayId === undefined ||
      run.deadlineDayId !== run.challengeDayId) {
    throw new Error("arcade run cadence is invalid");
  }
  assertCadenceId(run.challengeDayId, "run challenge day");
  const daily = snapshot.dailies.find(({ dayId }) => dayId === run.challengeDayId);
  if (!daily || run.runsCloseAt !== daily.runsCloseAt ||
      run.recoveryDeadlineAt !== daily.recoveryDeadlineAt ||
      !run.arenaPlayerExists) {
    throw new Error("arcade run does not match its Daily");
  }
}


function appendFinalizationPlan(
  plans: KeeperInstructionPlan[],
  daily: DailySnapshot,
  ready: boolean,
  successorDayId: number | undefined,
): void {
  if (!ready || daily.status === "finalized" || !daily.settlement ||
      successorDayId === undefined) return;
  const payoutTotal = daily.settlement.winners
    .reduce((sum, winner) => sum + winner.payoutLamports, 0n);
  plans.push(validationOnlyPlan("finalize_arena_daily", {

    dayId: daily.dayId,
    followingDayId: successorDayId,
    scoreCapacityLimited: daily.settlement.scoreCapacityLimited,
    themeCapacityLimited: daily.settlement.themeCapacityLimited,
    payoutTotalLamports: payoutTotal,
    potLamports: payoutTotal + daily.settlement.rolloverLamports,
    rolloverLamports: daily.settlement.rolloverLamports,
    cadenceFunding: cadenceFundingPda(),
  }));
}

function validateClaimMask(
  board: DailyBoardKind,
  claimedMask: bigint,
  settlement: SettlementSnapshot | undefined,
): void {
  if (!validPayoutMask(claimedMask)) {
    throw new Error("daily claim mask is invalid");
  }
  if (claimedMask === 0n) return;
  if (!settlement) throw new Error("daily claim mask has no finalized settlement");
  const winnerMask = settlement.winners.reduce(
    (mask, winner) => winner.board === board && winner.payoutLamports > 0n
      ? mask | winnerPositionBit(winner)
      : mask,
    0n,
  );
  if ((claimedMask & ~winnerMask) !== 0n) {
    throw new Error("daily claim mask references a non-winner");
  }
}

function winnerPositionBit(winner: WinnerSnapshot): bigint {
  return 1n << BigInt(winner.rank - 1);
}

function validateSettlement(
  potLamports: bigint,
  scoreQualifiedPlayers: number,
  themeQualifiedPlayers: number,
  settlement: SettlementSnapshot | undefined,
): void {
  if (!settlement) return;
  if (settlement.winners.length > ARENA_BOARD_CAPACITY * 2) {
    throw new Error("daily has too many payout positions");
  }
  assertLamports(settlement.rolloverLamports, "daily rollover");
  const pools = dailyBoardPools(potLamports, themeQualifiedPlayers);
  let payouts = 0n;
  for (const board of ["score", "theme"] as const) {
    const ordered = settlement.winners
      .filter((winner) => winner.board === board)
      .sort((left, right) => left.rank - right.rank);
    assertUnique(ordered.map(({ owner }) => owner.toBase58()), `${board} board winner`);
    assertContiguousRanks(ordered);
    const qualified = board === "score" ? scoreQualifiedPlayers : themeQualifiedPlayers;
    const plan = payoutPlan(
      pools[board],
      qualified,
      ARENA_ENTRY_LAMPORTS,
      SOL_PAYOUT_UNIT_LAMPORTS,
    );
    if (ordered.length !== plan.winnerCount) {
      throw new Error(`${board} winner count does not match the canonical board width`);
    }
    const limited = board === "score"
      ? settlement.scoreCapacityLimited
      : settlement.themeCapacityLimited;
    if (limited !== plan.capacityLimited) {
      throw new Error(`${board} capacity condition is not canonical`);
    }
    ordered.forEach((winner, index) => {
      assertPayoutLamports(winner.payoutLamports, `${board} payout`);
      if (winner.payoutLamports !== plan.payouts[index]) {
        throw new Error("winner payout does not match the canonical rank curve");
      }
      payouts += winner.payoutLamports;
    });
  }
  if (payouts + settlement.rolloverLamports !== potLamports) {
    throw new Error("daily payouts and rollover do not conserve the pot");
  }
}

function assertContiguousRanks(winners: readonly WinnerSnapshot[]): void {
  winners.forEach((winner, index) => {
    if (!Number.isSafeInteger(winner.rank) || winner.rank !== index + 1) {
      throw new Error("daily winner ranks are not contiguous");
    }
  });
}

function firstMissingScheduledCadence<T>(
  first: number,
  lastInclusive: number,
  values: ReadonlyMap<number, T>,
): number | undefined {
  for (let id = first; id <= lastInclusive; id += 1) {
    if (!values.has(id)) return id;
  }
  return undefined;
}

function validPayoutMask(mask: bigint): boolean {
  const maximumMask = (1n << BigInt(ARENA_BOARD_CAPACITY)) - 1n;
  return mask >= 0n && mask <= maximumMask;
}

function validatePredecessorFlag(expected: boolean, actual: boolean, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} predecessor rollover requirement is invalid`);
  }
}

function assertUnique(values: readonly (number | string)[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} values are not unique`);
  }
}
