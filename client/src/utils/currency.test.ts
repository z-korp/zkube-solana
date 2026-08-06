// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatSolBalance, formatSolBalanceLamports } from "./currency";

describe("currency helpers", () => {
  it("truncates to the 0.001 SOL transfer floor, never rounding up", () => {
    expect(formatSolBalance(1_999_999)).toBe("0.001");
    expect(formatSolBalance(9_999_999)).toBe("0.009");
    expect(formatSolBalance(10_000_000)).toBe("0.010");
    expect(formatSolBalance(2_500_000_000)).toBe("2.500");
    expect(formatSolBalance(999_999)).toBe("0.000");
  });

  it("clamps negative balances to zero", () => {
    expect(formatSolBalance(-5_000_000)).toBe("0.000");
    expect(formatSolBalanceLamports(-250_000_000n)).toBe("0.000");
  });

  it("formats bigint lamports identically to the numeric twin", () => {
    expect(formatSolBalanceLamports(1_000_000n)).toBe("0.001");
    expect(formatSolBalanceLamports(10_000_000n)).toBe("0.010");
    expect(formatSolBalanceLamports(1_234_567_890n)).toBe("1.234");
    expect(formatSolBalanceLamports(1_000_000_000n)).toBe("1.000");
  });
});
