import BN from "bn.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  deriveCampaignProgressPda,
  deriveMapCatalogPda,
  derivePlayerProfilePda,
  deriveProgressCatalogPda,
  deriveProtocolConfigPda,
  deriveTreasuryLedgerPda,
  deriveYieldPolicyPda,
} from "./pdas";
import {
  CANONICAL_ACHIEVEMENT_RULES,
  CANONICAL_QUEST_RULES,
  type AchievementPublicationRule,
  type QuestPublicationRule,
} from "./progressCatalog";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import type { WalletLike } from "./sessionWallet";

export type { AchievementPublicationRule, QuestPublicationRule } from "./progressCatalog";

const MAX_ACHIEVEMENTS = 24;
const MAX_QUESTS = 12;

export interface ProtocolInitialization {
  paymaster: PublicKey;
  teamVault: PublicKey;
  paymasterVault: PublicKey;
  treasuryVault: PublicKey;
  rewardVault: PublicKey;
  paymasterCap: bigint;
  revenueRewardBps: number;
  sponsorshipDailyTxLimit: number;
  sponsorshipDailyPaidAttemptLimit: number;
  paymentMint: PublicKey;
  paymentTokenProgram: PublicKey;
  paymentVault: PublicKey;
  contentVersion: number;
  governanceDelaySeconds: number;
  governanceExecutionWindowSeconds: number;
}

export async function buildInitializeProtocolPlan(args: {
  connection: Connection;
  authority: WalletLike;
  config: ProtocolInitialization;
}): Promise<TransactionPlan> {
  assertPositiveInteger(args.config.sponsorshipDailyTxLimit, "sponsorshipDailyTxLimit");
  assertPositiveInteger(
    args.config.sponsorshipDailyPaidAttemptLimit,
    "sponsorshipDailyPaidAttemptLimit",
  );
  assertPositiveInteger(args.config.contentVersion, "contentVersion");
  assertPositiveInteger(args.config.governanceDelaySeconds, "governanceDelaySeconds");
  assertPositiveInteger(
    args.config.governanceExecutionWindowSeconds,
    "governanceExecutionWindowSeconds",
  );
  if (args.config.paymasterCap < 0n) throw new Error("paymasterCap cannot be negative");
  if (!args.config.paymentTokenProgram.equals(TOKEN_PROGRAM_ID)) {
    throw new Error("protocol v1 accepts only the canonical SPL Token program");
  }
  const vaults = [
    args.config.teamVault,
    args.config.paymasterVault,
    args.config.treasuryVault,
    args.config.rewardVault,
    args.config.paymentVault,
  ];
  if (
    vaults.some((vault) => vault.equals(PublicKey.default))
    || new Set(vaults.map((vault) => vault.toBase58())).size !== vaults.length
  ) throw new Error("protocol vaults must be nonzero and pairwise distinct");
  if (!Number.isInteger(args.config.revenueRewardBps) || args.config.revenueRewardBps < 0 || args.config.revenueRewardBps > 10_000) {
    throw new Error("revenueRewardBps must be between 0 and 10,000");
  }
  const instruction = await zkubeProgram(args.connection, args.authority).methods
    .initializeProtocolV1({
      paymaster: args.config.paymaster,
      teamVault: args.config.teamVault,
      paymasterVault: args.config.paymasterVault,
      treasuryVault: args.config.treasuryVault,
      rewardVault: args.config.rewardVault,
      paymasterCap: new BN(args.config.paymasterCap.toString()),
      revenueRewardBps: args.config.revenueRewardBps,
      sponsorshipDailyTxLimit: args.config.sponsorshipDailyTxLimit,
      sponsorshipDailyPaidAttemptLimit: args.config.sponsorshipDailyPaidAttemptLimit,
      paymentMint: args.config.paymentMint,
      paymentTokenProgram: args.config.paymentTokenProgram,
      paymentVault: args.config.paymentVault,
      contentVersion: args.config.contentVersion,
      governanceDelaySeconds: args.config.governanceDelaySeconds,
      governanceExecutionWindowSeconds: args.config.governanceExecutionWindowSeconds,
    })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      treasuryLedger: deriveTreasuryLedgerPda(),
      yieldPolicy: deriveYieldPolicyPda(),
      paymentMint: args.config.paymentMint,
      teamVault: args.config.teamVault,
      paymasterVault: args.config.paymasterVault,
      treasuryVault: args.config.treasuryVault,
      rewardVault: args.config.rewardVault,
      paymentVault: args.config.paymentVault,
      paymentTokenProgram: args.config.paymentTokenProgram,
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan("Initialize protocol", args.connection, args.authority.publicKey, [instruction]);
}

