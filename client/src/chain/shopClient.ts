import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type AccountInfo,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import { MAX_CAMPAIGN_MAPS } from "./campaignCatalog";
import { deriveAssociatedTokenAddress } from "./campaignClient";
import { CANONICAL_DEVNET_USDC_MINT } from "./constants";
import {
  deriveCampaignProgressPda,
  deriveEconomyConfigPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
  deriveStarSalesLedgerPda,
} from "./pdas";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import type { WalletLike } from "./sessionWallet";

export const STAR_PACK_COUNT = 5;

export interface StarPackQuote {
  index: number;
  stars: bigint;
  regularPrice: bigint;
  currentPrice: bigint;
  salePrice: bigint;
  enabled: boolean;
  onSale: boolean;
}

export interface StarShopView {
  economyVersion: 2;
  revision: bigint;
  playerInitialized: boolean;
  starsBalance: bigint;
  dailyEntryStars: bigint;
  zoneUnlockStars: bigint;
  protocolPaused: boolean;
  paymentMint: PublicKey;
  paymentTokenProgram: PublicKey;
  teamDestination: PublicKey;
  rewardVault: PublicKey;
  treasuryDestination: PublicKey;
  saleEnabled: boolean;
  saleStartsAt: bigint;
  saleEndsAt: bigint;
  saleLive: boolean;
  packs: readonly StarPackQuote[];
}

export async function fetchStarShopView(args: {
  connection: Connection;
  wallet: WalletLike;
  nowUnix?: bigint;
}): Promise<StarShopView | null> {
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const protocolAddress = deriveProtocolConfigPda();
  const economyAddress = deriveEconomyConfigPda();
  const playerAddress = derivePlayerProfilePda(owner);
  const campaignAddress = deriveCampaignProgressPda(owner);
  const [protocolInfo, economyInfo, playerInfo, campaignInfo] =
    await args.connection.getMultipleAccountsInfo(
      [protocolAddress, economyAddress, playerAddress, campaignAddress],
      "confirmed",
    );
  if (!protocolInfo || !economyInfo) return null;

  assertProgramAccount(
    protocolInfo,
    program.programId,
    program.account.protocolConfig.size,
    "ProtocolConfig",
  );
  assertProgramAccount(
    economyInfo,
    program.programId,
    program.account.economyConfig.size,
    "EconomyConfig",
  );

  type ProtocolAccount = Awaited<
    ReturnType<typeof program.account.protocolConfig.fetch>
  >;
  type EconomyAccount = Awaited<
    ReturnType<typeof program.account.economyConfig.fetch>
  >;
  type PlayerAccount = Awaited<
    ReturnType<typeof program.account.playerProfile.fetch>
  >;
  type CampaignAccount = Awaited<
    ReturnType<typeof program.account.campaignProgress.fetch>
  >;
  const protocol = program.coder.accounts.decode(
    "protocolConfig",
    protocolInfo.data,
  ) as unknown as ProtocolAccount;
  const economy = program.coder.accounts.decode(
    "economyConfig",
    economyInfo.data,
  ) as unknown as EconomyAccount;

  if (
    Number(protocol.version) !== 1 ||
    Number(economy.version) !== 1 ||
    !economy.protocol.equals(protocolAddress) ||
    !economy.paymentMint.equals(protocol.paymentMint) ||
    !economy.paymentTokenProgram.equals(protocol.paymentTokenProgram) ||
    Number(economy.contentVersion) !== Number(protocol.contentVersion) ||
    !economy.active
  ) {
    return null;
  }
  if (
    !protocol.paymentMint.equals(CANONICAL_DEVNET_USDC_MINT) ||
    !protocol.paymentTokenProgram.equals(TOKEN_PROGRAM_ID)
  ) {
    throw new Error("Shop payment configuration is not canonical Devnet USDC");
  }

  const playerInitialized = Boolean(playerInfo && campaignInfo);
  if (Boolean(playerInfo) !== Boolean(campaignInfo)) {
    throw new Error("Player state is incomplete");
  }
  let starsBalance = 0n;
  if (playerInfo && campaignInfo) {
    assertProgramAccount(
      playerInfo,
      program.programId,
      program.account.playerProfile.size,
      "PlayerProfile",
    );
    assertProgramAccount(
      campaignInfo,
      program.programId,
      program.account.campaignProgress.size,
      "CampaignProgress",
    );
    const player = program.coder.accounts.decode(
      "playerProfile",
      playerInfo.data,
    ) as unknown as PlayerAccount;
    const campaign = program.coder.accounts.decode(
      "campaignProgress",
      campaignInfo.data,
    ) as unknown as CampaignAccount;
    if (
      Number(player.version) !== 1 ||
      !player.owner.equals(owner) ||
      Number(campaign.version) !== 1 ||
      !campaign.owner.equals(owner) ||
      campaign.levelStars.length !== MAX_CAMPAIGN_MAPS
    ) {
      return null;
    }
    starsBalance = BigInt(player.starsBalance.toString());
  }

  const now = args.nowUnix ?? BigInt(Math.floor(Date.now() / 1_000));
  const saleStartsAt = BigInt(economy.saleStartsAt.toString());
  const saleEndsAt = BigInt(economy.saleEndsAt.toString());
  const saleEnabled = Boolean(economy.saleEnabled);
  if (saleEnabled && saleStartsAt >= saleEndsAt) {
    throw new Error("Shop sale window is invalid");
  }
  const saleLive = saleEnabled && now >= saleStartsAt && now < saleEndsAt;
  if (
    BigInt(economy.dailyEntryStars.toString()) <= 0n ||
    BigInt(economy.zoneUnlockStars.toString()) <= 0n
  ) {
    throw new Error("Shop spending rules are invalid");
  }
  const packs = economy.starPackStars.map((rawStars, index) => {
    const stars = BigInt(rawStars.toString());
    const regularPrice = BigInt(economy.starPackPrices[index].toString());
    const salePrice = BigInt(economy.salePrices[index].toString());
    const enabled = Boolean(economy.starPackEnabled[index]);
    if (
      index >= STAR_PACK_COUNT ||
      (enabled && (stars <= 0n || regularPrice <= 0n)) ||
      (saleEnabled && enabled && (salePrice <= 0n || salePrice > regularPrice))
    ) {
      throw new Error(`Star pack ${index + 1} is invalid`);
    }
    return {
      index,
      stars,
      regularPrice,
      currentPrice: saleLive ? salePrice : regularPrice,
      salePrice,
      enabled,
      onSale: saleLive && salePrice < regularPrice,
    };
  });
  if (packs.length !== STAR_PACK_COUNT) {
    throw new Error("Shop must expose exactly five Star packs");
  }

  return {
    economyVersion: 2,
    revision: BigInt(economy.revision.toString()),
    playerInitialized,
    starsBalance,
    dailyEntryStars: BigInt(economy.dailyEntryStars.toString()),
    zoneUnlockStars: BigInt(economy.zoneUnlockStars.toString()),
    protocolPaused: Boolean(protocol.paused),
    paymentMint: protocol.paymentMint,
    paymentTokenProgram: protocol.paymentTokenProgram,
    teamDestination: protocol.teamDestination,
    rewardVault: protocol.rewardVault,
    treasuryDestination: protocol.treasuryDestination,
    saleEnabled,
    saleStartsAt,
    saleEndsAt,
    saleLive,
    packs,
  };
}

