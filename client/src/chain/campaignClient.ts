import type BN from "bn.js";
import {
  PublicKey,
  Transaction,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";
import type { WalletLike } from "./sessionWallet.js";
import {
  deriveEconomyConfigPda,
  deriveMapCatalogPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
} from "./pdas.js";
import {
  mapLevelRuleSnapshot,
  zkubeProgram,
  type ActiveRunRulesView,
  type RawLevelRuleSnapshot,
  type TransactionPlan,
} from "./runPlan.js";
import { MAX_CAMPAIGN_MAPS } from "./campaignCatalog.js";

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
  maps: CampaignMapView[];
}

export async function fetchCampaignView(args: {
  connection: Connection;
  wallet: WalletLike;
}): Promise<CampaignView | null> {
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const protocolAddress = deriveProtocolConfigPda();
  const playerAddress = derivePlayerStatePda(owner);
  const economyAddress = deriveEconomyConfigPda();
  const [protocolInfo, playerInfo, economyInfo] =
    await args.connection.getMultipleAccountsInfo(
      [protocolAddress, playerAddress, economyAddress],
      "confirmed",
    );
  if (!protocolInfo || !playerInfo || !economyInfo)
    return null;
  assertProgramAccount(
    protocolInfo,
    program.programId,
    program.account.protocolConfig.size,
    "ProtocolConfig",
  );
  assertProgramAccount(
    playerInfo,
    program.programId,
    program.account.playerState.size,
    "PlayerState",
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
    ReturnType<typeof program.account.playerState.fetch>
  >;
  type EconomyAccount = Awaited<
    ReturnType<typeof program.account.economyConfig.fetch>
  >;
  const protocol = program.coder.accounts.decode(
    "protocolConfig",
    protocolInfo.data,
  ) as unknown as ProtocolAccount;
  const player = program.coder.accounts.decode(
    "playerState",
    playerInfo.data,
  ) as unknown as PlayerAccount;
  const economy = program.coder.accounts.decode(
    "economyConfig",
    economyInfo.data,
  ) as unknown as EconomyAccount;
  if (
    Number(protocol.version) !== 1 ||
    Number(player.version) !== 1 ||
    !player.owner.equals(owner) ||
    player.levelStars.length !== 80 ||
    Number(economy.version) !== 1 ||
    !economy.protocol.equals(protocolAddress) ||
    !economy.active
  ) {
    return null;
  }
  const contentVersion = Number(protocol.contentVersion);
  const campaignMapCount = Number(protocol.campaignMapCount);
  if (
    !Number.isInteger(campaignMapCount) ||
    campaignMapCount < 1 ||
    campaignMapCount > MAX_CAMPAIGN_MAPS
  )
    return null;
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
  if (
    !catalogs.every(
      (catalog, index) =>
        catalog &&
        Number(catalog.version) === 1 &&
        Number(catalog.contentVersion) === contentVersion &&
        Number(catalog.mapId) === index + 1 &&
        catalog.levels.length === 10,
    )
  )
    return null;
  const maps = catalogs.map((catalog, index) => {
    if (!catalog) {
      throw new Error("active campaign catalog disappeared during decode");
    }
    const mapId = index + 1;
    return {
      mapId,
      themeId: Number(catalog.themeId),
      enabled: Boolean(catalog.enabled),
      unlocked: hasMapFlag(player.unlockedMaps, mapId),
      purchased: hasMapFlag(player.purchasedMaps, mapId),
      cleared: hasMapFlag(player.clearedMaps, mapId),
      perfected: hasMapFlag(player.perfectedMaps, mapId),
      starCost: mapId > 1 ? BigInt(economy.zoneUnlockStars.toString()) : 0n,
      levelStars: unpackCompactLevelStars(player.levelStars, index),
      levels: catalog.levels.map((level, levelIndex) =>
        mapLevelRuleSnapshot({
          ...level,
          ...catalog.mapRules,
          bossId: levelIndex === 9 ? catalog.mapRules.bossId : 0,
        } as RawLevelRuleSnapshot),
      ),
    };
  });
  return {
    economyVersion: 2,
    contentVersion,
    starsBalance: BigInt(player.starsBalance.toString()),
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
  return Array.from(
    { length: 10 },
    (_, level) => (packedStars >>> (level * 2)) & 0x3,
  );
}

export function unpackCompactLevelStars(
  bytes: readonly number[],
  mapIndex: number,
): number[] {
  if (bytes.length !== 80 || mapIndex < 0 || mapIndex >= MAX_CAMPAIGN_MAPS) {
    throw new Error("Campaign level-star bitmap has an invalid layout");
  }
  return Array.from({ length: 10 }, (_, level) => {
    const bit = (mapIndex * 10 + level) * 2;
    return ((bytes[bit >> 3] ?? 0) >> (bit & 7)) & 0x3;
  });
}

export async function buildUnlockMapWithStarsPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey | null;
  contentVersion: number;
  mapId: number;
}): Promise<TransactionPlan> {
  const owner = args.ownerAuthority;
  const program = zkubeProgram(args.connection, args.wallet);
  const accounts = {
    protocol: deriveProtocolConfigPda(),
    playerState: derivePlayerStatePda(owner),
    mapCatalog: deriveMapCatalogPda(args.contentVersion, args.mapId),
    ownerAuthority: owner,
    sessionToken: args.sessionToken,
    actor: args.wallet.publicKey,
  };
  const instruction = await program.methods
    .unlockZone()
    .accountsPartial({
      protocol: accounts.protocol,
      economyConfig: deriveEconomyConfigPda(),
      playerState: accounts.playerState,
      mapCatalog: accounts.mapCatalog,
      ownerAuthority: accounts.ownerAuthority,
      sessionToken: accounts.sessionToken,
      actor: accounts.actor,
    })
    .instruction();
  return plan(
    "Unlock map with Stars",
    args.connection,
    args.wallet.publicKey,
    instruction,
  );
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
