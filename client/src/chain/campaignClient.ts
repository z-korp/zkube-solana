import BN from "bn.js";
import {
  PublicKey,
  Transaction,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";
import type { WalletLike } from "./sessionWallet.js";
import {
  deriveCampaignProgressPda,
  deriveEconomyConfigPda,
  deriveMapCatalogPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
  deriveStarSalesLedgerPda,
} from "./pdas.js";
import {
  mapLevelRuleSnapshot,
  zkubeProgram,
  type ActiveRunRulesView,
  type RawLevelRuleSnapshot,
  type TransactionPlan,
} from "./runPlan.js";
import { MAX_CAMPAIGN_MAPS } from "./campaignCatalog.js";

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
  levelStars: number[];
  levels: ActiveRunRulesView[];
}

export interface CampaignView {
  economyVersion: 2;
  contentVersion: number;
  starsBalance: bigint;
  paymentMint: PublicKey;
  paymentTokenProgram: PublicKey;
  teamDestination: PublicKey;
  rewardVault: PublicKey;
  treasuryDestination: PublicKey;
  starPacks: readonly { stars: bigint; price: bigint; enabled: boolean }[];
  maps: CampaignMapView[];
}

export async function fetchCampaignView(args: {
  connection: Connection;
  wallet: WalletLike;
}): Promise<CampaignView | null> {
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const protocolAddress = deriveProtocolConfigPda();
  const playerAddress = derivePlayerProfilePda(owner);
  const campaignAddress = deriveCampaignProgressPda(owner);
  const economyAddress = deriveEconomyConfigPda();
  const [protocolInfo, playerInfo, campaignInfo, economyInfo] =
    await args.connection.getMultipleAccountsInfo(
      [protocolAddress, playerAddress, campaignAddress, economyAddress],
      "confirmed",
    );
  if (!protocolInfo || !playerInfo || !campaignInfo || !economyInfo) return null;
  assertProgramAccount(
    protocolInfo,
    program.programId,
    program.account.protocolConfig.size,
    "ProtocolConfig",
  );
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
  assertProgramAccount(
    economyInfo,
    program.programId,
    program.account.economyConfig.size,
    "EconomyConfig",
  );

  type ProtocolAccount = Awaited<
    ReturnType<typeof program.account.protocolConfig.fetch>
  >;
  type PlayerAccount = Awaited<
    ReturnType<typeof program.account.playerProfile.fetch>
  >;
  type CampaignAccount = Awaited<
    ReturnType<typeof program.account.campaignProgress.fetch>
  >;
  type EconomyAccount = Awaited<
    ReturnType<typeof program.account.economyConfig.fetch>
  >;
  const protocol = program.coder.accounts.decode(
    "protocolConfig",
    protocolInfo.data,
  ) as unknown as ProtocolAccount;
  const player = program.coder.accounts.decode(
    "playerProfile",
    playerInfo.data,
  ) as unknown as PlayerAccount;
  const campaign = program.coder.accounts.decode(
    "campaignProgress",
    campaignInfo.data,
  ) as unknown as CampaignAccount;
  const economy = program.coder.accounts.decode(
    "economyConfig",
    economyInfo.data,
  ) as unknown as EconomyAccount;
  if (
    Number(protocol.version) !== 1
    || Number(player.version) !== 1
    || !player.owner.equals(owner)
    || Number(campaign.version) !== 1
    || !campaign.owner.equals(owner)
    || campaign.levelStars.length !== MAX_CAMPAIGN_MAPS
    || Number(economy.version) !== 1
    || !economy.protocol.equals(protocolAddress)
    || !economy.paymentMint.equals(protocol.paymentMint)
    || !economy.paymentTokenProgram.equals(protocol.paymentTokenProgram)
    || !economy.active
  ) {
    return null;
  }
  const contentVersion = Number(protocol.contentVersion);
  const campaignMapCount = Number(protocol.campaignMapCount);
  if (
    !Number.isInteger(campaignMapCount)
    || campaignMapCount < 1
    || campaignMapCount > MAX_CAMPAIGN_MAPS
  ) return null;
  if (Number(economy.contentVersion) !== contentVersion) return null;
  const catalogAddresses = Array.from(
    { length: campaignMapCount },
    (_, index) => deriveMapCatalogPda(contentVersion, index + 1),
  );
  const catalogInfos = await args.connection.getMultipleAccountsInfo(
    catalogAddresses,
    "confirmed",
  );
  type MapCatalogAccount = Awaited<
    ReturnType<typeof program.account.mapCatalog.fetch>
  >;
  const catalogs = catalogInfos.map((info, index): MapCatalogAccount | null => {
    if (!info) return null;
    assertProgramAccount(
      info,
      program.programId,
      program.account.mapCatalog.size,
      `MapCatalog ${index + 1}`,
    );
    return program.coder.accounts.decode(
      "mapCatalog",
      info.data,
    ) as unknown as MapCatalogAccount;
  });
  if (!catalogs.every((catalog, index) =>
    catalog
    && Number(catalog.version) === 1
    && Number(catalog.contentVersion) === contentVersion
    && Number(catalog.mapId) === index + 1
    && catalog.levels.length === 10)) return null;
  const maps = catalogs.map((catalog, index) => {
    if (!catalog) {
      throw new Error("active campaign catalog disappeared during decode");
    }
    const mapId = index + 1;
    const packedStars = Number(campaign.levelStars[index]);
    return {
      mapId,
      themeId: Number(catalog.themeId),
      enabled: Boolean(catalog.enabled),
      unlocked: hasMapFlag(campaign.unlockedMaps, mapId),
      purchased: hasMapFlag(campaign.purchasedMaps, mapId),
      cleared: hasMapFlag(campaign.clearedMaps, mapId),
      perfected: hasMapFlag(campaign.perfectedMaps, mapId),
      starCost: mapId > 1 ? BigInt(economy.zoneUnlockStars.toString()) : 0n,
      levelStars: unpackLevelStars(packedStars),
      levels: catalog.levels.map((level, levelIndex) => mapLevelRuleSnapshot({
        ...level,
        ...catalog.mapRules,
        bossId: levelIndex === 9 ? catalog.mapRules.bossId : 0,
      } as RawLevelRuleSnapshot)),
    };
  });
  return {
    economyVersion: 2,
    contentVersion,
    starsBalance: BigInt(player.starsBalance.toString()),
    paymentMint: protocol.paymentMint,
    paymentTokenProgram: protocol.paymentTokenProgram,
    teamDestination: protocol.teamDestination,
    rewardVault: protocol.rewardVault,
    treasuryDestination: protocol.treasuryDestination,
    starPacks: economy.starPackStars.map((stars, index) => ({
      stars: BigInt(stars.toString()),
      price: currentPackPrice(economy, index),
      enabled: Boolean(economy.starPackEnabled[index]),
    })),
    maps,
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

export function hasMapFlag(
  bitmap: number | bigint | BN,
  mapId: number,
): boolean {
  if (!Number.isInteger(mapId) || mapId < 1 || mapId > MAX_CAMPAIGN_MAPS) {
    return false;
  }
  const value = BigInt(bitmap.toString());
  return (value & (1n << BigInt(mapId - 1))) !== 0n;
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
  const program = zkubeProgram(args.connection, args.wallet);
  const accounts = {
    protocol: deriveProtocolConfigPda(),
    playerProfile: derivePlayerProfilePda(owner),
    campaignProgress: deriveCampaignProgressPda(owner),
    mapCatalog: deriveMapCatalogPda(args.contentVersion, args.mapId),
    owner,
  };
  const instruction = await program.methods
    .unlockZone()
    .accountsPartial({
      protocol: accounts.protocol,
      economyConfig: deriveEconomyConfigPda(),
      playerProfile: accounts.playerProfile,
      campaignProgress: accounts.campaignProgress,
      mapCatalog: accounts.mapCatalog,
      owner,
    })
    .instruction();
  return plan("Unlock map with Stars", args.connection, args.paymaster ?? owner, instruction);
}

export async function buildPurchaseStarsPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  campaign: CampaignView;
  packIndex: number;
  playerPaymentAccount?: PublicKey;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  if (!Number.isInteger(args.packIndex) || args.packIndex < 0 || args.packIndex >= args.campaign.starPacks.length) {
    throw new Error("Unknown Star pack");
  }
  const owner = args.wallet.publicKey;
  const pack = args.campaign.starPacks[args.packIndex];
  if (!pack.enabled) throw new Error("Star pack is disabled");
  const instruction = await zkubeProgram(args.connection, args.wallet).methods
    .purchaseStars(
      args.packIndex,
      new BN(pack.stars.toString()),
      new BN(pack.price.toString()),
    )
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      economyConfig: deriveEconomyConfigPda(),
      starSalesLedger: deriveStarSalesLedgerPda(),
      playerProfile: derivePlayerProfilePda(owner),
      paymentMint: args.campaign.paymentMint,
      playerPaymentAccount:
        args.playerPaymentAccount ??
        deriveAssociatedTokenAddress(
          owner,
          args.campaign.paymentMint,
          args.campaign.paymentTokenProgram,
        ),
      teamDestination: args.campaign.teamDestination,
      rewardVault: args.campaign.rewardVault,
      treasuryDestination: args.campaign.treasuryDestination,
      tokenProgram: args.campaign.paymentTokenProgram,
      owner,
    })
    .instruction();
  return plan("Purchase Stars", args.connection, args.paymaster ?? owner, instruction);
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

function currentPackPrice(
  economy: {
    saleEnabled: boolean;
    saleStartsAt: { toString(): string };
    saleEndsAt: { toString(): string };
    salePrices: readonly { toString(): string }[];
    starPackPrices: readonly { toString(): string }[];
  },
  index: number,
  now = BigInt(Math.floor(Date.now() / 1_000)),
): bigint {
  const startsAt = BigInt(economy.saleStartsAt.toString());
  const endsAt = BigInt(economy.saleEndsAt.toString());
  const saleIsLive = economy.saleEnabled && now >= startsAt && now < endsAt;
  return BigInt(
    (saleIsLive ? economy.salePrices[index] : economy.starPackPrices[index]).toString(),
  );
}
