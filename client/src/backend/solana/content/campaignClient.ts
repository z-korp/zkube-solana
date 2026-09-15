import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import type { WalletLike } from "../session/sessionWallet.js";
import {
  derivePlayerStatePda,
} from "../pdas.js";
import { zkubeProgram } from "../runs/runPlan.js";
import {
  mapLevelRuleSnapshot,
  type ActiveRunRulesView,
  type RawLevelRuleSnapshot,
} from "@/core/runProjection.js";
import { canonicalCampaignMap, CAMPAIGN_CONTENT_VERSION, CANONICAL_CAMPAIGN_MAP_COUNT } from "@/core/campaignCatalog.js";
import {
  PLAYER_STATE_ACCOUNT_VERSION,
  PLAYER_STATE_RESERVED_BYTES,
} from "@/core/protocolVersions.generated.js";
import { coreLadderTier, initializeZkubeCore } from "@/core/zkubeCore.js";

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
  kreditBalance: bigint;
  ladderPoints: bigint;
  highestLadderTier: number;
  /** Best daily score ever recorded on a scored ranked run. */
  bestDailyScore: number;
  /** Day identifier of the most recent paid entry. */
  lastEntryDayId: number;
  /** Consecutive days carrying at least one paid entry. */
  entryStreakDays: number;
  /** Ladder border the player wears; any tier they ever reached is wearable. */
  featuredFrameTier: number;
  /** Best Daily results on the Score board, which ranks `dailyScore`. */
  scoreRecord: CompetitionRecord;
  /** Best Daily results on the Theme board, which ranks `objectiveTotal`. */
  themeRecord: CompetitionRecord;
}

export async function fetchCampaignView(args: {
  connection: Connection;
  wallet: WalletLike;
}): Promise<CampaignView | null> {
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const playerAddress = derivePlayerStatePda(owner);
  const playerInfo = await args.connection.getAccountInfo(playerAddress, "confirmed");
  const stars = playerInfo
    ? decodePlayerStateAccount(program, playerAddress, owner, playerInfo).campaignStars
    : new Array(CAMPAIGN_STAR_BYTES).fill(0);
  return campaignViewFromStars(stars);
}

/** The compiled catalog is available before any player account exists. */
export function campaignViewFromStars(stars: readonly number[]): CampaignView {
  return {
    contentVersion: CAMPAIGN_CONTENT_VERSION,
    maps: Array.from({ length: CANONICAL_CAMPAIGN_MAP_COUNT }, (_, index) => {
      const mapId = index + 1;
      const catalog = canonicalCampaignMap(CAMPAIGN_CONTENT_VERSION, mapId);
      return {
        mapId, themeId: catalog.themeId, enabled: true,
        unlocked: campaignMapUnlocked(stars, index),
        cleared: campaignMapCleared(stars, index),
        perfected: campaignMapPerfected(stars, index),
        levelStars: unpackCompactLevelStars(stars, index),
        levels: catalog.levels.map((level, levelIndex) => mapLevelRuleSnapshot({
          ...level, guardian: catalog.mapRules.guardian,
          startingRows: catalog.mapRules.startingRows,
        } as RawLevelRuleSnapshot, mapId, levelIndex + 1, "campaign")),
      };
    }),
  };
}

export async function fetchPlayerBoardDecorations(args: {
  connection: Connection;
  wallet: WalletLike;
  owners: readonly PublicKey[];
}): Promise<Map<string, { emblem: number; tier: number }>> {
  const unique = [
    ...new Map(args.owners.map((owner) => [owner.toBase58(), owner])).values(),
  ];
  if (unique.length === 0) return new Map();
  const program = zkubeProgram(args.connection, args.wallet);
  const addresses = unique.map((owner) => derivePlayerStatePda(owner));
  const infos = await args.connection.getMultipleAccountsInfo(
    addresses,
    "confirmed",
  );
  await initializeZkubeCore();
  return new Map(
    unique.flatMap((owner, index) => {
      const info = infos[index];
      if (!info) return [];
      try {
        const profile = decodePlayerStateAccount(
          program,
          addresses[index]!,
          owner,
          info,
        );
        return [
          [
            owner.toBase58(),
            {
              emblem: profile.featuredEmblem,
              tier: coreLadderTier(profile.ladderPoints),
            },
          ] as const,
        ];
      } catch {
        return [];
      }
    }),
  );
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
  scoreRecord: RawCompetitionRecord;
  themeRecord: RawCompetitionRecord;
  kreditBalance: { toString(): string } | number | bigint;
  ladderPoints: { toString(): string } | number | bigint;
  highestLadderTier: number | bigint;
  featuredFrameTier: number | bigint;
  bestDailyScore: number | bigint;
  lastEntryDayId: number | bigint;
  entryStreakDays: number | bigint;
  reserved: readonly number[];
}

function toBigint(value: { toString(): string } | number | bigint): bigint {
  const parsed = BigInt(typeof value === "bigint" ? value : value.toString());
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
 * RPC discipline in dailyClient: the owning program (via
 * assertProgramAccount), the exact account size, the Anchor discriminator (via
 * coder.decode), the exact account version, the embedded owner field, the
 * derived PDA seed, compact star bitmap length, and zeroed reserved bytes are
 * all confirmed before any field is trusted. Throws on any mismatch so callers
 * can treat a malformed account as "no state" rather than inventing profile data.
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
  const reserved = Array.from(raw.reserved, (byte) => Number(byte));
  if (
    Number(raw.version) !== PLAYER_STATE_ACCOUNT_VERSION ||
    !raw.owner.equals(owner) ||
    !address.equals(derivePlayerStatePda(owner)) ||
    campaignStars.length !== CAMPAIGN_STAR_BYTES ||
    Number(raw.highestLadderTier) > 4 ||
    Number(raw.featuredFrameTier) > Number(raw.highestLadderTier) ||
    reserved.length !== PLAYER_STATE_RESERVED_BYTES ||
    reserved.some((byte) => byte !== 0)
  ) {
    throw new Error("PlayerState relationship is invalid");
  }
  return {
    owner: raw.owner,
    version: Number(raw.version),
    campaignStars,
    featuredEmblem: Number(raw.featuredEmblem),
    lifetimePaidEntries: toBigint(raw.lifetimePaidEntries),
    kreditBalance: toBigint(raw.kreditBalance),
    ladderPoints: toBigint(raw.ladderPoints),
    highestLadderTier: Number(raw.highestLadderTier),
    featuredFrameTier: Number(raw.featuredFrameTier),
    bestDailyScore: Number(raw.bestDailyScore),
    lastEntryDayId: Number(raw.lastEntryDayId),
    entryStreakDays: Number(raw.entryStreakDays),
    scoreRecord: mapCompetitionRecord(raw.scoreRecord),
    themeRecord: mapCompetitionRecord(raw.themeRecord),
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
