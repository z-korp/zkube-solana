import { describe, expect, it } from "vitest";

import {
  CANONICAL_DAILY_PRESSURE,
  CANONICAL_DAILY_SCORING_RULES,
  DAILY_SCORING_RULE_COUNT,
  dailyScoringRuleDescription,
  dailyScoringRuleName,
  mapDailyPressureProfile,
} from "./dailyRules";

describe("Daily rules", () => {
  it("publishes all seven families through fourteen active variants", () => {
    const active = CANONICAL_DAILY_SCORING_RULES.slice(
      0,
      DAILY_SCORING_RULE_COUNT,
    );
    expect(new Set(active.map((rule) => rule.family))).toEqual(
      new Set([0, 1, 2, 3, 4, 5, 6]),
    );
    expect(new Set(active.map((rule) => rule.id)).size).toBe(14);
    expect(CANONICAL_DAILY_SCORING_RULES).toHaveLength(16);
  });

  it("keeps the pressure schedule and emergency move cap visible to the client", () => {
    const decoded = mapDailyPressureProfile(CANONICAL_DAILY_PRESSURE);
    expect(decoded.thresholds).toEqual([15, 40, 80, 150, 280, 500, 900]);
    expect(decoded.scoreMultipliersX100).toEqual([
      100, 110, 125, 140, 160, 180, 210, 250,
    ]);
    expect(decoded.startingHeight).toBe(4);
    expect(decoded.maxMoves).toBe(180);
    expect(
      decoded.blockWeights.every(
        (tier) => tier.reduce((sum, weight) => sum + weight, 0) === 100,
      ),
    ).toBe(true);
  });

  it("explains the featured metric before a player spends Stars", () => {
    const comboThree = CANONICAL_DAILY_SCORING_RULES[2];
    expect(dailyScoringRuleName(comboThree)).toBe("3+ Line Combos");
    expect(dailyScoringRuleDescription(comboThree)).toContain(
      "Only clears of 3 or more lines score",
    );
  });
});
