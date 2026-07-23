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
import {
  PLAYER_STATE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION,
} from "./protocolVersions.generated.js";

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

/** Per-period Arcade prize record mirrored from PlayerState.competitionRecord. */
export interface CompetitionRecord {
  /** Zero means no payout-bearing rank yet. */
  bestPrizeRank: number;
  podiums: number;
  wins: number;
  rewardsLamports: bigint;
}

/**
 * Fully decoded, relationship-verified PlayerState. This is the single
 * authoritative projection of the on-chain player account; Campaign,
 * competitive-profile, emblem, and leaderboard reads all share this decoder so
 * the untrusted-RPC validation lives in exactly one place.
 */
export interface PlayerStateView {
  owner: PublicKey;
  version: number;
  campaignStars: number[];
  /** Zero selects the strongest currently unlocked emblem automatically. */
  featuredEmblem: number;
  lifetimePaidEntries: bigint;
  dailyRecord: CompetitionRecord;
  weeklyRecord: CompetitionRecord;
  seasonRecord: CompetitionRecord;
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

  type ProtocolAccount = Awaited<
    ReturnType<typeof program.account.protocolConfig.fetch>
  >;
  const protocol = program.coder.accounts.decode(
    "protocolConfig",
    protocolInfo.data,
  ) as unknown as ProtocolAccount;
  if (Number(protocol.version) !== PROTOCOL_ACCOUNT_VERSION) {
    return null;
  }
  let playerView: PlayerStateView | null = null;
  if (playerInfo) {
    try {
      playerView = decodePlayerStateAccount(
        program,
        playerAddress,
        owner,
        playerInfo,
      );
    } catch {
      // Untrusted RPC: a malformed PlayerState never fabricates progression.
      return null;
    }
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
      unlocked: playerView
        ? campaignMapUnlocked(playerView.campaignStars, index)
        : mapId === 1,
      cleared: playerView
        ? campaignMapCleared(playerView.campaignStars, index)
        : false,
      perfected: playerView
        ? campaignMapPerfected(playerView.campaignStars, index)
        : false,
      levelStars: playerView
        ? unpackCompactLevelStars(playerView.campaignStars, index)
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

interface RawCompetitionRecord {
  bestPrizeRank: number | bigint;
  podiums: number | bigint;
  wins: number | bigint;
  rewardsLamports: { toString(): string } | number | bigint;
}

interface RawPlayerState {
  version: number;
  owner: PublicKey;
  campaignStars: readonly number[];
  featuredEmblem: number;
  lifetimePaidEntries: { toString(): string } | number | bigint;
  dailyRecord: RawCompetitionRecord;
  weeklyRecord: RawCompetitionRecord;
  seasonRecord: RawCompetitionRecord;
}

function toBigint(value: { toString(): string } | number | bigint): bigint {
  const parsed = BigInt(
    typeof value === "bigint" ? value : value.toString(),
  );
  if (parsed < 0n) throw new Error("PlayerState carried a negative u64");
  return parsed;
}

function mapCompetitionRecord(raw: RawCompetitionRecord): CompetitionRecord {
  return {
    bestPrizeRank: Number(raw.bestPrizeRank),
    podiums: Number(raw.podiums),
    wins: Number(raw.wins),
    rewardsLamports: toBigint(raw.rewardsLamports),
  };
}

/**
 * Decode and relationship-verify a PlayerState account. Mirrors the untrusted
 * RPC discipline in dailyClient/weeklyClient: the owning program (via
 * assertProgramAccount), the exact account size, the Anchor discriminator (via
 * coder.decode), the account version, the embedded owner field, the derived
 * PDA seed, and the compact star bitmap length are all confirmed before any
 * field is trusted. Throws on any mismatch so callers can treat a malformed
 * account as "no state" rather than inventing profile data.
 */
export function decodePlayerStateAccount(
  program: ReturnType<typeof zkubeProgram>,
  address: PublicKey,
  owner: PublicKey,
  info: AccountInfo<Buffer>,
): PlayerStateView {
  assertProgramAccount(
    info,
    program.programId,
    program.account.playerState.size,
    "PlayerState",
  );
  const raw = program.coder.accounts.decode(
    "playerState",
    info.data,
  ) as unknown as RawPlayerState;
  const campaignStars = Array.from(raw.campaignStars, (byte) => Number(byte));
  if (
    (Number(raw.version) !== PROTOCOL_ACCOUNT_VERSION &&
      Number(raw.version) !== PLAYER_STATE_ACCOUNT_VERSION) ||
    !raw.owner.equals(owner) ||
    !address.equals(derivePlayerStatePda(owner)) ||
    campaignStars.length !== CAMPAIGN_STAR_BYTES
  ) {
    throw new Error("PlayerState relationship is invalid");
  }
  return {
    owner: raw.owner,
    version: Number(raw.version),
    campaignStars,
    featuredEmblem: Number(raw.featuredEmblem),
    lifetimePaidEntries: toBigint(raw.lifetimePaidEntries),
    dailyRecord: mapCompetitionRecord(raw.dailyRecord),
    weeklyRecord: mapCompetitionRecord(raw.weeklyRecord),
    seasonRecord: mapCompetitionRecord(raw.seasonRecord),
  };
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
