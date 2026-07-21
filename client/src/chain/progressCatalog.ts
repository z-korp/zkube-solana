export interface AchievementPublicationRule {
  metric: number;
  threshold: bigint;
  xpReward: number;
}

export interface QuestPublicationRule {
  metric: number;
  cadence: 0 | 1;
  questClass: "core" | "combo" | "activity" | "meta" | "weekly";
  enabled: true;
  threshold: number;
  xpReward: number;
  cubeReward: number;
}

const DAILY_QUEST_POOL_SIZE = 9;
const DAILY_QUEST_SELECTION_SIZE = 3;
const DAILY_QUEST_MIX_SEED = 0x9e3779b9;
const BLOCK_QUEST_VARIANT_SEED = 0xb10c5eed;
const BLOCK_QUEST_COUNTERS = [7, 12, 13, 14] as const;
const BLOCK_QUEST_VARIANTS = [
  [1, 6],
  [2, 8],
  [3, 6],
  [4, 5],
  [1, 8],
  [2, 10],
  [3, 8],
  [4, 6],
] as const;

export interface BlockQuestVariant {
  blockSize: 1 | 2 | 3 | 4;
  target: number;
  metric: number;
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

/** Exact achievement order and thresholds with the balanced long-tail XP curve. */
export const CANONICAL_ACHIEVEMENT_RULES: readonly AchievementPublicationRule[] =
  [
    achievement(0, 20, 100),
    achievement(0, 100, 400),
    achievement(0, 400, 1_500),
    achievement(0, 1_000, 4_000),
    achievement(1, 200, 100),
    achievement(1, 1_000, 400),
    achievement(1, 4_000, 1_500),
    achievement(1, 10_000, 4_000),
    achievement(2, 3, 100),
    achievement(2, 4, 400),
    achievement(2, 5, 1_500),
    achievement(2, 6, 4_000),
    achievement(3, 1, 100),
    achievement(3, 5, 400),
    achievement(3, 15, 1_500),
    achievement(3, 50, 4_000),
    achievement(4, 1, 200),
    achievement(4, 3, 800),
    achievement(5, 30, 2_400),
    achievement(4, 10, 6_800),
    achievement(6, 1, 100),
    achievement(6, 7, 400),
    achievement(6, 30, 1_500),
    achievement(6, 100, 4_000),
  ];

const quest = (
  metric: number,
  cadence: 0 | 1,
  threshold: number,
  xpReward: number,
  cubeReward: number,
  questClass: QuestPublicationRule["questClass"],
): QuestPublicationRule => ({
  metric,
  cadence,
  questClass,
  enabled: true,
  threshold,
  xpReward,
  cubeReward,
});

/**
 * Nine Daily quests are deterministically mixed three-at-a-time, followed by
 * the Daily finisher and two Weekly quests.
 */
export const CANONICAL_QUEST_RULES: readonly QuestPublicationRule[] = [
  quest(0, 0, 20, 100, 0, "core"),
  quest(1, 0, 3, 100, 0, "core"),
  quest(2, 0, 1, 100, 0, "combo"),
  quest(3, 0, 2, 100, 0, "combo"),
  quest(4, 0, 1, 100, 0, "activity"),
  quest(5, 0, 2, 100, 0, "activity"),
  quest(6, 0, 1, 100, 0, "combo"),
  quest(7, 0, 10, 100, 0, "core"),
  quest(8, 0, 5, 100, 0, "combo"),
  quest(9, 0, 3, 200, 2, "meta"),
  quest(10, 1, 150, 500, 0, "weekly"),
  quest(11, 1, 3, 500, 0, "weekly"),
];

function validateDay(day: number): void {
  if (!Number.isSafeInteger(day) || day < 0 || day > 0xffff_ffff) {
    throw new Error("day must be a u32");
  }
}

function seededXorshift(seed: number): number {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

export function blockQuestVariant(day: number): BlockQuestVariant {
  validateDay(day);
  const mixed = seededXorshift((day ^ BLOCK_QUEST_VARIANT_SEED) >>> 0);
  const [blockSize, target] =
    BLOCK_QUEST_VARIANTS[mixed % BLOCK_QUEST_VARIANTS.length]!;
  return {
    blockSize,
    target,
    metric: BLOCK_QUEST_COUNTERS[blockSize - 1],
  };
}

export function questRuleForDay(
  index: number,
  day: number,
): QuestPublicationRule {
  const rule = CANONICAL_QUEST_RULES[index];
  if (!rule) throw new Error("invalid quest index");
  if (index !== 7) return rule;
  const variant = blockQuestVariant(day);
  return { ...rule, metric: variant.metric, threshold: variant.target };
}

export function dailyQuestIndices(day: number): readonly number[] {
  validateDay(day);
  // Mirror the program's compact u32 xorshift/Fisher-Yates schedule exactly.
  const shuffled = Array.from(
    { length: DAILY_QUEST_POOL_SIZE },
    (_, index) => index,
  );
  let state = (day ^ DAILY_QUEST_MIX_SEED) >>> 0;
  for (let upper = DAILY_QUEST_POOL_SIZE - 1; upper > 0; upper -= 1) {
    state = seededXorshift(state);
    const selectedIndex = state % (upper + 1);
    [shuffled[upper], shuffled[selectedIndex]] = [
      shuffled[selectedIndex] ?? 0,
      shuffled[upper] ?? 0,
    ];
  }
  const selected: number[] = [];
  let comboCount = 0;
  for (const index of shuffled) {
    const isCombo = CANONICAL_QUEST_RULES[index]?.questClass === "combo";
    if (isCombo && comboCount === 2) continue;
    selected.push(index);
    if (isCombo) comboCount += 1;
    if (selected.length === DAILY_QUEST_SELECTION_SIZE) break;
  }
  return selected;
}

export function questRewardsForDay(day: number): {
  dailyXp: number;
  dailyCubes: number;
  weeklyXp: number;
  weeklyCubes: number;
} {
  const dailyRules = [...dailyQuestIndices(day), 9].map(
    (index) => CANONICAL_QUEST_RULES[index],
  );
  const weeklyRules = CANONICAL_QUEST_RULES.filter(
    (rule) => rule.cadence === 1,
  );
  return {
    dailyXp: dailyRules.reduce((sum, rule) => sum + rule.xpReward, 0),
    dailyCubes: dailyRules.reduce((sum, rule) => sum + rule.cubeReward, 0),
    weeklyXp: weeklyRules.reduce((sum, rule) => sum + rule.xpReward, 0),
    weeklyCubes: weeklyRules.reduce((sum, rule) => sum + rule.cubeReward, 0),
  };
}
