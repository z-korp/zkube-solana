import { PublicKey } from "@solana/web3.js";

import {
  KEEPER_RECENT_DAILY_CADENCES,
  ARENA_BOARD_CHUNK_CAPACITY,
  assertSafeTimestamp,
  currentDayId,
  nextScheduledDaily,
  keeperPlan,
  type DailyBoardKind,
  type KeeperInstructionPlan,
} from "./arcadeChain.js";
import { dailyWindow, scheduledDailyWindow } from "./zkubeCore.js";

export type PeriodStatus = "funding" | "open" | "finalized";
export type RunLifecycle =
  | "prepared"
  | "delegated"
  | "awaiting_vrf"
  | "playing"
  | "terminal"
  | "unavailable";
export type RunLocation = "base" | "ephemeral_rollup" | "unavailable";

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
  cursor: number;
  sealed: boolean;
  sealedAt: number;
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
  predecessorRolloverRequired: boolean;
  predecessorRolloverApplied: boolean;
  claimsExpired: boolean;
  scoreSources?: readonly BoardSourceSnapshot[];
  themeSources?: readonly BoardSourceSnapshot[];
  scoreBoard?: BoardConstructionSnapshot;
  themeBoard?: BoardConstructionSnapshot;
}

export interface RunSnapshot {
  owner: PublicKey;
  rentPayer?: PublicKey;
  runId: bigint;
  /** The Daily owning this arcade run. */
  dayId?: number;
  arenaPlayerExists: boolean;
  lifecycle: RunLifecycle;
  location: RunLocation;
  runsCloseAt?: number;
  recoveryDeadlineAt?: number;
  /** False means durable state has moved this id to the orphan reservation. */
  reservationActive: boolean;
}

export interface ArcadeRootSnapshot {
  lastDailyId?: number;
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
  archiveState?: ArcadeRootSnapshot;
  archiveCandidates?: readonly CadenceArchiveCandidate[];
}

/** Selects the next cadence work from decoded state. */
export function discoverReconciliation(args: {
  snapshot: ProtocolSnapshot;
  nowUnix: number;
}): KeeperInstructionPlan[] {
  assertSafeTimestamp(args.nowUnix);
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
          plans.push(keeperPlan("skip_suspended_arena_daily", {
            dayId: daily.dayId,
            followingDayId: args.snapshot.suspendedUntilDay,
          }));
        }
      } else if (daily.dayId === activationCurrent &&
          args.nowUnix < dailyWindow(today).runsCloseAt) {
        plans.push(keeperPlan("activate_arena_daily", {
          dayId: daily.dayId,
        }));
      } else if (daily.dayId === activationFollowing) {
        plans.push(keeperPlan("activate_arena_daily", {
          dayId: daily.dayId,
        }));
      }
    }
  }

  const missingDay = firstMissingScheduledCadence(
    Math.max(oldestKeeperDay, (args.snapshot.archiveState?.lastDailyId ?? -1) + 1,
      scheduledDailyWindow(args.snapshot.launchDayId, args.snapshot.suspendedUntilDay).first),
    nextScheduledDaily(today, args.snapshot.suspendedUntilDay),
    dailyById,
  );
  // Preparation deliberately ignores `paused`: the staged launch initializes
  // the protocol paused and still needs its cadences prepared, and stopping
  // day spend is suspension's job — an unscheduled day is never missing.
  if (missingDay !== undefined && missingDay > args.snapshot.launchDayId &&
      missingDay >= oldestKeeperDay) {
    plans.push(keeperPlan("prepare_arena_daily", {
      followingDayId: missingDay,
    }));
  }

  for (const run of args.snapshot.runs) {
    if (run.dayId !== undefined && run.dayId >= oldestKeeperDay) {
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
    plans.push(keeperPlan("close_arena_player", {
      dayId: player.dayId, owner: player.owner, rentRecipient: player.rentPayer,
    }));
  }

  return plans.filter(({ operation, context }) => {
    const day = operation === "prepare_arena_daily" ? context.followingDayId : context.dayId;
    return day !== undefined && day >= oldestKeeperDay && day <= scheduledDailyWindow(today, args.snapshot.suspendedUntilDay).following;
  });
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
    plans.push(keeperPlan("submit_arena_board_chunk", {

      dayId: daily.dayId,
      boardKind: kind,
      boardEntries: entries,
    }));
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
  });
  const nextArchive = ordered.find((candidate) =>
    !candidate.committed && candidate.cadenceId === nextArchiveId
  );
  if (nextArchive && nextArchive.cadenceId <= today) {
    plans.push(keeperPlan(
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
          daily?.status === "finalized") {
        plans.push(keeperPlan("expire_daily_claims", {
          ...context,
          followingDayId,
        }));
      }
    } else if (candidate.claimsExpired && nowUnix > candidate.closeEligibleAt) {
      plans.push(keeperPlan("close_arena_daily", context));
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
    dayId: run.dayId,
    owner: run.owner,
    rentRecipient: run.rentPayer,
    runId: run.runId,
    includeArenaPlayer: run.arenaPlayerExists,
  } as const;

  if (forceFinishEligible &&
      run.location === "ephemeral_rollup" && run.runsCloseAt !== undefined &&
      nowUnix >= run.runsCloseAt) {
    plans.push(keeperPlan("finish_run", context));
    return;
  }
  if (run.reservationActive &&
      (inProgress || run.lifecycle === "unavailable") &&
      run.recoveryDeadlineAt !== undefined && nowUnix >= run.recoveryDeadlineAt) {
    plans.push(keeperPlan("expire_unresolved_arena_run", {
      ...context,
      includeArenaPlayer: true,
    }));
    return;
  }
  if (run.lifecycle === "terminal" && run.location === "ephemeral_rollup") {
    plans.push(keeperPlan("commit_run", context));
    return;
  }
  if (run.reservationActive && run.lifecycle === "terminal" && run.location === "base") {
    plans.push(keeperPlan(
      "consume_arena_run",
      context,
    ));
    return;
  }
  if (!run.reservationActive && run.location === "base" &&
      run.recoveryDeadlineAt !== undefined && nowUnix >= run.recoveryDeadlineAt) {
    plans.push(keeperPlan("consume_arena_run", { ...context, includeArenaPlayer: false }));
  }
}

function appendFinalizationPlan(
  plans: KeeperInstructionPlan[],
  daily: DailySnapshot,
  ready: boolean,
  successorDayId: number | undefined,
): void {
  if (!ready || daily.status === "finalized" ||
      successorDayId === undefined) return;
  plans.push(keeperPlan("finalize_arena_daily", {

    dayId: daily.dayId,
    followingDayId: successorDayId,
  }));
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
