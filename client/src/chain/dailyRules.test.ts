// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  CANONICAL_DAILY_PRESSURE,
  CANONICAL_DAILY_SCORING_RULES,
  DAILY_SCORING_RULE_COUNT,
  dailyScoringRuleDescription,
  dailyScoringRuleName,
  dailyScoringRuleStatus,
  mapDailyPressureProfile,
} from "./dailyRules";

describe("Daily rules", () => {
  it("publishes all seven families through fifteen active variants", () => {
    const active = CANONICAL_DAILY_SCORING_RULES.slice(
      0,
      DAILY_SCORING_RULE_COUNT,
    );
    expect(new Set(active.map((rule) => rule.family))).toEqual(
      new Set([0, 1, 2, 3, 4, 5, 6]),
    );
    expect(new Set(active.map((rule) => rule.id)).size).toBe(15);
    expect(CANONICAL_DAILY_SCORING_RULES).toHaveLength(16);
  });

  it("keeps the pressure schedule and emergency move cap visible to the client", () => {
    const decoded = mapDailyPressureProfile(CANONICAL_DAILY_PRESSURE);
    expect(decoded.thresholds).toEqual([8, 18, 30, 42, 54, 66, 78]);
    expect(decoded.scoreMultipliersX100).toEqual([
      100, 110, 125, 140, 160, 180, 210, 250,
    ]);
    expect(decoded.startingHeight).toBe(4);
    expect(decoded.maxMoves).toBe(100);
    expect(decoded.blockWeights).toEqual([
      [25, 30, 25, 15, 5],
      [22, 28, 25, 18, 7],
      [20, 25, 25, 20, 10],
      [18, 22, 24, 22, 14],
      [16, 20, 22, 24, 18],
      [14, 18, 20, 26, 22],
      [12, 16, 18, 28, 26],
      [10, 14, 16, 30, 30],
    ]);
    expect(
      decoded.blockWeights.every(
        (tier) => tier.reduce((sum, weight) => sum + weight, 0) === 100,
      ),
    ).toBe(true);
  });

  it("explains combined scoring and live objective state before entry", () => {
    const comboThree = CANONICAL_DAILY_SCORING_RULES[2];
    expect(dailyScoringRuleName(comboThree)).toBe("3+ Line Combos");
    expect(dailyScoringRuleDescription(comboThree)).toContain(
      "Normal score always counts",
    );
    const clutch = CANONICAL_DAILY_SCORING_RULES[10];
    expect(dailyScoringRuleStatus(clutch, 5)).toContain("Build to height 6");
    expect(dailyScoringRuleStatus(clutch, 7)).toContain("ARMED");
  });
});
