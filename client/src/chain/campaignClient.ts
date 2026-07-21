import type BN from "bn.js";
import {
  PublicKey,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";
import type { WalletLike } from "./sessionWallet.js";
import {
  deriveMapCatalogPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
} from "./pdas.js";
import {
  mapLevelRuleSnapshot,
  zkubeProgram,
  type ActiveRunRulesView,
  type RawLevelRuleSnapshot,
} from "./runPlan.js";
import { MAX_CAMPAIGN_MAPS } from "./campaignCatalog.js";

export interface CampaignMapView {
  mapId: number;
  themeId: number;
  enabled: boolean;
  unlocked: boolean;
  cleared: boolean;
  perfected: boolean;
  levelStars: number[];
  levels: ActiveRunRulesView[];
}

export interface CampaignView {
  contentVersion: number;
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
  const [protocolInfo, playerInfo] =
    await args.connection.getMultipleAccountsInfo(
      [protocolAddress, playerAddress],
      "confirmed",
    );
  if (!protocolInfo) return null;
  assertProgramAccount(
    protocolInfo,
    program.programId,
    program.account.protocolConfig.size,
    "ProtocolConfig",
  );
  if (playerInfo) {
    assertProgramAccount(
      playerInfo,
      program.programId,
      program.account.playerState.size,
      "PlayerState",
    );
  }

  type ProtocolAccount = Awaited<
    ReturnType<typeof program.account.protocolConfig.fetch>
  >;
  type PlayerAccount = Awaited<
    ReturnType<typeof program.account.playerState.fetch>
  >;
  const protocol = program.coder.accounts.decode(
    "protocolConfig",
    protocolInfo.data,
  ) as unknown as ProtocolAccount;
  const player = playerInfo
    ? (program.coder.accounts.decode(
        "playerState",
        playerInfo.data,
      ) as unknown as PlayerAccount)
    : null;
  if (Number(protocol.version) !== 3) {
    return null;
  }
  if (
    player &&
    (Number(player.version) !== 3 ||
      !player.owner.equals(owner) ||
      player.levelStars.length !== 80)
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
        Number(catalog.version) === 3 &&
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
      unlocked: player ? hasMapFlag(player.unlockedMaps, mapId) : mapId === 1,
      cleared: player ? hasMapFlag(player.clearedMaps, mapId) : false,
      perfected: player ? hasMapFlag(player.perfectedMaps, mapId) : false,
      levelStars: player
        ? unpackCompactLevelStars(player.levelStars, index)
        : Array.from({ length: 10 }, () => 0),
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
    contentVersion,
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

function hasMapFlag(bitmap: number | bigint | BN, mapId: number): boolean {
  if (!Number.isInteger(mapId) || mapId < 1 || mapId > MAX_CAMPAIGN_MAPS) {
    return false;
  }
  const value = BigInt(bitmap.toString());
  return (value & (1n << BigInt(mapId - 1))) !== 0n;
}

function unpackCompactLevelStars(
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
