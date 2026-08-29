/**
 * DEV-ONLY fixture data for the wallet-bypass harness (see devBypass.ts).
 *
 * These builders return objects that match the real chain-view shapes exactly
 * (DailyView, CampaignView, ConnectedPlayerValue, the
 * competitive PlayerProfile, and the player label) so the menu screens render
 * populated without any RPC or wallet. Nothing here signs, transfers, or
 * mutates chain state — it is presentation-only fixture data. The whole module
 * is tree-shaken out of production builds because every import of it lives
 * behind an `import.meta.env.DEV` guard.
 */
import { PublicKey } from "@solana/web3.js";

import { currentDailyDayId } from "@/chain/dailyClient";
import type { UnclaimedRewardView } from "@/chain/dailyClient";
import type {
  DailyLeaderboardView,
  DailyPlayerView,
  DailyView,
} from "@/chain/dailyClient";
import {
  CANONICAL_DAILY_PRESSURE,
} from "@/chain/dailyRules";
import type {
  CampaignMapView,
  CampaignView,
  CompetitionRecord,
} from "@/chain/campaignClient";
import type { ActiveRunRulesView } from "@/chain/runPlan";
import type { ConnectedPlayerValue } from "@/chain/connectedPlayerContext";
import { createReadOnlyWallet } from "@/chain/readOnlyWallet";
import type { PlayerLabelView } from "@/chain/playerLabelClient";
import type { PlayerEmblemView } from "@/chain/playerStateClient";
import type { PlayerProfileResult } from "@/hooks/usePlayerProfile";

const SOL = 1_000_000_000n;
const HOUR = 3_600;

/** Deterministic, always-valid 32-byte pubkey — no on-curve requirement. */
function devKey(seed: number): PublicKey {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    bytes[index] = (seed * 31 + index * 7 + 3) & 0xff;
  }
  return new PublicKey(bytes);
}

/** The connected identity the harness renders as. */
export const DEV_PLAYER_PUBLIC_KEY = devKey(0);
export const DEV_PLAYER_NAME = "dev_player";
/** Zone 8 (Mayan) guardian, shown gold via the mastered campaign zone below. */
export const DEV_FEATURED_EMBLEM = 8;

const EMPTY_HASH = new Uint8Array(32);

const DEV_RUN_RULES: ActiveRunRulesView = {
  pointsRequired: 0,
  maxMoves: 100,
  difficulty: 3,
  primary: { kind: 0, value: 0, requiredCount: 0 },
  secondary: { kind: 0, value: 0, requiredCount: 0 },
  activeMutatorId: 0,
  passiveMutatorId: 0,
  bossId: 0,
  bonusType: 0,
  bonusTriggerType: 0,
  bonusThreshold: 0,
};

const NAMES = [
  "Aztec_Ace",
  "Jade_Serpent",
  "Cenote_King",
  DEV_PLAYER_NAME,
  "Glyph_Hunter",
  "Temple_Novice",
] as const;

/** Index of the connected dev player in the six-strong boards → rank 4. */
const DEV_ROW = 3;

