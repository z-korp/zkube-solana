import { SystemProgram, Transaction, type Connection, type PublicKey } from "@solana/web3.js";
import type { WalletLike } from "./sessionWallet";
import {
  deriveCampaignProgressPda,
  derivePlayerProfilePda,
  deriveProgressCatalogPda,
  deriveProtocolConfigPda,
  deriveQuestClaimsPda,
} from "./pdas";
import { zkubeProgram, type TransactionPlan } from "./runPlan";

export interface AchievementProgressView {
  index: number;
  metric: number;
  progress: bigint;
  threshold: bigint;
  starReward: bigint;
  xpReward: number;
  claimed: boolean;
  claimable: boolean;
}

export interface QuestProgressView {
  index: number;
  metric: number;
  cadence: "daily" | "weekly";
  progress: number;
  threshold: number;
  starReward: bigint;
  active: boolean;
  claimed: boolean;
  claimable: boolean;
}

export interface ProgressView {
  progressVersion: number;
  starsBalance: bigint;
  achievementXp: bigint;
  achievements: AchievementProgressView[];
  quests: QuestProgressView[];
}

export async function fetchProgressView(args: {
  connection: Connection;
  wallet: WalletLike;
  nowUnix?: number;
}): Promise<ProgressView | null> {
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const protocol = await program.account.protocolConfig.fetchNullable(deriveProtocolConfigPda());
  const player = await program.account.playerProfile.fetchNullable(derivePlayerProfilePda(owner));
  const campaign = await program.account.campaignProgress.fetchNullable(
    deriveCampaignProgressPda(owner),
  );
  if (!protocol || !player || !campaign || Number(protocol.progressVersion) === 0) return null;
  const progressVersion = Number(protocol.progressVersion);
  const catalog = await program.account.progressCatalog.fetch(
    deriveProgressCatalogPda(progressVersion),
  );
  const claims = await program.account.questClaims.fetchNullable(
    deriveQuestClaimsPda(owner, progressVersion),
  );
  const now = args.nowUnix ?? Math.floor(Date.now() / 1_000);
  const day = Math.max(0, Math.floor(now / 86_400));
  const week = Math.max(0, Math.floor((now + 259_200) / 604_800));
  const achievementFlags = player.achievementFlags.map((value) => BigInt(value.toString()));
  const metrics = achievementMetrics(player, campaign);
  const achievements = catalog.achievements
    .slice(0, Number(catalog.achievementCount))
    .map((rule, index) => {
      const threshold = BigInt(rule.threshold.toString());
      const progress = metrics[Number(rule.metric)] ?? 0n;
      const claimed = (achievementFlags[Math.floor(index / 64)] & (1n << BigInt(index % 64))) !== 0n;
      return {
        index,
        metric: Number(rule.metric),
        progress,
        threshold,
        starReward: BigInt(rule.starReward.toString()),
        xpReward: Number(rule.xpReward),
        claimed,
        claimable: Boolean(rule.enabled) && !claimed && progress >= threshold,
      };
    });
  const dailyClaims = claims && Number(claims.dailyCadenceId) === day
    ? Number(claims.dailyClaimed)
    : 0;
  const weeklyClaims = claims && Number(claims.weeklyCadenceId) === week
    ? Number(claims.weeklyClaimed)
    : 0;
  const quests = catalog.quests.slice(0, Number(catalog.questCount)).map((rule, index) => {
    const cadence = Number(rule.cadence) === 0 ? "daily" as const : "weekly" as const;
    const active = cadence === "weekly"
      || day % Number(rule.rotationModulus) === Number(rule.rotationRemainder);
    const claimedBitmap = cadence === "daily" ? dailyClaims : weeklyClaims;
    const claimed = (claimedBitmap & (1 << index)) !== 0;
    const progress = Number(player.questCounters[Number(rule.metric)] ?? 0);
    const threshold = Number(rule.threshold);
    return {
      index,
      metric: Number(rule.metric),
      cadence,
      progress,
      threshold,
      starReward: BigInt(rule.starReward.toString()),
      active,
      claimed,
      claimable: Boolean(rule.enabled) && active && !claimed && progress >= threshold,
    };
  });
  return {
    progressVersion,
    starsBalance: BigInt(player.starsBalance.toString()),
    achievementXp: BigInt(player.achievementXp.toString()),
    achievements,
    quests,
  };
}

export async function buildClaimAchievementPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  achievementIndex: number;
  progressVersion: number;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  assertIndex(args.achievementIndex, 24, "achievementIndex");
  const owner = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .claimAchievementV1(args.achievementIndex)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      progressCatalog: deriveProgressCatalogPda(args.progressVersion),
      playerProfile: derivePlayerProfilePda(owner),
      campaignProgress: deriveCampaignProgressPda(owner),
      owner,
    })
    .instruction();
  return basePlan("Claim achievement reward", args.connection, args.paymaster ?? owner, instruction);
}

export async function buildClaimQuestPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  questIndex: number;
  progressVersion: number;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  assertIndex(args.questIndex, 12, "questIndex");
  const owner = args.wallet.publicKey;
  const payer = args.paymaster ?? owner;
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .claimQuestV1(args.questIndex)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      progressCatalog: deriveProgressCatalogPda(args.progressVersion),
      playerProfile: derivePlayerProfilePda(owner),
      questClaims: deriveQuestClaimsPda(owner, args.progressVersion),
      payer,
      owner,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan("Claim quest Stars", args.connection, payer, instruction);
}

function achievementMetrics(player: Record<string, unknown>, campaign: Record<string, unknown>): bigint[] {
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
