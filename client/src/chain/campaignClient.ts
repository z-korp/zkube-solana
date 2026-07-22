import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
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
import { CANONICAL_CAMPAIGN_MAP_COUNT } from "./campaignCatalog.js";
import { PROTOCOL_ACCOUNT_VERSION } from "./protocolVersions.generated.js";

export const CAMPAIGN_LEVEL_COUNT = 100;
export const CAMPAIGN_STAR_BYTES = 25;
export const CAMPAIGN_LEVELS_PER_MAP = 10;

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
  if (Number(protocol.version) !== PROTOCOL_ACCOUNT_VERSION) {
    return null;
  }
  const rawPlayer = player as unknown as {
    version: number;
    owner: PublicKey;
    campaignStars: readonly number[];
  } | null;
  if (
    rawPlayer &&
    (Number(rawPlayer.version) !== PROTOCOL_ACCOUNT_VERSION ||
      !rawPlayer.owner.equals(owner) ||
      rawPlayer.campaignStars.length !== CAMPAIGN_STAR_BYTES)
  ) {
    return null;
  }
  const contentVersion = Number(protocol.contentVersion);
  const campaignMapCount = Number(protocol.campaignMapCount);
  if (
    !Number.isInteger(campaignMapCount) ||
    campaignMapCount !== CANONICAL_CAMPAIGN_MAP_COUNT
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
        Number(catalog.version) === PROTOCOL_ACCOUNT_VERSION &&
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
      unlocked: rawPlayer
        ? campaignMapUnlocked(rawPlayer.campaignStars, index)
        : mapId === 1,
      cleared: rawPlayer
        ? campaignMapCleared(rawPlayer.campaignStars, index)
        : false,
      perfected: rawPlayer
        ? campaignMapPerfected(rawPlayer.campaignStars, index)
        : false,
      levelStars: rawPlayer
        ? unpackCompactLevelStars(rawPlayer.campaignStars, index)
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

export function unpackCompactLevelStars(
  bytes: readonly number[],
  mapIndex: number,
): number[] {
  if (
    bytes.length !== CAMPAIGN_STAR_BYTES ||
    mapIndex < 0 ||
    mapIndex >= CANONICAL_CAMPAIGN_MAP_COUNT
  ) {
    throw new Error("Campaign level-star bitmap has an invalid layout");
  }
  return Array.from({ length: CAMPAIGN_LEVELS_PER_MAP }, (_, level) => {
    const bit = (mapIndex * CAMPAIGN_LEVELS_PER_MAP + level) * 2;
    return ((bytes[bit >> 3] ?? 0) >> (bit & 7)) & 0x3;
  });
}

export function campaignMapUnlocked(
  bytes: readonly number[],
  mapIndex: number,
): boolean {
  if (mapIndex === 0) return true;
  if (mapIndex < 0 || mapIndex >= CANONICAL_CAMPAIGN_MAP_COUNT) return false;
  return campaignLevelStars(bytes, mapIndex * CAMPAIGN_LEVELS_PER_MAP - 1) > 0;
}

export function campaignMapCleared(
  bytes: readonly number[],
  mapIndex: number,
): boolean {
  return (
    mapIndex >= 0 &&
    mapIndex < CANONICAL_CAMPAIGN_MAP_COUNT &&
    campaignLevelStars(
      bytes,
      mapIndex * CAMPAIGN_LEVELS_PER_MAP + CAMPAIGN_LEVELS_PER_MAP - 1,
    ) > 0
  );
}

export function campaignMapPerfected(
  bytes: readonly number[],
  mapIndex: number,
): boolean {
  if (mapIndex < 0 || mapIndex >= CANONICAL_CAMPAIGN_MAP_COUNT) return false;
  return unpackCompactLevelStars(bytes, mapIndex).every((stars) => stars === 3);
}

export function campaignTotalStars(bytes: readonly number[]): number {
  assertCampaignStarLayout(bytes);
  return Array.from({ length: CAMPAIGN_LEVEL_COUNT }, (_, levelIndex) =>
    campaignLevelStars(bytes, levelIndex),
  ).reduce((total, stars) => total + stars, 0);
}

function campaignLevelStars(
  bytes: readonly number[],
  levelIndex: number,
): number {
  assertCampaignStarLayout(bytes);
  if (levelIndex < 0 || levelIndex >= CAMPAIGN_LEVEL_COUNT) return 0;
  const bit = levelIndex * 2;
  return ((bytes[bit >> 3] ?? 0) >> (bit & 7)) & 0x3;
}

function assertCampaignStarLayout(bytes: readonly number[]): void {
  if (bytes.length !== CAMPAIGN_STAR_BYTES) {
    throw new Error("Campaign level-star bitmap has an invalid layout");
  }
}