export function buildDevDailyView(): DailyView {
  const now = Math.floor(Date.now() / 1_000);
  const dayId = currentDailyDayId(now);
  const runsCloseAt = dayId * 86_400 + 23 * 3_600 + 59 * 60;
  const dailyTheme = { kind: 3, value: 3 } as const;

  const dailyScores = [48_210, 41_880, 37_500, 30_240, 24_110, 18_760];
  const bonusTriggers = [12, 9, 7, 5, 3, 1];
  const moves = [92, 88, 80, 74, 61, 44];
  const attempts = [3, 2, 2, 1, 1, 1];
  const leaderboard: DailyLeaderboardView[] = NAMES.map((name, index) => ({
    player: index === DEV_ROW ? DEV_PLAYER_PUBLIC_KEY : devKey(index + 1),
    playerName: name,
    runId: BigInt(1_000 + index),
    dailyScore: dailyScores[index]!,
    objectiveTotal: BigInt(bonusTriggers[index]! * 1_000),
    engineScore: Math.round(dailyScores[index]! * 0.7),
    moves: moves[index]!,
    finalizedAttempts: attempts[index]!,
    score: dailyScores[index]!,
    submittedAt: now - (index + 1) * 600,
    replayHash: EMPTY_HASH,
  }));

  const player: DailyPlayerView = {
    attempts: 1,
    paidAttempts: 1,
    finalizedAttempts: 1,
    bestRunId: 1_003n,
    bestDailyScore: dailyScores[DEV_ROW]!,
    bestEngineScore: Math.round(dailyScores[DEV_ROW]! * 0.7),
    bestMoves: moves[DEV_ROW]!,
    bestScore: dailyScores[DEV_ROW]!,
    activePaidRunId: 0n,
  };

  return {
    address: devKey(500),
    dayId,
    followingDayId: dayId + 1,
    status: "open",
    mapId: 8,
    opensAt: now - HOUR,
    runsCloseAt,
    settlementGraceCloseAt: runsCloseAt + 30 * 60,
    recoveryDeadlineAt: runsCloseAt + HOUR,
    finalizedAt: 0,
    entryLamports: 10_000_000n,
    dailyPotLamports: 3_200_000_000n,
    followingDailyLamports: 1_860_000_000n,
    kreditBalance: 3n,
    uniquePlayers: 6,
    attemptsStarted: 9n,
    runsFinalized: 6n,
    entriesExpired: 0n,
    rulesHash: EMPTY_HASH,
    nextRunId: 1_006n,
    activeRunId: 0n,
    player,
    leaderboard,
    themeLeaderboard: [...leaderboard].sort((left, right) =>
      Number(right.objectiveTotal - left.objectiveTotal)),
    scoreQualifiedPlayers: leaderboard.length,
    themeQualifiedPlayers: leaderboard.length,
    rules: DEV_RUN_RULES,
    dailyTheme,
    pressure: CANONICAL_DAILY_PRESSURE,
    endlessThresholds: CANONICAL_DAILY_PRESSURE.thresholds,
    endlessScoreMultipliersX100: CANONICAL_DAILY_PRESSURE.scoreMultipliersX100,
  };
}

/** Ten-length level-star row summing to `total`, boss level starred if cleared. */
function levelStars(total: number, clearedBoss: boolean): number[] {
  const stars = Array<number>(10).fill(0);
  const order = clearedBoss
    ? [9, 0, 1, 2, 3, 4, 5, 6, 7, 8]
    : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  let remaining = total;
  for (const index of order) {
    if (remaining <= 0) break;
    const value = Math.min(3, remaining);
    stars[index] = value;
    remaining -= value;
  }
  return stars;
}

/**
 * Emblem and border projection for the fixture board, so the leaderboard's
 * avatars are reviewable under the bypass.
 *
 * Every wallet on a real board has a PlayerState — it is created by their first
 * entry — so an empty avatar slot is a loading state, not a steady one. Without
 * this the dev board showed six blanks and the layout could not be judged.
 */
export function buildDevLeaderboardEmblems(): PlayerEmblemView[] {
  // Deliberately mixed: five ranks and a guardian each, so the row reads
  // differently at every position the way a live board would.
  const emblems = [4, 2, 9, DEV_FEATURED_EMBLEM, 7, 1];
  const tiers = [4, 3, 1, 2, 0, 2];
  return NAMES.map((_, index) => ({
    address: index === DEV_ROW ? DEV_PLAYER_PUBLIC_KEY : devKey(index + 1),
    featuredEmblem: emblems[index]!,
    totalStars: 300 - index * 40,
    highestLadderTier: tiers[index]!,
    featuredFrameTier: tiers[index]!,
  }));
}

/**
 * A reward waiting to be collected, so the lobby's collect band is reviewable
 * under the bypass. Folds away in production builds.
 */
export function devUnclaimedRewards(): UnclaimedRewardView[] {
  const dayId = currentDailyDayId();
  return [
    {
      dayId: dayId - 1,
      board: "score",
      position: 1,
      rank: 2,
      amountLamports: 653n * (SOL / 1_000n),
      expiresAt: (dayId + 29) * 86_400,
    },
  ];
}

