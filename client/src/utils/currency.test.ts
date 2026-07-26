// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatSol, formatSolLamports } from "./currency";

describe("currency helpers", () => {
  it("formats nine-decimal SOL without floating point", () => {
    expect(formatSolLamports(2_500_000_000n)).toBe("2.5");
    expect(formatSolLamports(1_000_000_001n)).toBe("1.000000001");
    expect(formatSolLamports(-250_000_000n)).toBe("-0.25");
    expect(formatSolLamports(1_000_000n)).toBe("0.001");
    expect(formatSolLamports(1_000_000_000n)).toBe("1");
    expect(formatSolLamports(1_234_567_890_000n)).toBe("1,234.56789");
  });

  it("groups numeric wallet balances while retaining fixed precision", () => {
    expect(formatSol(1_234_567_890_000, 4)).toBe("1,234.5679");
  });
});
