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
  derivePlayerFundingPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
  deriveRewardVaultPda,
} from "./pdas";
import {
  CANONICAL_CAMPAIGN_MAP_COUNT,
  MAX_CAMPAIGN_MAPS,
  canonicalCampaignMap,
} from "./campaignCatalog";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import type { WalletLike } from "./sessionWallet";

export interface ProtocolInitialization {
  pricingOperator: PublicKey;
  teamDestination: PublicKey;
  treasuryDestination: PublicKey;
  contentVersion: number;
}

export async function buildInitializeProtocolPlan(args: {
  connection: Connection;
  authority: WalletLike;
  config: ProtocolInitialization;
}): Promise<TransactionPlan> {
  assertPositiveInteger(args.config.contentVersion, "contentVersion");
  const destinations = [
    args.config.teamDestination,
    args.config.treasuryDestination,
    deriveRewardVaultPda(),
  ];
  if (
    destinations.some((destination) => destination.equals(PublicKey.default))
    || new Set(destinations.map((destination) => destination.toBase58())).size !== destinations.length
  ) throw new Error("protocol destinations must be nonzero and pairwise distinct");
  if (args.config.pricingOperator.equals(PublicKey.default)) {
    throw new Error("pricingOperator cannot be zero");
  }
  const instruction = await zkubeProgram(args.connection, args.authority).methods
    .initializeProtocol({
      pricingOperator: args.config.pricingOperator,
      teamDestination: args.config.teamDestination,
      treasuryDestination: args.config.treasuryDestination,
      contentVersion: args.config.contentVersion,
    })
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      teamDestination: args.config.teamDestination,
      treasuryDestination: args.config.treasuryDestination,
      rewardVault: deriveRewardVaultPda(),
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
  const mapIds = args.mapIds ?? Array.from(
    { length: CANONICAL_CAMPAIGN_MAP_COUNT },
    (_, index) => index + 1,
  );
  if (mapIds.length === 0 || new Set(mapIds).size !== mapIds.length) {
    throw new Error("mapIds must be a non-empty unique list");
  }
  const program = zkubeProgram(args.connection, args.authority);
  const instructions = await Promise.all(mapIds.map(async (mapId) => {
    if (
      !Number.isInteger(mapId)
      || mapId < 1
      || mapId > CANONICAL_CAMPAIGN_MAP_COUNT
    ) {
      throw new Error(
        `mapId must be between 1 and ${CANONICAL_CAMPAIGN_MAP_COUNT}`,
      );
    }
    const map = canonicalCampaignMap(args.contentVersion, mapId);
    return program.methods
      .writeMapCatalog({
        contentVersion: args.contentVersion,
        mapId,
        themeId: map.themeId,
        enabled: map.enabled,
        mapRules: map.mapRules,
        levels: map.levels,
      })
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

export async function buildActivateCampaignMapPlan(args: {
  connection: Connection;
  authority: WalletLike;
  contentVersion: number;
  mapId: number;
}): Promise<TransactionPlan> {
  assertPositiveInteger(args.contentVersion, "contentVersion");
  if (
    !Number.isInteger(args.mapId)
    || args.mapId < 1
    || args.mapId > MAX_CAMPAIGN_MAPS
  ) {
    throw new Error(
      `mapId must be between 1 and ${MAX_CAMPAIGN_MAPS}`,
    );
  }
  const instruction = await zkubeProgram(args.connection, args.authority).methods
    .activateCampaignMap()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      mapCatalog: deriveMapCatalogPda(args.contentVersion, args.mapId),
      authority: args.authority.publicKey,
    })
    .instruction();
  return basePlan(
    `Activate campaign map ${args.mapId}`,
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
    .initializePlayer()
    .accountsPartial({
      playerProfile: derivePlayerProfilePda(args.owner.publicKey),
      campaignProgress: deriveCampaignProgressPda(args.owner.publicKey),
      playerFunding: derivePlayerFundingPda(args.owner.publicKey),
      payer,
      ownerAuthority: args.owner.publicKey,
      sessionToken: null,
      actor: args.owner.publicKey,
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
