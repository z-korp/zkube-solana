import {
  SystemProgram,
  Transaction,
  type Connection,
  type PublicKey,
} from "@solana/web3.js";
import type { WalletLike } from "./sessionWallet";
import { ZKUBE_PROGRAM_ID } from "./constants";
import {
  deriveCampaignProgressPda,
  deriveEconomyConfigPda,
  deriveLevelMilestonesPda,
  derivePlayerFundingPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
  deriveQuestClaimsPda,
  deriveWeeklyStipendPda,
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
  const player = await program.account.playerProfile.fetchNullable(
    derivePlayerProfilePda(owner),
  );
  const campaign = await program.account.campaignProgress.fetchNullable(
    deriveCampaignProgressPda(owner),
  );
  if (!protocol || !player || !campaign) return null;
  const [claims, milestones, weeklyStipend] = await Promise.all([
    program.account.questClaims.fetchNullable(deriveQuestClaimsPda(owner)),
    program.account.levelMilestones.fetchNullable(
      deriveLevelMilestonesPda(owner),
    ),
    program.account.weeklyStipend.fetchNullable(deriveWeeklyStipendPda(owner)),
  ]);
  const now = args.nowUnix ?? Math.floor(Date.now() / 1_000);
  const day = Math.max(0, Math.floor(now / 86_400));
  const week = Math.max(0, Math.floor((now + 259_200) / 604_800));
  const achievementFlags = player.achievementFlags.map((value) =>
    BigInt(value.toString()),
  );
  const metrics = achievementMetrics(player, campaign);
  const achievements = CANONICAL_ACHIEVEMENT_RULES.map((rule, index) => {
    const progress = metrics[rule.metric] ?? 0n;
    const claimed =
      (achievementFlags[Math.floor(index / 64)] &
        (1n << BigInt(index % 64))) !==
      0n;
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
    claims && Number(claims.dailyCadenceId) === day
      ? Number(claims.dailyClaimed)
      : 0;
  const weeklyClaims =
    claims && Number(claims.weeklyCadenceId) === week
      ? Number(claims.weeklyClaimed)
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
    levelMilestones: milestones
      ? {
          claimed: Number(milestones.claimed),
          totalStarsClaimed: BigInt(milestones.totalStarsClaimed.toString()),
        }
      : { claimed: 0, totalStarsClaimed: 0n },
    weeklyStipend:
      weeklyStipend && Number(weeklyStipend.weekId) === week
        ? {
            weekId: Number(weeklyStipend.weekId),
            recurringXp: Number(weeklyStipend.recurringXp),
            starsAwarded: Boolean(weeklyStipend.starsAwarded),
            lifetimeStarsAwarded: BigInt(
              weeklyStipend.lifetimeStarsAwarded.toString(),
            ),
          }
        : {
            weekId: week,
            recurringXp: 0,
            starsAwarded: false,
            lifetimeStarsAwarded: weeklyStipend
              ? BigInt(weeklyStipend.lifetimeStarsAwarded.toString())
              : 0n,
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
    .methods.fundedClaimLevelMilestone(args.milestoneIndex)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      economyConfig: deriveEconomyConfigPda(),
      playerProfile: derivePlayerProfilePda(owner),
      levelMilestones: deriveLevelMilestonesPda(owner),
      playerFunding: derivePlayerFundingPda(owner),
      ownerAuthority: owner,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
      systemProgram: SystemProgram.programId,
      zkubeProgram: ZKUBE_PROGRAM_ID,
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
      playerProfile: derivePlayerProfilePda(owner),
      campaignProgress: deriveCampaignProgressPda(owner),
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
    .methods.fundedClaimQuest(args.questIndex)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      playerProfile: derivePlayerProfilePda(owner),
      questClaims: deriveQuestClaimsPda(owner),
      weeklyStipend: deriveWeeklyStipendPda(owner),
      playerFunding: derivePlayerFundingPda(owner),
      ownerAuthority: owner,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
      systemProgram: SystemProgram.programId,
      zkubeProgram: ZKUBE_PROGRAM_ID,
    })
    .instruction();
  return basePlan(
    args.questIndex < 10 ? "Claim Daily quest XP" : "Claim Weekly quest Stars",
    args.connection,
    args.wallet.publicKey,
    instruction,
  );
}

function achievementMetrics(
  player: Record<string, unknown>,
  campaign: Record<string, unknown>,
): bigint[] {
  const value = (key: string) => BigInt(String(player[key] ?? 0));
  const clearedMaps = Number(campaign.clearedMaps ?? 0);
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
