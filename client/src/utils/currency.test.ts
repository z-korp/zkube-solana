import { describe, expect, it } from "vitest";

import { formatUsdcBaseUnits, splitStarPurchase } from "./currency";

describe("currency helpers", () => {
  it("formats six-decimal USDC without floating point", () => {
    expect(formatUsdcBaseUnits(2_500_000n)).toBe("2.5");
    expect(formatUsdcBaseUnits(1_000_001n)).toBe("1.000001");
    expect(formatUsdcBaseUnits(-250_000n)).toBe("-0.25");
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
