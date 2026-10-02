import { PublicKey } from "@solana/web3.js";

import {
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  KEEPER_RECENT_DAILY_CADENCES,
  assertSafeTimestamp,
  currentDayId,
  keeperPlan,
  type KeeperInstructionPlan,
} from "./arcadeChain.js";
import { preparableDaily } from "./zkubeCore.js";

export type RunLifecycle =
  | "prepared"
  | "delegated"
  | "awaiting_vrf"
  | "playing"
  | "terminal"
  | "unavailable";
export type RunLocation = "base" | "ephemeral_rollup" | "unavailable";

export interface DailySnapshot {
  dayId: number;
  /** Zero while the Daily runs; the program keeps no other status. */
  finalizedAt: number;
  runsCloseAt: number;
  recoveryDeadlineAt: number;
  entriesPaid: bigint;
  entriesScored: bigint;
  entriesExpired: bigint;
  /** The Daily prepared before this one: its only funding predecessor. */
  predecessorDayId: number;
  predecessorRolloverApplied: boolean;
  /** What its boards pay in total; zero until it finalizes. */
  payoutLamports: bigint;
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

export interface ClosedArenaPlayerSnapshot {
  dayId: number;
  owner: PublicKey;
  rentPayer: PublicKey;
}

export interface ProtocolSnapshot {
  paused: boolean;
  launchDayId: number;
  suspendedUntilDay: number;
  /** The newest prepared Daily; preparation only moves forward from it. */
  lastPreparedDay: number;
  dailies: readonly DailySnapshot[];
  runs: readonly RunSnapshot[];
  closedArenaPlayers?: readonly ClosedArenaPlayerSnapshot[];
}

/**
 * The backstop's work. Players' own transactions carry the cadence that
 * play and payout need: an entry prepares its day and a claim finalizes it.
 * These plans do the same steps a little earlier, close what nobody is
 * waiting on, and settle runs their players walked away from.
 */
export function discoverReconciliation(args: {
  snapshot: ProtocolSnapshot;
  nowUnix: number;
}): KeeperInstructionPlan[] {
  assertSafeTimestamp(args.nowUnix);
  const { snapshot, nowUnix } = args;
  const plans: KeeperInstructionPlan[] = [];
  const today = currentDayId(nowUnix);
  const oldestKeeperDay = Math.max(0, today - KEEPER_RECENT_DAILY_CADENCES);
  const newest = snapshot.dailies.find(({ dayId }) => dayId === snapshot.lastPreparedDay);

  // The one Daily the program lets anyone prepare: today's, or during a
  // suspension the first day after it.
  const preparable = preparableDaily(today, snapshot.launchDayId, snapshot.suspendedUntilDay);
  if (snapshot.launchDayId > 0 && snapshot.lastPreparedDay < preparable) {
    plans.push(keeperPlan("prepare_arena_daily", { dayId: preparable }));
  }

  for (const run of snapshot.runs) {
    if (run.dayId !== undefined && run.dayId >= oldestKeeperDay) appendRunPlan(plans, run, nowUnix);
  }

  for (const daily of snapshot.dailies) {
    if (daily.dayId < oldestKeeperDay) continue;
    const successor = snapshot.dailies.find(({ predecessorDayId }) => predecessorDayId === daily.dayId);
    if (daily.finalizedAt === 0) {
      // The program's rule: the window has closed, and every entry is
      // resolved or the recovery deadline has passed.
      const resolved = daily.entriesScored + daily.entriesExpired === daily.entriesPaid;
      if (successor && successor.finalizedAt === 0 && daily.predecessorRolloverApplied &&
          nowUnix >= daily.runsCloseAt && (resolved || nowUnix >= daily.recoveryDeadlineAt)) {
        plans.push(keeperPlan("finalize_arena_daily", { dayId: daily.dayId, followingDayId: successor.dayId }));
      }
    } else if (daily.payoutLamports === 0n) {
      // It paid nothing: there is no claim to wait for.
      plans.push(keeperPlan("close_arena_daily", { dayId: daily.dayId }));
    } else if (nowUnix > daily.finalizedAt + DAILY_REWARD_CLAIM_WINDOW_SECONDS &&
        newest && newest.finalizedAt === 0 && newest.dayId !== daily.dayId) {
      // What was never claimed moves into the newest prepared Daily.
      plans.push(keeperPlan("close_arena_daily", { dayId: daily.dayId, followingDayId: newest.dayId }));
    }
  }

  for (const player of [...(snapshot.closedArenaPlayers ?? [])].sort((left, right) =>
    left.dayId - right.dayId || Buffer.compare(left.owner.toBuffer(), right.owner.toBuffer()))) {
    if (player.dayId < oldestKeeperDay) continue;
    plans.push(keeperPlan("close_arena_player", {
      dayId: player.dayId, owner: player.owner, rentRecipient: player.rentPayer,
    }));
  }

  return plans.filter(({ context }) =>
    context.dayId !== undefined && context.dayId >= oldestKeeperDay && context.dayId <= preparable);
}

function appendRunPlan(
  plans: KeeperInstructionPlan[],
  run: RunSnapshot,
  nowUnix: number,
): void {
  const context = {
    dayId: run.dayId,
    owner: run.owner,
    rentRecipient: run.rentPayer,
    runId: run.runId,
    includeArenaPlayer: run.arenaPlayerExists,
  } as const;
  const pastRecovery = run.recoveryDeadlineAt !== undefined && nowUnix >= run.recoveryDeadlineAt;

  if (["delegated", "awaiting_vrf", "playing"].includes(run.lifecycle) &&
      run.location === "ephemeral_rollup" && run.runsCloseAt !== undefined &&
      nowUnix >= run.runsCloseAt) {
    plans.push(keeperPlan("finish_run", context));
    return;
  }
  if (run.lifecycle === "terminal" && run.location === "ephemeral_rollup") {
    plans.push(keeperPlan("commit_run", context));
    return;
  }
  if (run.location !== "base") return;
  // A finished run back on Base is consumed: scored while its recovery
  // window is open. Past it, any run on Base is only closed, its slot freed
  // and its rent returned; nothing has to expire it first.
  if ((run.reservationActive && run.lifecycle === "terminal") || pastRecovery) {
    plans.push(keeperPlan("consume_arena_run", pastRecovery && !run.reservationActive
      ? { ...context, includeArenaPlayer: false } : context));
  }
}
