import {
  Transaction,
  type Connection,
  type PublicKey,
} from "@solana/web3.js";
import type { WalletLike } from "./sessionWallet";
import {
  deriveEconomyConfigPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
} from "./pdas";
import {
  CANONICAL_ACHIEVEMENT_RULES,
  CANONICAL_QUEST_RULES,
  blockQuestVariant,
  dailyQuestIndices,
  questRuleForDay,
} from "./progressCatalog";
import { zkubeProgram, type TransactionPlan } from "./runPlan";

export interface AchievementProgressView {
  index: number;
  metric: number;
  progress: bigint;
  threshold: bigint;
  xpReward: number;
  claimed: boolean;
  claimable: boolean;
}

export interface QuestProgressView {
  index: number;
  metric: number;
  blockSize: number | null;
  cadence: "daily" | "weekly";
  progress: number;
  threshold: number;
  xpReward: number;
  starReward: bigint;
  active: boolean;
  claimed: boolean;
  claimable: boolean;
}

export interface LifetimeStatsView {
  runsStarted: bigint;
  linesCleared: bigint;
  maxCombo: number;
  bossesCleared: bigint;
  perfectLevels: bigint;
  dailyChallenges: bigint;
  bonusUses: bigint;
}

export interface ProgressView {
  starsBalance: bigint;
  lifetimeXp: bigint;
  lifetime: LifetimeStatsView;
  achievements: AchievementProgressView[];
  quests: QuestProgressView[];
  levelMilestones: { claimed: number; totalStarsClaimed: bigint } | null;
  weeklyStipend: {
    weekId: number;
    recurringXp: number;
    starsAwarded: boolean;
    lifetimeStarsAwarded: bigint;
  } | null;
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
  const day = Math.max(0, Math.floor(now / 86_400));
  const week = Math.max(0, Math.floor((now + 259_200) / 604_800));
  const achievementFlags = BigInt(player.achievementFlags);
  const metrics = achievementMetrics(player);
  const achievements = CANONICAL_ACHIEVEMENT_RULES.map((rule, index) => {
    const progress = metrics[rule.metric] ?? 0n;
    const claimed = (achievementFlags & (1n << BigInt(index))) !== 0n;
    return {
      index,
      metric: rule.metric,
      progress,
      threshold: rule.threshold,
      xpReward: rule.xpReward,
      claimed,
      claimable: !claimed && progress >= rule.threshold,
    };
  });
  const dailyClaims =
    Number(player.dailyClaimCadenceId) === day
      ? Number(player.dailyClaimed)
      : 0;
  const weeklyClaims =
    Number(player.weeklyClaimCadenceId) === week
      ? Number(player.weeklyClaimed)
      : 0;
  const dailyCounterIsCurrent = Number(player.questCadenceDay) === day;
  const weeklyCounterIsCurrent = Number(player.questCadenceWeek) === week;
  const selectedDailyQuests = dailyQuestIndices(day);
  const quests = CANONICAL_QUEST_RULES.map((_canonicalRule, index) => {
    const rule = questRuleForDay(index, day);
    const blockSize = index === 7 ? blockQuestVariant(day).blockSize : null;
    const cadence =
      rule.cadence === 0 ? ("daily" as const) : ("weekly" as const);
    const active =
      cadence === "weekly" ||
      index === 9 ||
      selectedDailyQuests.includes(index);
    const claimedBitmap = cadence === "daily" ? dailyClaims : weeklyClaims;
    const claimed = (claimedBitmap & (1 << index)) !== 0;
    const counterIsCurrent =
      cadence === "daily" ? dailyCounterIsCurrent : weeklyCounterIsCurrent;
    const progress = counterIsCurrent
      ? Number(player.questCounters[rule.metric] ?? 0)
      : 0;
    return {
      index,
      metric: rule.metric,
      blockSize,
      cadence,
      progress,
      threshold: rule.threshold,
      xpReward: rule.xpReward,
      starReward: BigInt(rule.starReward),
      active,
      claimed,
      claimable: active && !claimed && progress >= rule.threshold,
    };
  });
  const lifetimeValue = (key: string) =>
    BigInt(String((player as Record<string, unknown>)[key] ?? 0));
  return {
    starsBalance: BigInt(player.starsBalance.toString()),
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
    levelMilestones: {
      claimed: Number(player.milestoneClaimed),
      totalStarsClaimed: BigInt(player.milestoneStarsClaimed.toString()),
    },
    weeklyStipend:
      Number(player.stipendWeekId) === week
        ? {
            weekId: Number(player.stipendWeekId),
            recurringXp: Number(player.stipendRecurringXp),
            starsAwarded: Boolean(player.stipendStarsAwarded),
            lifetimeStarsAwarded: BigInt(
              player.lifetimeStipendStarsAwarded.toString(),
            ),
          }
        : {
            weekId: week,
            recurringXp: 0,
            starsAwarded: false,
            lifetimeStarsAwarded: BigInt(
              player.lifetimeStipendStarsAwarded.toString(),
            ),
          },
  };
}

export async function buildClaimLevelMilestonePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey;
  milestoneIndex: number;
}): Promise<TransactionPlan> {
  assertIndex(args.milestoneIndex, 10, "milestoneIndex");
  const owner = args.ownerAuthority;
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.claimLevelMilestone(args.milestoneIndex)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      economyConfig: deriveEconomyConfigPda(),
      playerState: derivePlayerStatePda(owner),
      ownerAuthority: owner,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
    })
    .instruction();
  return basePlan(
    "Claim level milestone Stars",
    args.connection,
    args.wallet.publicKey,
    instruction,
  );
}

export async function buildClaimAchievementPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey | null;
  achievementIndex: number;
}): Promise<TransactionPlan> {
  assertIndex(args.achievementIndex, 24, "achievementIndex");
  const owner = args.ownerAuthority;
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.claimAchievement(args.achievementIndex)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      playerState: derivePlayerStatePda(owner),
      ownerAuthority: owner,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
    })
    .instruction();
  return basePlan(
    "Claim achievement reward",
    args.connection,
    args.wallet.publicKey,
    instruction,
  );
}

export async function buildClaimQuestPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey;
  questIndex: number;
}): Promise<TransactionPlan> {
  assertIndex(args.questIndex, 12, "questIndex");
  const owner = args.ownerAuthority;
  const instruction = await zkubeProgram(args.connection, args.wallet)
    .methods.claimQuest(args.questIndex)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      playerState: derivePlayerStatePda(owner),
      ownerAuthority: owner,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
    })
    .instruction();
  return basePlan(
    args.questIndex < 10 ? "Claim Daily quest XP" : "Claim Weekly quest Stars",
    args.connection,
    args.wallet.publicKey,
    instruction,
  );
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

function basePlan(
  label: string,
  connection: Connection,
  feePayer: PublicKey,
  instruction: import("@solana/web3.js").TransactionInstruction,
): TransactionPlan {
  return {
    layer: "solana-base",
    label,
    connection,
    transaction: new Transaction().add(instruction),
    feePayer,
    signers: [],
  };
}

function assertIndex(value: number, length: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= length) {
    throw new Error(`${label} is out of range`);
  }
}
