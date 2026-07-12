import { describe, expect, it } from "vitest";

import { computeDailyReward, getDailyRewardTiers } from "./rewardTiers";

describe("Daily reward tiers", () => {
  const weights = [4_000, 2_000, 1_200, 800, 600, 400, 300, 300, 200, 200];

  it("uses the on-chain rank weights without static Stars projections", () => {
    expect(getDailyRewardTiers(weights)).toHaveLength(10);
    expect(computeDailyReward(1, 10_000_000n, weights)).toBe(4_000_000n);
    expect(computeDailyReward(10, 10_000_000n, weights)).toBe(200_000n);
    expect(computeDailyReward(11, 10_000_000n, weights)).toBe(0n);
  });
});
