export interface AchievementPublicationRule {
  metric: number;
  threshold: bigint;
  starReward: bigint;
  xpReward: number;
}

export interface QuestPublicationRule {
  metric: number;
  cadence: 0 | 1;
  rotationModulus: 1 | 3;
  rotationRemainder: 0 | 1 | 2;
  enabled: true;
  threshold: number;
  starReward: number;
}

const achievement = (
  metric: number,
  threshold: number,
  xpReward: number,
): AchievementPublicationRule => ({
  metric,
  threshold: BigInt(threshold),
  starReward: 0n,
  xpReward,
});

/** Exact order, thresholds, and XP values from zkube's Cairo achievement catalog. */
export const CANONICAL_ACHIEVEMENT_RULES: readonly AchievementPublicationRule[] = [
  achievement(0, 20, 50),
  achievement(0, 100, 150),
  achievement(0, 400, 300),
  achievement(0, 1_000, 500),
  achievement(1, 200, 50),
  achievement(1, 1_000, 150),
  achievement(1, 4_000, 300),
  achievement(1, 10_000, 500),
  achievement(2, 3, 50),
  achievement(2, 4, 150),
  achievement(2, 5, 300),
  achievement(2, 6, 500),
  achievement(3, 1, 50),
  achievement(3, 5, 150),
  achievement(3, 15, 300),
  achievement(3, 50, 500),
  achievement(4, 1, 100),
  achievement(4, 3, 200),
  achievement(5, 30, 400),
  achievement(4, 10, 1_000),
  achievement(6, 1, 50),
  achievement(6, 7, 150),
  achievement(6, 30, 300),
  achievement(6, 100, 500),
];

const quest = (
  metric: number,
  cadence: 0 | 1,
  threshold: number,
  starReward: number,
  rotationModulus: 1 | 3,
  rotationRemainder: 0 | 1 | 2,
): QuestPublicationRule => ({
  metric,
  cadence,
  rotationModulus,
  rotationRemainder,
  enabled: true,
  threshold,
  starReward,
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

export function questBudgetForDay(day: number): { daily: number; weekly: number } {
  if (!Number.isSafeInteger(day) || day < 0) throw new Error("day must be a non-negative integer");
  const daily = CANONICAL_QUEST_RULES
    .filter((rule) => rule.cadence === 0
      && day % rule.rotationModulus === rule.rotationRemainder)
    .reduce((sum, rule) => sum + rule.starReward, 0);
  const weekly = CANONICAL_QUEST_RULES
    .filter((rule) => rule.cadence === 1)
    .reduce((sum, rule) => sum + rule.starReward, 0);
  return { daily, weekly };
}
