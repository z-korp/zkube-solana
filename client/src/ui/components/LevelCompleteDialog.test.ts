import { describe, expect, it } from "vitest";

import { calculateLevelStars } from "./LevelCompleteDialog";

describe("calculateLevelStars", () => {
  it("uses the inclusive on-chain move thresholds", () => {
    expect(
      calculateLevelStars({
        movesUsed: 8,
        star3UsedCap: 8,
        star2UsedCap: 12,
        isIncomplete: false,
      }),
    ).toBe(3);
    expect(
      calculateLevelStars({
        movesUsed: 12,
        star3UsedCap: 8,
        star2UsedCap: 12,
        isIncomplete: false,
      }),
    ).toBe(2);
    expect(
      calculateLevelStars({
        movesUsed: 13,
        star3UsedCap: 8,
        star2UsedCap: 12,
        isIncomplete: false,
      }),
    ).toBe(1);
  });

  it("does not award stars to an incomplete run", () => {
    expect(
      calculateLevelStars({
        movesUsed: 1,
        star3UsedCap: 8,
        star2UsedCap: 12,
        isIncomplete: true,
      }),
    ).toBe(0);
  });
});
