import { ACHIEVEMENT_DEFS } from "../config/achievementDefs";
import { QUEST_DEFS } from "../config/questDefs";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_ACHIEVEMENT_RULES,
  CANONICAL_QUEST_RULES,
  questRewardsForDay,
} from "./progressCatalog";

describe("canonical zkube progression catalog", () => {
  it("preserves all 24 Cairo achievement thresholds with 40,200 XP", () => {
    const expectedThresholds = ACHIEVEMENT_DEFS.map((definition, index) => {
      // Cairo has four separate COMBO_N event counters. The Solana profile
      // stores the lifetime maximum combo, which is equivalent for one-shot trophies.
      if (index >= 8 && index <= 11) return BigInt(index - 5);
      return BigInt(definition.target);
    });

    expect(CANONICAL_ACHIEVEMENT_RULES).toHaveLength(24);
    expect(CANONICAL_ACHIEVEMENT_RULES.map((rule) => rule.threshold)).toEqual(expectedThresholds);
    expect(CANONICAL_ACHIEVEMENT_RULES.reduce((sum, rule) => sum + rule.xpReward, 0))
      .toBe(40_200);
    expect(CANONICAL_ACHIEVEMENT_RULES.map((rule) => rule.xpReward))
      .toEqual(ACHIEVEMENT_DEFS.map((definition) => definition.xp * 6));
  });

  it("preserves the nine rotating Daily, finisher, and two Weekly quests", () => {
    expect(CANONICAL_QUEST_RULES).toHaveLength(12);
    expect(CANONICAL_QUEST_RULES.map((rule) => rule.threshold))
      .toEqual(QUEST_DEFS.map((definition) => definition.target));
    expect(CANONICAL_QUEST_RULES.map((rule) => rule.rewardUnits))
      .toEqual(QUEST_DEFS.map((definition) => definition.reward));
    expect(CANONICAL_QUEST_RULES.slice(0, 9).map((rule) => rule.rotationRemainder))
      .toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
    expect(CANONICAL_QUEST_RULES.slice(0, 9).every((rule) => rule.rotationModulus === 3))
      .toBe(true);
    for (const day of Array.from({ length: 21 }, (_, index) => index)) {
      expect(questRewardsForDay(day)).toEqual({ dailyXp: 500, weeklyStars: 10 });
    }
  });
});