export function hasStarPackQuoteChanged(
  quoted: StarPackQuote,
  fresh: StarPackQuote | undefined,
): boolean {
  return (
    !fresh ||
    quoted.index !== fresh.index ||
    quoted.stars !== fresh.stars ||
    quoted.currentPrice !== fresh.currentPrice ||
    quoted.enabled !== fresh.enabled
  );
}

export async function buildStarPurchasePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  shop: StarShopView;
  packIndex: number;
  playerPaymentAccount?: PublicKey;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  if (
    !Number.isInteger(args.packIndex) ||
    args.packIndex < 0 ||
    args.packIndex >= args.shop.packs.length
  ) {
    throw new Error("Unknown Star pack");
  }
  if (args.shop.protocolPaused) throw new Error("The Shop is temporarily paused");
  const pack = args.shop.packs[args.packIndex];
  if (!pack.enabled) throw new Error("Star pack is disabled");

  const owner = args.wallet.publicKey;
  const feePayer = args.paymaster ?? owner;
  const program = zkubeProgram(args.connection, args.wallet);
  const instructions: TransactionInstruction[] = [];
  if (!args.shop.playerInitialized) {
    instructions.push(
      await program.methods
        .initializePlayer()
        .accountsPartial({
          playerProfile: derivePlayerProfilePda(owner),
          campaignProgress: deriveCampaignProgressPda(owner),
          payer: feePayer,
          owner,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  }
  instructions.push(
    await program.methods
      .purchaseStars(
        args.packIndex,
        new BN(pack.stars.toString()),
        new BN(pack.currentPrice.toString()),
      )
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        economyConfig: deriveEconomyConfigPda(),
        starSalesLedger: deriveStarSalesLedgerPda(),
        playerProfile: derivePlayerProfilePda(owner),
        paymentMint: args.shop.paymentMint,
        playerPaymentAccount:
          args.playerPaymentAccount ??
          deriveAssociatedTokenAddress(
            owner,
            args.shop.paymentMint,
            args.shop.paymentTokenProgram,
          ),
        teamDestination: args.shop.teamDestination,
        rewardVault: args.shop.rewardVault,
        treasuryDestination: args.shop.treasuryDestination,
        tokenProgram: args.shop.paymentTokenProgram,
        owner,
      })
      .instruction(),
  );
  return {
    layer: "solana-base",
    label: args.shop.playerInitialized
      ? "Purchase Stars"
      : "Initialize player and purchase Stars",
    connection: args.connection,
    transaction: new Transaction().add(...instructions),
    feePayer,
    signers: [],
  };
}

function assertProgramAccount(
  info: AccountInfo<Buffer>,
  programId: PublicKey,
  expectedSize: number,
  label: string,
): void {
  if (!info.owner.equals(programId)) {
    throw new Error(`${label} has the wrong owner`);
  }
  if (info.executable) throw new Error(`${label} must not be executable`);
  if (info.data.length !== expectedSize) {
    throw new Error(`${label} has invalid data length ${info.data.length}`);
  }
}
