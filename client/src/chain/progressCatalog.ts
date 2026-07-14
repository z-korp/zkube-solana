export interface AchievementPublicationRule {
  metric: number;
  threshold: bigint;
  xpReward: number;
}

export interface QuestPublicationRule {
  metric: number;
  cadence: 0 | 1;
  rotationModulus: 1 | 3;
  rotationRemainder: 0 | 1 | 2;
  enabled: true;
  threshold: number;
  rewardUnits: number;
}

const achievement = (
  metric: number,
  threshold: number,
  xpReward: number,
): AchievementPublicationRule => ({
  metric,
  threshold: BigInt(threshold),
  xpReward,
});

/** Exact Cairo order and thresholds with the approved six-times XP values. */
export const CANONICAL_ACHIEVEMENT_RULES: readonly AchievementPublicationRule[] = [
  achievement(0, 20, 300),
  achievement(0, 100, 900),
  achievement(0, 400, 1_800),
  achievement(0, 1_000, 3_000),
  achievement(1, 200, 300),
  achievement(1, 1_000, 900),
  achievement(1, 4_000, 1_800),
  achievement(1, 10_000, 3_000),
  achievement(2, 3, 300),
  achievement(2, 4, 900),
  achievement(2, 5, 1_800),
  achievement(2, 6, 3_000),
  achievement(3, 1, 300),
  achievement(3, 5, 900),
  achievement(3, 15, 1_800),
  achievement(3, 50, 3_000),
  achievement(4, 1, 600),
  achievement(4, 3, 1_200),
  achievement(5, 30, 2_400),
  achievement(4, 10, 6_000),
  achievement(6, 1, 300),
  achievement(6, 7, 900),
  achievement(6, 30, 1_800),
  achievement(6, 100, 3_000),
];

const quest = (
  metric: number,
  cadence: 0 | 1,
  threshold: number,
  rewardUnits: number,
  rotationModulus: 1 | 3,
  rotationRemainder: 0 | 1 | 2,
): QuestPublicationRule => ({
  metric,
  cadence,
  rotationModulus,
  rotationRemainder,
  enabled: true,
  threshold,
  rewardUnits,
});

/**
 * Exact Cairo quest order: nine Daily quests rotate three-at-a-time over a
 * three-day cycle, followed by the Daily finisher and two Weekly quests.
 */
export const CANONICAL_QUEST_RULES: readonly QuestPublicationRule[] = [
  quest(0, 0, 20, 1, 3, 0),
  quest(1, 0, 3, 1, 3, 0),
  quest(2, 0, 1, 1, 3, 0),
  quest(3, 0, 2, 1, 3, 1),
  quest(4, 0, 1, 1, 3, 1),
  quest(5, 0, 1, 1, 3, 1),
  quest(6, 0, 1, 1, 3, 2),
  quest(7, 0, 2, 1, 3, 2),
  quest(8, 0, 5, 1, 3, 2),
  quest(9, 0, 3, 2, 1, 0),
  quest(10, 1, 150, 5, 1, 0),
  quest(11, 1, 3, 5, 1, 0),
];

export function questRewardsForDay(day: number): { dailyXp: number; weeklyStars: number } {
  if (!Number.isSafeInteger(day) || day < 0) throw new Error("day must be a non-negative integer");
  const dailyXp = CANONICAL_QUEST_RULES
    .filter((rule) => rule.cadence === 0
      && day % rule.rotationModulus === rule.rotationRemainder)
    .reduce((sum, rule) => sum + rule.rewardUnits * 100, 0);
  const weeklyStars = CANONICAL_QUEST_RULES
    .filter((rule) => rule.cadence === 1)
    .reduce((sum, rule) => sum + rule.rewardUnits, 0);
  return { dailyXp, weeklyStars };
}
