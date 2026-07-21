import type { Connection } from "@solana/web3.js";
import type { WalletLike } from "./sessionWallet";
import { derivePlayerStatePda, deriveProtocolConfigPda } from "./pdas";
import {
  CANONICAL_ACHIEVEMENT_RULES,
  CANONICAL_QUEST_RULES,
  DAILY_FINISHER_INDEX,
  dailyQuestIndices,
  questRule,
  weeklyQuestIndices,
} from "./progressCatalog";
import { zkubeProgram } from "./runPlan";
import { currentWeeklyId } from "./weeklyClient";

export interface AchievementProgressView {
  index: number;
  metric: number;
  progress: bigint;
  threshold: bigint;
  xpReward: number;
  completed: boolean;
  active: boolean;
}

export interface QuestProgressView {
  index: number;
  metric: number;
  blockSize: number | null;
  cadence: "daily" | "weekly";
  progress: number;
  threshold: number;
  xpReward: number;
  active: boolean;
  completed: boolean;
}

interface LifetimeStatsView {
  runsStarted: bigint;
  linesCleared: bigint;
  maxCombo: number;
  bossesCleared: bigint;
  perfectLevels: bigint;
  dailyChallenges: bigint;
  bonusUses: bigint;
}

export interface ProgressView {
  lifetimeXp: bigint;
  lifetime: LifetimeStatsView;
  achievements: AchievementProgressView[];
  quests: QuestProgressView[];
}

export function progressCadenceIds(nowUnix: number): {
  day: number;
  week: number;
} {
  return {
    day: Math.max(0, Math.floor(nowUnix / 86_400)),
    week: currentWeeklyId(nowUnix),
  };
}

export async function fetchProgressView(args: {
  connection: Connection;
  wallet: WalletLike;
  nowUnix?: number;
}): Promise<ProgressView | null> {
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const protocol = await program.account.protocolConfig.fetchNullable(
    deriveProtocolConfigPda(),
  );
  const player = await program.account.playerState.fetchNullable(
    derivePlayerStatePda(owner),
  );
  if (!protocol || !player) return null;
  const now = args.nowUnix ?? Math.floor(Date.now() / 1_000);
  const { day, week } = progressCadenceIds(now);
  const metrics = achievementMetrics(player);
  const achievements = CANONICAL_ACHIEVEMENT_RULES.map((rule, index) => {
    const progress = metrics[rule.metric] ?? 0n;
    const active = rule.metric !== 0xff;
    return {
      index,
      metric: rule.metric,
      progress,
      threshold: rule.threshold,
      xpReward: rule.xpReward,
      completed:
        active && (Number(player.achievementFlags) & (1 << index)) !== 0,
      active,
    };
  });
  const dailyCounterIsCurrent = Number(player.questCadenceDay) === day;
  const weeklyCounterIsCurrent = Number(player.questCadenceWeek) === week;
  const enteredYesterday = Number(player.lastDailyChallengeDay) + 1 === day;
  const selectedDailyQuests = dailyQuestIndices(day, owner, enteredYesterday);
  const selectedWeeklyQuests = weeklyQuestIndices(week, owner);
  const dailyCompletionIsCurrent =
    Number(player.dailyCompletionCadenceId) === day;
  const weeklyCompletionIsCurrent =
    Number(player.weeklyCompletionCadenceId) === week;
  const dailyCompleted = dailyCompletionIsCurrent
    ? Number(player.dailyCompleted)
    : 0;
  const weeklyCompleted = weeklyCompletionIsCurrent
    ? Number(player.weeklyCompleted)
    : 0;
  const quests = CANONICAL_QUEST_RULES.map((_canonicalRule, index) => {
    const rule = questRule(index);
    const blockSize = null;
    const cadence =
      rule.cadence === 0 ? ("daily" as const) : ("weekly" as const);
    const active =
      index === DAILY_FINISHER_INDEX ||
      (cadence === "daily"
        ? selectedDailyQuests.includes(index)
        : selectedWeeklyQuests.includes(index));
    const counterIsCurrent =
      cadence === "daily" ? dailyCounterIsCurrent : weeklyCounterIsCurrent;
    const rawProgress = counterIsCurrent
      ? Number(player.questCounters[rule.metric] ?? 0)
      : 0;
    const completedBits = cadence === "daily" ? dailyCompleted : weeklyCompleted;
    const completed = active && (completedBits & (1 << index)) !== 0;
    const progress =
      index === DAILY_FINISHER_INDEX
        ? selectedDailyQuests.filter(
            (questIndex) => (dailyCompleted & (1 << questIndex)) !== 0,
          ).length
        : index === 15
          ? Number((rawProgress & 0x8000_0000) !== 0 || (rawProgress & 0x7fff_ffff) >= 5)
          : rawProgress;
    return {
      index,
      metric: rule.metric,
      blockSize,
      cadence,
      progress,
      threshold: rule.threshold,
      xpReward: rule.xpReward,
      active,
      completed,
    };
  });
  const lifetimeValue = (key: string) =>
    BigInt(String((player as Record<string, unknown>)[key] ?? 0));
  return {
    lifetimeXp: BigInt(player.lifetimeXp.toString()),
    lifetime: {
      runsStarted: lifetimeValue("lifetimeRunsStarted"),
      linesCleared: lifetimeValue("lifetimeLinesCleared"),
      maxCombo: Number(lifetimeValue("lifetimeMaxCombo")),
      bossesCleared: lifetimeValue("lifetimeBossesCleared"),
      perfectLevels: lifetimeValue("lifetimePerfectLevels"),
      dailyChallenges: lifetimeValue("lifetimeDailyChallenges"),
      bonusUses: lifetimeValue("lifetimeBonusUses"),
    },
    achievements,
    quests,
  };
}

function achievementMetrics(player: Record<string, unknown>): bigint[] {
  const value = (key: string) => BigInt(String(player[key] ?? 0));
  const clearedMaps = Number(player.clearedMaps ?? 0);
  return [
    value("lifetimeRunsStarted"),
    value("lifetimeLinesCleared"),
    value("lifetimeMaxCombo"),
    value("lifetimeBossesCleared"),
    BigInt(popcount16(clearedMaps)),
    value("lifetimePerfectLevels"),
    value("lifetimeDailyChallenges"),
    value("lifetimeBonusUses"),
  ];
}

function popcount16(value: number): number {
  let bits = value & 0xffff;
  let count = 0;
  while (bits !== 0) {
    bits &= bits - 1;
    count += 1;
  }
  return count;
}
