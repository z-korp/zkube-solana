// @vitest-environment node
import { describe, expect, it } from "vitest";

import { applyStarThresholdModifier } from "./level";

describe("applyStarThresholdModifier", () => {
  it.each([
    [128, { star3Pct: 50, star2Pct: 75 }],
    [129, { star3Pct: 45, star2Pct: 70 }],
    [127, { star3Pct: 55, star2Pct: 80 }],
    [255, { star3Pct: 10, star2Pct: 11 }],
    [0, { star3Pct: 90, star2Pct: 99 }],
  ])("matches the deployed rules for modifier %i", (modifier, expected) => {
    expect(applyStarThresholdModifier(modifier)).toEqual(expected);
  });
});
