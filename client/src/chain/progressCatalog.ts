import { PublicKey } from "@solana/web3.js";

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
}

const DAILY_QUEST_POOL_SIZE = 8;
const DAILY_QUEST_SELECTION_SIZE = 3;
const DAILY_QUEST_MIX_SEED = 0x9e3779b9;
export const DAILY_FINISHER_INDEX = 8;
const WEEKLY_ATTENDANCE_INDEX = 9;
const WEEKLY_OPTIONAL_POOL = [10, 12, 13, 14, 15, 16, 18, 19] as const;
const U64_MAX = (1n << 64n) - 1n;

const achievement = (
  metric: number,
  threshold: number | bigint,
  xpReward: number,
): AchievementPublicationRule => ({
  metric,
  threshold: BigInt(threshold),
  xpReward,
});

const reservedAchievement = (): AchievementPublicationRule =>
  achievement(0xff, U64_MAX, 0);

/** Exact program order, including permanently ungrantable ABI-reserved slots. */
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
    reservedAchievement(),
    reservedAchievement(),
    reservedAchievement(),
    reservedAchievement(),
    reservedAchievement(),
    reservedAchievement(),
    reservedAchievement(),
    reservedAchievement(),
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
  questClass: QuestPublicationRule["questClass"],
): QuestPublicationRule => ({
  metric,
  cadence,
  questClass,
  enabled: true,
  threshold,
  xpReward,
});

/**
 * Exact 20-slot PlayerState quest catalog. Slots 5, 11 and 17 remain present
 * for ABI parity but are never selected because rating, Campaign and boss
 * counters cannot feed Arcade rewards.
 */
export const CANONICAL_QUEST_RULES: readonly QuestPublicationRule[] = [
  quest(0, 0, 1, 100, "activity"),
  quest(1, 0, 40, 100, "core"),
  quest(2, 0, 3, 100, "activity"),
  quest(3, 0, 1, 100, "core"),
  quest(4, 0, 1, 100, "activity"),
  quest(5, 0, 1, 100, "meta"),
  quest(6, 0, 1, 100, "combo"),
  quest(7, 0, 1, 100, "core"),
  quest(8, 0, 3, 350, "meta"),
  quest(9, 1, 5, 500, "weekly"),
  quest(10, 1, 300, 500, "weekly"),
  quest(11, 1, 3, 500, "weekly"),
  quest(12, 1, 25, 500, "weekly"),
  quest(13, 1, 15, 500, "weekly"),
  quest(14, 1, 3, 500, "weekly"),
  quest(15, 1, 1, 500, "weekly"),
  quest(16, 1, 6, 500, "weekly"),
  quest(17, 1, 2, 500, "weekly"),
  quest(18, 1, 2, 500, "weekly"),
  quest(19, 1, 2, 500, "weekly"),
];

function validateCadence(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${label} must be a u32`);
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

function ownerMix(owner: PublicKey, offset: number): number {
  const bytes = owner.toBytes();
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

export function questRule(index: number): QuestPublicationRule {
  const rule = CANONICAL_QUEST_RULES[index];
  if (!rule) throw new Error("invalid quest index");
  return rule;
}

export function dailyQuestIndices(
  day: number,
  owner: PublicKey,
  enteredYesterday: boolean,
): readonly number[] {
  validateCadence(day, "day");
  const shuffled = Array.from(
    { length: DAILY_QUEST_POOL_SIZE },
    (_, index) => index,
  );
  let state = (day ^ ownerMix(owner, 0) ^ DAILY_QUEST_MIX_SEED) >>> 0;
  for (let upper = DAILY_QUEST_POOL_SIZE - 1; upper > 0; upper -= 1) {
    state = seededXorshift(state);
    const selected = state % (upper + 1);
    [shuffled[upper], shuffled[selected]] = [
      shuffled[selected]!,
      shuffled[upper]!,
    ];
  }
  return shuffled
    .filter((index) => index !== 5 && (index !== 7 || enteredYesterday))
    .slice(0, DAILY_QUEST_SELECTION_SIZE);
}

export function weeklyQuestIndices(
  week: number,
  owner: PublicKey,
): readonly number[] {
  validateCadence(week, "week");
  const shuffled = [...WEEKLY_OPTIONAL_POOL];
  let state = seededXorshift(
    (week ^ ownerMix(owner, 4) ^ DAILY_QUEST_MIX_SEED) >>> 0,
  );
  for (let upper = shuffled.length - 1; upper > 0; upper -= 1) {
    state = seededXorshift(state);
    const selected = state % (upper + 1);
    [shuffled[upper], shuffled[selected]] = [
      shuffled[selected]!,
      shuffled[upper]!,
    ];
  }
  return [WEEKLY_ATTENDANCE_INDEX, shuffled[0]!, shuffled[1]!];
}

export function questRewardsForCadence(): {
  dailyXp: number;
  weeklyXp: number;
} {
  return { dailyXp: 650, weeklyXp: 1_500 };
}
