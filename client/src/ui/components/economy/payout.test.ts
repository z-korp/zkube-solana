// @vitest-environment node
import { describe, expect, it } from "vitest";

import { computeRankPayouts, dailyBoardPools } from "./payout";

describe("rank-weighted board payouts", () => {
  it("matches the deterministic core curve", () => {
    expect(computeRankPayouts(101_500_000n, 2)).toEqual({
      payouts: [67_000_000n, 33_000_000n],
      winnerCount: 2,
      paidLamports: 100_000_000n,
      rolloverLamports: 1_500_000n,
    });
  });

  it("folds an empty Classic Theme board into Score", () => {
    expect(dailyBoardPools(101_500_001n, 0)).toEqual({
      score: 101_500_001n,
      theme: 0n,
    });
    expect(dailyBoardPools(101_500_001n, 1)).toEqual({
      score: 50_750_001n,
      theme: 50_750_000n,
    });
  });

  it("trims zero places and conserves rollover", () => {
    expect(computeRankPayouts(999_999n, 4)).toEqual({
      payouts: [],
      winnerCount: 0,
      paidLamports: 0n,
      rolloverLamports: 999_999n,
    });
  });

  it("sizes the full width without a u8 cap", () => {
    const plan = computeRankPayouts(90_000_000_000n, 20_000);
    expect(plan.winnerCount).toBe(1_176);
    expect(plan.payouts.at(-1)).toBeGreaterThanOrEqual(10_000_000n);
    expect(plan.paidLamports + plan.rolloverLamports).toBe(90_000_000_000n);
  });
});
