// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  equalBudgetPlan,
  exactEntrySplit,
  payoutPlan,
} from "../src/arcadeEconomy";

describe("native SOL Arcade accounting", () => {
  it("conserves every exact 0.02 SOL entry", () => {
    expect(exactEntrySplit(20_000_000n)).toEqual({
      followingDaily: 12_000_000n,
      followingWeekly: 4_000_000n,
      followingSeason: 2_000_000n,
      operator: 2_000_000n,
    });
    expect(() => exactEntrySplit(19_999_999n)).toThrow("exactly 0.02 SOL");
  });

  it("renormalizes occupied Daily weights and rolls 0.001 SOL dust", () => {
    const plan = payoutPlan(101_990_001n, [45, 25, 15, 10, 5], 2);
    expect(plan.payouts).toEqual([65_000_000n, 36_000_000n, 0n, 0n, 0n]);
    expect(plan.paidLamports).toBe(101_000_000n);
    expect(plan.rolloverLamports).toBe(990_001n);
  });

  it("splits Weekly into equal rounded budgets before bounty payouts", () => {
    const split = equalBudgetPlan(20_500_001n, 3);
    expect(split.budgets).toEqual([6_000_000n, 6_000_000n, 6_000_000n]);
    expect(split.rolloverLamports).toBe(2_500_001n);
    const bounty = payoutPlan(split.budgets[0]!, [60, 25, 15], 3);
    expect(bounty.payouts).toEqual([3_000_000n, 1_000_000n, 0n]);
    expect(bounty.rolloverLamports).toBe(2_000_000n);
  });

  it("rolls an undersized pool in full", () => {
    expect(payoutPlan(999_999n, [100], 1)).toEqual({
      payouts: [0n],
      paidLamports: 0n,
      rolloverLamports: 999_999n,
    });
  });
});
