import { describe, expect, it } from "vitest";

import { formatSolLamports, splitStarPurchase } from "./currency";

describe("currency helpers", () => {
  it("formats nine-decimal SOL without floating point", () => {
    expect(formatSolLamports(2_500_000_000n)).toBe("2.5");
    expect(formatSolLamports(1_000_000_001n)).toBe("1.000000001");
    expect(formatSolLamports(-250_000_000n)).toBe("-0.25");
  });

  it("conserves the 10/10/80 split and assigns dust to treasury", () => {
    expect(splitStarPurchase(1_000_000n)).toEqual({
      team: 100_000n,
      rewards: 100_000n,
      treasury: 800_000n,
    });
    expect(splitStarPurchase(11n)).toEqual({
      team: 1n,
      rewards: 1n,
      treasury: 9n,
    });
  });
});
