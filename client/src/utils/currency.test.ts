// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatSolLamports } from "./currency";

describe("currency helpers", () => {
  it("formats nine-decimal SOL without floating point", () => {
    expect(formatSolLamports(2_500_000_000n)).toBe("2.5");
    expect(formatSolLamports(1_000_000_001n)).toBe("1.000000001");
    expect(formatSolLamports(-250_000_000n)).toBe("-0.25");
  });
});
