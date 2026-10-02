import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  DAILY_RUN_CLOSE_OFFSET,
  KEEPER_PLAN_INSTRUCTION,
} from "../src/arcadeChain.js";
import {
  discoverReconciliation,
  type DailySnapshot,
  type ProtocolSnapshot,
} from "../src/arcadeReconciliation.js";
import { dailyWindow } from "../src/zkubeCore.js";
// The instant a day opens; the core owns the boundary (07:00 UTC).
const opens = (day: number) => dailyWindow(day).opensAt;

const DAY = 20_651;
const closes = (day: number) => opens(day) + DAILY_RUN_CLOSE_OFFSET;
const recoveryEnds = (day: number) => opens(day) + DAILY_RECOVERY_DEADLINE_OFFSET;
const plansOf = (snapshotOverrides: Partial<ProtocolSnapshot>, nowUnix: number) =>
  discoverReconciliation({ snapshot: snapshot(snapshotOverrides), nowUnix });
const of = (plans: ReturnType<typeof discoverReconciliation>, operation: string) =>
  plans.filter((plan) => plan.operation === operation).map(({ context }) => context);

describe("backstop keeper reconciliation", () => {
  it("keeper_backstop_prepares_only_the_one_daily_the_program_lets_anyone_prepare", () => {
    // Today's Daily, once: an entry would prepare it too, and whoever comes second changes nothing.
    expect(of(plansOf({ dailies: [daily(DAY - 3)] }, opens(DAY) + 1), "prepare_arena_daily")).toEqual([{ dayId: DAY }]);
    expect(of(plansOf({ dailies: [daily(DAY)] }, opens(DAY) + 1), "prepare_arena_daily")).toEqual([]);
    // Days nobody played are never prepared afterwards: only today's can be.
    expect(of(plansOf({ dailies: [daily(DAY - 9)] }, opens(DAY) + 1), "prepare_arena_daily")).toEqual([{ dayId: DAY }]);
    // During a suspension the one preparable day is the first after it, where a finished day's money goes.
    const suspended = { suspendedUntilDay: DAY + 4, dailies: [daily(DAY - 1)] };
    expect(of(plansOf(suspended, opens(DAY) + 1), "prepare_arena_daily")).toEqual([{ dayId: DAY + 4 }]);
    expect(of(plansOf({ ...suspended, dailies: [daily(DAY - 1), { ...daily(DAY + 4), predecessorDayId: DAY - 1 }] },
      opens(DAY) + 1), "prepare_arena_daily")).toEqual([]);
    // Before launch the operator's own transaction prepares the first Daily.
    expect(of(plansOf({ launchDayId: 0, dailies: [] }, opens(DAY) + 1), "prepare_arena_daily")).toEqual([]);
  });

  it("keeper_finalizes_by_the_clock_once_the_day_has_a_successor", () => {
    const played = { ...daily(DAY), entriesPaid: 3n, entriesScored: 2n };
    const resolved = { ...played, entriesExpired: 1n };
    const next = { ...daily(DAY + 3), predecessorDayId: DAY, predecessorRolloverApplied: false };
    const finalization = (dailies: DailySnapshot[], nowUnix: number) =>
      of(plansOf({ dailies }, nowUnix), "finalize_arena_daily");
    const expected = [{ dayId: DAY, followingDayId: DAY + 3 }];
    // Resolved: as soon as its window has closed. The successor is the Daily prepared after it, days later.
    expect(finalization([resolved, next], closes(DAY) - 1)).toEqual([]);
    expect(finalization([resolved, next], closes(DAY))).toEqual(expected);
    // A run still in flight holds it only until the recovery deadline, never longer.
    expect(finalization([played, next], recoveryEnds(DAY) - 1)).toEqual([]);
    expect(finalization([played, next], recoveryEnds(DAY))).toEqual(expected);
    // No successor yet: nothing to finalize into. The same pass prepares today's Daily, which becomes it.
    expect(finalization([resolved], opens(DAY + 3) + 1)).toEqual([]);
    expect(of(plansOf({ dailies: [resolved] }, opens(DAY + 3) + 1), "prepare_arena_daily")).toEqual([{ dayId: DAY + 3 }]);
    // A later Daily that names another predecessor is not its successor, and a day whose own
    // predecessor has not finalized into it waits its turn.
    expect(finalization([resolved, { ...next, predecessorDayId: DAY + 1 }], closes(DAY))).toEqual([]);
    expect(finalization([{ ...resolved, predecessorRolloverApplied: false }, next], closes(DAY))).toEqual([]);
    expect(finalization([{ ...resolved, finalizedAt: closes(DAY) }, next], closes(DAY) + 9)).toEqual([]);
  });

  it("keeper_closes_a_daily_that_paid_nothing_at_once_and_the_others_after_their_claim_window", () => {
    const finalizedAt = closes(DAY) + 60;
    const empty = { ...daily(DAY), finalizedAt };
    const paid = { ...empty, payoutLamports: 5_000_000n };
    const newest = { ...daily(DAY + 40), predecessorDayId: DAY };
    const closure = (dailies: DailySnapshot[], nowUnix: number) => of(plansOf({ dailies }, nowUnix), "close_arena_daily");
    // Nothing to claim: it closes at once, and needs no destination.
    expect(closure([empty, newest], finalizedAt + 1)).toEqual([{ dayId: DAY }]);
    // Winners have thirty days from the finalization; then what they left moves into the newest prepared Daily.
    expect(closure([paid, newest], finalizedAt + DAILY_REWARD_CLAIM_WINDOW_SECONDS)).toEqual([]);
    expect(closure([paid, newest], finalizedAt + DAILY_REWARD_CLAIM_WINDOW_SECONDS + 1))
      .toEqual([{ dayId: DAY, followingDayId: DAY + 40 }]);
    // With no running Daily to receive it, the close waits: nothing is lost by waiting.
    expect(closure([paid], opens(DAY + 40))).toEqual([]);
    expect(closure([paid, { ...newest, finalizedAt: 1, payoutLamports: 1n }],
      opens(DAY + 41) + DAILY_REWARD_CLAIM_WINDOW_SECONDS)).toEqual([]);
  });

  it("keeper_settles_abandoned_runs_by_state_and_location_and_expires_none", () => {
    const run = (lifecycle: "playing" | "terminal" | "unavailable" | "prepared",
      location: "base" | "ephemeral_rollup" | "unavailable", reservationActive = true) => ({
      owner: Keypair.generate().publicKey, rentPayer: Keypair.generate().publicKey, runId: 2n, dayId: DAY,
      arenaPlayerExists: true, lifecycle, location, runsCloseAt: closes(DAY), recoveryDeadlineAt: recoveryEnds(DAY),
      reservationActive,
    });
    const operations = (runs: ReturnType<typeof run>[], nowUnix: number) =>
      plansOf({ dailies: [daily(DAY)], runs }, nowUnix).map(({ operation }) => operation)
        .filter((operation) => operation.endsWith("_run"));
    // While the day runs, a run in play is left alone; a finished one is brought back and consumed.
    expect(operations([run("playing", "ephemeral_rollup")], closes(DAY) - 1)).toEqual([]);
    expect(operations([run("terminal", "ephemeral_rollup"), run("terminal", "base")], closes(DAY) - 1))
      .toEqual(["commit_run", "consume_arena_run"]);
    // After the close an abandoned run is finished at its last accepted state, so it still scores.
    expect(operations([run("playing", "ephemeral_rollup")], closes(DAY))).toEqual(["finish_run"]);
    // Past the recovery deadline nothing is expired: the day finalizes by the clock, and any run
    // back on Base is only closed. One that cannot be reached is left for its player's next entry.
    expect(operations([run("prepared", "base"), run("playing", "base", false), run("unavailable", "unavailable")],
      recoveryEnds(DAY))).toEqual(["consume_arena_run", "consume_arena_run"]);
    expect(operations([run("prepared", "base")], recoveryEnds(DAY) - 1)).toEqual([]);
    const parked = plansOf({ dailies: [daily(DAY)], runs: [run("playing", "base", false)] }, recoveryEnds(DAY));
    expect(of(parked, "consume_arena_run")[0]).toMatchObject({ includeArenaPlayer: false });
  });

  it("keeper_works_only_inside_its_recent_window", () => {
    const players = [85, 84, 1].map((age) => ({ dayId: DAY - age,
      owner: Keypair.generate().publicKey, rentPayer: Keypair.generate().publicKey }));
    const plans = plansOf({ launchDayId: DAY - 200, dailies: [daily(DAY), { ...daily(DAY - 90), finalizedAt: 1 }],
      closedArenaPlayers: players }, opens(DAY) + 1);
    expect(of(plans, "close_arena_player").map(({ dayId }) => dayId)).toEqual([DAY - 84, DAY - 1]);
    expect(of(plans, "close_arena_daily")).toEqual([]);
  });

  it("keeps cadence, recovery and cleanup ordering stable", () => {
    const order = ["prepare_arena_daily", "finish_run", "commit_run", "consume_arena_run", "finalize_arena_daily",
      "close_arena_daily", "close_arena_player"] as const;
    expect(Object.keys(KEEPER_PLAN_INSTRUCTION)).toEqual([...order]);
    expect(order.map((operation) => KEEPER_PLAN_INSTRUCTION[operation].priority)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // A run is consumed before its day finalizes, so a finished run still scores.
    expect(KEEPER_PLAN_INSTRUCTION.consume_arena_run.priority).toBeLessThan(KEEPER_PLAN_INSTRUCTION.finalize_arena_daily.priority);
  });
});

function snapshot(overrides: Partial<ProtocolSnapshot> = {}): ProtocolSnapshot {
  return {
    paused: false,
    launchDayId: DAY - 30,
    suspendedUntilDay: 0,
    lastPreparedDay: Math.max(0, ...(overrides.dailies ?? []).map(({ dayId }) => dayId)),
    dailies: [],
    runs: [],
    ...overrides,
  };
}

/** A running Daily nobody has entered, with its predecessor already finalized into it. */
function daily(dayId: number): DailySnapshot {
  return {
    dayId,
    finalizedAt: 0,
    runsCloseAt: closes(dayId),
    recoveryDeadlineAt: recoveryEnds(dayId),
    entriesPaid: 0n,
    entriesScored: 0n,
    entriesExpired: 0n,
    predecessorDayId: dayId - 1,
    predecessorRolloverApplied: true,
    payoutLamports: 0n,
  };
}

export type { PublicKey };
