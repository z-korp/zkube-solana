// @vitest-environment node
import { ACHIEVEMENT_DEFS } from "../config/achievementDefs";
import { QUEST_DEFS } from "../config/questDefs";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_ACHIEVEMENT_RULES,
  CANONICAL_QUEST_RULES,
  blockQuestVariant,
  dailyQuestIndices,
  questRuleForDay,
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
    expect(CANONICAL_ACHIEVEMENT_RULES.map((rule) => rule.threshold)).toEqual(
      expectedThresholds,
    );
    expect(
      CANONICAL_ACHIEVEMENT_RULES.reduce((sum, rule) => sum + rule.xpReward, 0),
    ).toBe(40_200);
    expect(CANONICAL_ACHIEVEMENT_RULES.map((rule) => rule.xpReward)).toEqual(
      ACHIEVEMENT_DEFS.map((definition) => definition.xp),
    );
  });

  it("mixes nine Daily quests and preserves finisher and Weekly rewards", () => {
    expect(CANONICAL_QUEST_RULES).toHaveLength(12);
    expect(CANONICAL_QUEST_RULES.map((rule) => rule.threshold)).toEqual(
      QUEST_DEFS.map((definition) => definition.target),
    );
    expect(CANONICAL_QUEST_RULES.map((rule) => rule.xpReward)).toEqual(
      QUEST_DEFS.map((definition) => definition.xpReward),
    );
    expect(CANONICAL_QUEST_RULES.map((rule) => rule.cubeReward)).toEqual(
      QUEST_DEFS.map((definition) => definition.cubeReward),
    );
    expect(
      [0, 1, 2, 3, 10, 100, 20_000].map((day) => dailyQuestIndices(day)),
    ).toEqual([
      [0, 8, 4],
      [6, 2, 1],
      [2, 6, 5],
      [3, 1, 7],
      [6, 3, 0],
      [5, 7, 3],
      [1, 5, 0],
    ]);
    for (const day of Array.from({ length: 1_000 }, (_, index) => index)) {
      const selected = dailyQuestIndices(day);
      expect(new Set(selected).size).toBe(3);
      expect(
        selected.filter(
          (index) => CANONICAL_QUEST_RULES[index]?.questClass === "combo",
        ).length,
      ).toBeLessThanOrEqual(2);
      expect(questRewardsForDay(day)).toEqual({
        dailyXp: 500,
        dailyCubes: 2,
        weeklyXp: 1_000,
        weeklyCubes: 0,
      });
    }
  });

  it("rotates calibrated block sizes and targets with program parity", () => {
    expect(
      [0, 1, 2, 3, 10, 100, 20_000].map((day) => blockQuestVariant(day)),
    ).toEqual([
      { blockSize: 2, target: 10, metric: 12 },
      { blockSize: 1, target: 8, metric: 7 },
      { blockSize: 4, target: 6, metric: 14 },
      { blockSize: 3, target: 8, metric: 13 },
      { blockSize: 4, target: 6, metric: 14 },
      { blockSize: 4, target: 6, metric: 14 },
      { blockSize: 4, target: 6, metric: 14 },
    ]);

    const variants = Array.from({ length: 1_000 }, (_, day) =>
      blockQuestVariant(day),
    );
    expect(new Set(variants.map((variant) => variant.blockSize))).toEqual(
      new Set([1, 2, 3, 4]),
    );
    for (let day = 0; day < variants.length; day += 1) {
      const variant = variants[day]!;
      expect(questRuleForDay(7, day)).toMatchObject({
        metric: variant.metric,
        threshold: variant.target,
        xpReward: 100,
      });
    }
  });
});
