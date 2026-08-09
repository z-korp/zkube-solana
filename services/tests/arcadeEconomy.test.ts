import { describe, expect, it } from "vitest";

import {
  boardWidth,
  dailyBoardPools,
  exactEntrySplit,
  payoutForRank,
  rankWeightedPayoutPlan,
} from "../src/arcadeEconomy";

describe("native SOL Arcade accounting", () => {
  it("conserves every exact 0.01 SOL entry", () => {
    expect(exactEntrySplit(10_000_000n)).toEqual({
      followingDaily: 9_000_000n,
      operator: 1_000_000n,
    });
    expect(() => exactEntrySplit(9_000_000n)).toThrow("exactly 0.01 SOL");
  });

  it("matches the core rank curve and rolls 0.001 SOL dust", () => {
    expect(rankWeightedPayoutPlan(101_500_000n, 2)).toEqual({
      payouts: [67_000_000n, 33_000_000n],
      winnerCount: 2,
      widthWinnerCount: 2,
      denominator: 27_670_116_110_564_327_422n,
      capacityLimited: false,
      paidLamports: 100_000_000n,
      rolloverLamports: 1_500_000n,
    });
  });

  it("trims a fully starved board without changing its rollover", () => {
    expect(rankWeightedPayoutPlan(999_999n, 1)).toEqual({
      payouts: [],
      winnerCount: 0,
      widthWinnerCount: 0,
      denominator: 18_446_744_073_709_551_615n,
      capacityLimited: false,
      paidLamports: 0n,
      rolloverLamports: 999_999n,
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

  it("sizes the 1,176-place harmonic fixture without a byte-sized rank cap", () => {
    const width = boardWidth(90_000_000_000n, 20_000);
    expect(width.winnerCount).toBe(1_176);
    expect(payoutForRank(90_000_000_000n, width.denominator, 1_176))
      .toBeGreaterThanOrEqual(10_000_000n);
    const bounded = rankWeightedPayoutPlan(90_000_000_000n, 20_000, 33);
    expect(bounded).toMatchObject({
      winnerCount: 33,
      widthWinnerCount: 1_176,
      capacityLimited: true,
      denominator: width.denominator,
    });
    expect(bounded.payouts).toHaveLength(33);
    expect(bounded.paidLamports + bounded.rolloverLamports)
      .toBe(90_000_000_000n);
  });
});