export function buildDevCampaignView(): CampaignView {
  const specs: {
    total: number;
    unlocked: boolean;
    cleared: boolean;
    perfected: boolean;
  }[] = [
    { total: 30, unlocked: true, cleared: true, perfected: true },
    { total: 24, unlocked: true, cleared: true, perfected: false },
    { total: 15, unlocked: true, cleared: true, perfected: false },
    { total: 8, unlocked: true, cleared: false, perfected: false },
    { total: 3, unlocked: true, cleared: false, perfected: false },
    { total: 0, unlocked: false, cleared: false, perfected: false },
    { total: 0, unlocked: false, cleared: false, perfected: false },
    // Zone 8 (Mayan) mastered → the featured guardian emblem renders gold.
    { total: 30, unlocked: true, cleared: true, perfected: true },
    { total: 0, unlocked: false, cleared: false, perfected: false },
    { total: 0, unlocked: false, cleared: false, perfected: false },
  ];
  const maps: CampaignMapView[] = specs.map((spec, index) => ({
    mapId: index + 1,
    themeId: index + 1,
    enabled: true,
    unlocked: spec.unlocked,
    cleared: spec.cleared,
    perfected: spec.perfected,
    levelStars: levelStars(spec.total, spec.cleared),
    levels: [],
  }));
  return { contentVersion: 1, maps };
}

export function buildDevConnectedPlayer(): ConnectedPlayerValue {
  const publicKey = DEV_PLAYER_PUBLIC_KEY;
  const readOnlyWallet = createReadOnlyWallet(publicKey);
  return {
    connectors: [],
    connectionStatus: "connected",
    connector: null,
    publicKey,
    // A non-signing wallet keeps the CTA enabled without ever authorizing a
    // transfer; the harness stubs every action before a signature is needed.
    wallet: readOnlyWallet,
    readOnlyWallet,
    session: null,
    sessionStatus: "ready",
    balanceLamports: 2 * Number(SOL) + 500_000_000,
    balanceLoading: false,
    error: null,
    connectAndEnable: async () => {},
    enable: async () => "",
    renew: async () => "",
    disconnect: async () => {},
    refreshBalance: async () => {},
    requireSession: () => {
      throw new Error("Dev bypass has no device session");
    },
    markSessionNeedsRenewal: () => {},
  };
}

/**
 * Override for `usePlayerProfile` under the bypass. Keeps the live `refresh`
 * and the campaign-derived `totalStars` from `base`, overriding only the
 * paid-entry / prize record fields the RPC read cannot populate here.
 */
export function applyDevPlayerProfile(
  base: PlayerProfileResult,
): PlayerProfileResult {
  // Deliberately lopsided: a Theme specialist reads very differently from a
  // Score one, and the profile only says so if the fixture lets it.
  const scoreRecord: CompetitionRecord = {
    bestPrizeRank: 7,
    podiums: 0,
    wins: 0,
    rewardsLamports: 4n * (SOL / 10n),
  };
  const themeRecord: CompetitionRecord = {
    bestPrizeRank: 2,
    podiums: 5,
    wins: 1,
    rewardsLamports: 11n * (SOL / 10n),
  };
  return {
    ...base,
    featuredEmblem: DEV_FEATURED_EMBLEM,
    lifetimePaidEntries: 42n,
    scoreRecord,
    themeRecord,
    totalWins: scoreRecord.wins + themeRecord.wins,
    totalRewardsLamports:
      scoreRecord.rewardsLamports + themeRecord.rewardsLamports,
    // Mid-Jade: far enough in to show a partly filled bar rather than an
    // empty or complete one.
    ladderPoints: 14_000n,
    highestLadderTier: 2,
    featuredFrameTier: 2,
    bestDailyScore: 18_940,
    entryStreakDays: 6,
    loading: false,
    error: null,
  };
}

/** Override for `usePlayerLabelController` so the profile shows "dev_player". */
export function applyDevPlayerLabel<
  T extends {
    label: PlayerLabelView | null;
    loading: boolean;
    error: string | null;
  },
>(base: T): T {
  return {
    ...base,
    label: {
      address: DEV_PLAYER_PUBLIC_KEY,
      owner: DEV_PLAYER_PUBLIC_KEY,
      displayName: DEV_PLAYER_NAME,
    },
    loading: false,
    error: null,
  };
}
