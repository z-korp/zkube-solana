import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import type { WalletLike } from "./sessionWallet";
import {
  deriveCampaignProgressPda,
  deriveMapCatalogPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
  deriveTreasuryLedgerPda,
} from "./pdas";
import {
  mapLevelRuleSnapshot,
  zkubeProgram,
  type ActiveRunRulesView,
  type RawLevelRuleSnapshot,
  type TransactionPlan,
} from "./runPlan";

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export interface CampaignMapView {
  mapId: number;
  themeId: number;
  enabled: boolean;
  unlocked: boolean;
  purchased: boolean;
  cleared: boolean;
  perfected: boolean;
  starCost: bigint;
  usdcCost: bigint;
  levelStars: number[];
  levels: ActiveRunRulesView[];
}

export interface CampaignView {
  contentVersion: number;
  starsBalance: bigint;
  paymentMint: PublicKey;
  paymentTokenProgram: PublicKey;
  paymentVault: PublicKey;
  maps: CampaignMapView[];
}

export async function fetchCampaignView(args: {
  connection: Connection;
  wallet: WalletLike;
}): Promise<CampaignView | null> {
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const [protocol, player, campaign] = await Promise.all([
    program.account.protocolConfig.fetchNullable(deriveProtocolConfigPda()),
    program.account.playerProfile.fetchNullable(derivePlayerProfilePda(owner)),
    program.account.campaignProgress.fetchNullable(deriveCampaignProgressPda(owner)),
  ]);
  if (!protocol || !player || !campaign) return null;
  const contentVersion = Number(protocol.contentVersion);
  const catalogs = await Promise.all(Array.from({ length: 10 }, (_, index) =>
    program.account.mapCatalog.fetchNullable(deriveMapCatalogPda(contentVersion, index + 1))));
  const unlocked = Number(campaign.unlockedMaps);
  const purchased = Number(campaign.purchasedMaps);
  const cleared = Number(campaign.clearedMaps);
  const perfected = Number(campaign.perfectedMaps);
  const maps = catalogs.flatMap((catalog, index) => {
    if (!catalog) return [];
    const mapId = index + 1;
    const packedStars = Number(campaign.levelStars[index]);
    return [{
      mapId,
      themeId: Number(catalog.themeId),
      enabled: Boolean(catalog.enabled),
      unlocked: hasMapFlag(unlocked, mapId),
      purchased: hasMapFlag(purchased, mapId),
      cleared: hasMapFlag(cleared, mapId),
      perfected: hasMapFlag(perfected, mapId),
      starCost: BigInt(catalog.starUnlockCost.toString()),
      usdcCost: BigInt(catalog.usdcUnlockCost.toString()),
      levelStars: unpackLevelStars(packedStars),
      levels: (catalog.levels as RawLevelRuleSnapshot[]).map((rule) =>
        mapLevelRuleSnapshot(rule),
      ),
    }];
  });
  return {
    contentVersion,
    starsBalance: BigInt(player.starsBalance.toString()),
    paymentMint: protocol.paymentMint,
    paymentTokenProgram: protocol.paymentTokenProgram,
    paymentVault: protocol.paymentVault,
    maps,
  };
}

export function hasMapFlag(bitmap: number, mapId: number): boolean {
  if (!Number.isInteger(mapId) || mapId < 1 || mapId > 10) return false;
  return (bitmap & (1 << (mapId - 1))) !== 0;
}

export function unpackLevelStars(packedStars: number): number[] {
  return Array.from({ length: 10 }, (_, level) => (packedStars >>> (level * 2)) & 0x3);
}

export async function buildUnlockMapWithStarsPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  contentVersion: number;
  mapId: number;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  const owner = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .unlockMapWithStarsV1()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      playerProfile: derivePlayerProfilePda(owner),
      campaignProgress: deriveCampaignProgressPda(owner),
      mapCatalog: deriveMapCatalogPda(args.contentVersion, args.mapId),
      owner,
    })
    .instruction();
  return plan("Unlock map with Stars", args.connection, args.paymaster ?? owner, instruction);
}

export async function buildPurchaseMapWithUsdcPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  campaign: CampaignView;
  mapId: number;
  playerPaymentAccount?: PublicKey;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  const owner = args.wallet.publicKey;
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .purchaseMapWithUsdcV1()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      treasuryLedger: deriveTreasuryLedgerPda(),
      campaignProgress: deriveCampaignProgressPda(owner),
      mapCatalog: deriveMapCatalogPda(args.campaign.contentVersion, args.mapId),
      paymentMint: args.campaign.paymentMint,
      playerPaymentAccount: args.playerPaymentAccount ?? deriveAssociatedTokenAddress(
        owner,
        args.campaign.paymentMint,
        args.campaign.paymentTokenProgram,
      ),
      paymentVault: args.campaign.paymentVault,
      paymentTokenProgram: args.campaign.paymentTokenProgram,
      owner,
    })
    .instruction();
  return plan("Purchase map with USDC", args.connection, args.paymaster ?? owner, instruction);
}

export function deriveAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function plan(
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
