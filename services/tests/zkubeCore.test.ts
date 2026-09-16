// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  dailyWindow, dayIdAt, scheduledDailyWindow, nextScheduledDaily, dailyIsScheduled,
  compareBoardEntries, dailyPair,
  dailyBoardPools,
  payoutPlan,
} from "../src/zkubeCore";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../fixtures/game-parity.json", import.meta.url),
    "utf8",
  ),
) as {
  phase1Core: {
    dailyPairDraw: { startsDay: number; pairIndicesByDay: number[] };
    dailyBoardSplit: {
      poolLamports: number;
      themeQualifiedWinners: number;
      scoreLamports: number;
      themeLamports: number;
    };
    rankPayout: {
      poolLamports: number;
      qualifiedWinners: number;
      entryPriceLamports: number;
      winnerCount: number;
      payoutsLamports: number[];
      paidLamports: number;
      rolloverLamports: number;
    };
  };
};

describe("generated Node zkube-core boundary", () => {
  it("wasm_protocol_matches_native_golden_vectors", () => {
    const { dailyPairDraw, dailyBoardSplit, rankPayout } = fixture.phase1Core;
    expect(dailyPair(dailyPairDraw.startsDay).pairIndex).toBe(
      dailyPairDraw.pairIndicesByDay[0],
    );

    const pools = dailyBoardPools(
      BigInt(dailyBoardSplit.poolLamports),
      dailyBoardSplit.themeQualifiedWinners,
    );
    expect(pools.score).toBe(BigInt(dailyBoardSplit.scoreLamports));
    expect(pools.theme).toBe(BigInt(dailyBoardSplit.themeLamports));

    const plan = payoutPlan(
      BigInt(rankPayout.poolLamports),
      rankPayout.qualifiedWinners,
      BigInt(rankPayout.entryPriceLamports),
      1_000_000n,
    );
    expect(plan.winnerCount).toBe(rankPayout.winnerCount);
    expect(plan.payouts).toEqual(rankPayout.payoutsLamports.slice(0, plan.winnerCount).map(BigInt));
    expect(plan.paidLamports).toBe(BigInt(rankPayout.paidLamports));
    expect(plan.rolloverLamports).toBe(BigInt(rankPayout.rolloverLamports));
  });

  it("keeper_rule_boundaries_use_the_core_at_day_and_ordering_limits", () => {
    for (const day of [0, 1, 20_000, 0xffff_ffff]) {
      const window = dailyWindow(day);
      expect(dayIdAt(BigInt(window.opensAt))).toBe(day);
      expect(window.runsCloseAt - window.opensAt).toBe(86_340);
      expect(window.recoveryDeadlineAt - window.runsCloseAt).toBe(21_600);
      expect(dailyPair(day).pairIndex).toBeLessThan(160);
    }
    expect(() => dayIdAt(-1n)).toThrow();
    expect(() => dayIdAt(0x1_0000_0000n * 86_400n)).toThrow();
    expect(scheduledDailyWindow(10, 20)).toEqual({ first: 20, following: 21 });
    expect(nextScheduledDaily(10, 20)).toBe(20);
    expect(nextScheduledDaily(20, 20)).toBe(21);
    expect(dailyIsScheduled(19, 20)).toBe(false);
    expect(dailyIsScheduled(20, 20)).toBe(true);
    expect(() => scheduledDailyWindow(0xffff_ffff, 0)).toThrow();
    const a = new Uint8Array(32), b = new Uint8Array(32).fill(255);
    expect(compareBoardEntries(0xffff_ffff_ffff_ffffn, 9, b, 0n, 0, a)).toBe(-1);
    expect(compareBoardEntries(10n, -1, b, 10n, 1, a)).toBe(-1);
    expect(compareBoardEntries(10n, 1, a, 10n, 1, b)).toBe(-1);
    expect(compareBoardEntries(10n, 1, a, 10n, 1, a)).toBe(0);
    expect(() => compareBoardEntries(1n, 0, new Uint8Array(31), 1n, 0, b)).toThrow();
  });

  it("payout_curve_has_one_implementation", () => {
    expect(existsSync(new URL("../src/arcadeEconomy.ts", import.meta.url))).toBe(false);
    expect(readFileSync(
      new URL("../src/arcadeReconciliation.ts", import.meta.url),
      "utf8",
    )).toContain('from "./zkubeCore.js"');

  });
});