export async function buildPublishCanonicalMapsPlan(args: {
  connection: Connection;
  authority: WalletLike;
  contentVersion: number;
  mapIds?: readonly number[];
}): Promise<TransactionPlan> {
  assertPositiveInteger(args.contentVersion, "contentVersion");
  const mapIds = args.mapIds ?? Array.from({ length: 10 }, (_, index) => index + 1);
  if (mapIds.length === 0 || new Set(mapIds).size !== mapIds.length) {
    throw new Error("mapIds must be a non-empty unique list");
  }
  const program = zkubeProgram(args.connection, args.authority);
  const instructions = await Promise.all(mapIds.map(async (mapId) => {
    if (!Number.isInteger(mapId) || mapId < 1 || mapId > 10) {
      throw new Error("mapId must be between 1 and 10");
    }
    return program.methods
      .writeCanonicalMapCatalogV1(args.contentVersion, mapId)
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        mapCatalog: deriveMapCatalogPda(args.contentVersion, mapId),
        authority: args.authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }));
  return basePlan(
    `Publish canonical maps ${mapIds.join(",")}`,
    args.connection,
    args.authority.publicKey,
    instructions,
  );
}

export async function buildPublishProgressCatalogPlan(args: {
  connection: Connection;
  authority: WalletLike;
  progressVersion: number;
  achievements?: readonly AchievementPublicationRule[];
  quests?: readonly QuestPublicationRule[];
}): Promise<TransactionPlan> {
  assertPositiveInteger(args.progressVersion, "progressVersion");
  const achievements = args.achievements ?? CANONICAL_ACHIEVEMENT_RULES;
  const activeQuests = args.quests ?? CANONICAL_QUEST_RULES;
  if (achievements.length > MAX_ACHIEVEMENTS) throw new Error("too many achievements");
  if (activeQuests.length > MAX_QUESTS) throw new Error("too many quests");
  for (const [index, rule] of activeQuests.entries()) {
    if (
      !Number.isInteger(rule.metric)
      || rule.metric < 0
      || rule.metric >= 16
      || !Number.isSafeInteger(rule.threshold)
      || rule.threshold <= 0
      || !Number.isSafeInteger(rule.starReward)
      || rule.starReward <= 0
      || (rule.cadence !== 0 && rule.cadence !== 1)
      || !Number.isInteger(rule.rotationModulus)
      || rule.rotationModulus <= 0
      || !Number.isInteger(rule.rotationRemainder)
      || rule.rotationRemainder < 0
      || rule.rotationRemainder >= rule.rotationModulus
    ) {
      throw new Error(`quest ${index} is invalid`);
    }
  }
  const emptyAchievement = {
    metric: 0,
    enabled: false,
    threshold: new BN(0),
    starReward: new BN(0),
    xpReward: 0,
  };
  const achievementRules = Array.from({ length: MAX_ACHIEVEMENTS }, (_, index) => {
    const rule = achievements[index];
    if (!rule) return emptyAchievement;
    if (!Number.isInteger(rule.metric) || rule.metric < 0 || rule.metric > 7) {
      throw new Error(`achievement metric ${index} is invalid`);
    }
    if (
      rule.threshold <= 0n
      || rule.starReward < 0n
      || !Number.isSafeInteger(rule.xpReward)
      || rule.xpReward < 0
      || (rule.starReward === 0n && rule.xpReward === 0)
    ) {
      throw new Error(`achievement ${index} must have positive threshold and reward`);
    }
    return {
      metric: rule.metric,
      enabled: true,
      threshold: new BN(rule.threshold.toString()),
      starReward: new BN(rule.starReward.toString()),
      xpReward: rule.xpReward,
    };
  });
  const emptyQuest = {
    metric: 0,
    cadence: 0,
    rotationModulus: 0,
    rotationRemainder: 0,
    enabled: false,
    threshold: 0,
    starReward: new BN(0),
  };
  const quests = Array.from({ length: MAX_QUESTS }, (_, index) => {
    const rule = activeQuests[index];
    return rule ? { ...rule, starReward: new BN(rule.starReward) } : emptyQuest;
  });
  const instruction = await zkubeProgram(args.connection, args.authority).methods
    .writeProgressCatalogV1({
      progressVersion: args.progressVersion,
      achievementCount: achievements.length,
      questCount: activeQuests.length,
      achievements: achievementRules,
      quests,
    })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      progressCatalog: deriveProgressCatalogPda(args.progressVersion),
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan(
    `Publish progress catalog v${args.progressVersion}`,
    args.connection,
    args.authority.publicKey,
    [instruction],
  );
}

export async function buildInitializePlayerPlan(args: {
  connection: Connection;
  owner: WalletLike;
  payer?: PublicKey;
}): Promise<TransactionPlan> {
  const payer = args.payer ?? args.owner.publicKey;
  const instruction = await zkubeProgram(args.connection, args.owner).methods
    .initializePlayerV1()
    .accountsPartial({
      playerProfile: derivePlayerProfilePda(args.owner.publicKey),
      campaignProgress: deriveCampaignProgressPda(args.owner.publicKey),
      payer,
      owner: args.owner.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return basePlan("Initialize player", args.connection, payer, [instruction]);
}

function basePlan(
  label: string,
  connection: Connection,
  feePayer: PublicKey,
  instructions: TransactionInstruction[],
): TransactionPlan {
  return {
    layer: "solana-base",
    label,
    connection,
    transaction: new Transaction().add(...instructions),
    feePayer,
    signers: [],
  };
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive`);
}
