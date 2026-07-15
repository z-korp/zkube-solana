import { describe, expect, it } from "vitest";

import {
  applyStarThresholdModifier,
  calculateCampaignXpAwarded,
} from "./level";

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

describe("calculateCampaignXpAwarded", () => {
  it.each([
    [0, 1, 10],
    [0, 2, 20],
    [0, 3, 30],
    [1, 2, 10],
    [1, 3, 20],
    [2, 3, 10],
    [3, 3, 0],
    [3, 1, 0],
  ])(
    "awards the lifetime improvement from %i to %i stars",
    (previous, achieved, expectedXp) => {
      expect(calculateCampaignXpAwarded(previous, achieved)).toBe(expectedXp);
    },
  );

  it("bounds untrusted star inputs to the on-chain zero-to-three range", () => {
    expect(calculateCampaignXpAwarded(-5, 99)).toBe(30);
    expect(calculateCampaignXpAwarded(99, -5)).toBe(0);
  });
});
