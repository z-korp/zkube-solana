/**
 * DEV-ONLY fixture data for the wallet-bypass harness (see devBypass.ts).
 *
 * These builders return objects that match the real chain-view shapes exactly
 * (DailyView, WeeklyView, SeasonView, CampaignView, ConnectedPlayerValue, the
 * competitive PlayerProfile, and the player label) so the menu screens render
 * populated without any RPC or wallet. Nothing here signs, transfers, or
 * mutates chain state — it is presentation-only fixture data. The whole module
 * is tree-shaken out of production builds because every import of it lives
 * behind an `import.meta.env.DEV` guard.
 */
import { PublicKey } from "@solana/web3.js";

import { currentDailyDayId } from "@/chain/dailyClient";
import type {
  DailyLeaderboardView,
  DailyPlayerView,
  DailyView,
} from "@/chain/dailyClient";
import {
  CANONICAL_DAILY_PRESSURE,
  CANONICAL_DAILY_SCORING_RULES,
} from "@/chain/dailyRules";
import type { DailyScoringRuleView } from "@/chain/dailyRules";
import { currentWeeklyId, weekStartDay } from "@/chain/weeklyClient";
import type {
  WeeklyLeaderboardEntryView,
  WeeklyView,
} from "@/chain/weeklyClient";
import { currentSeasonId, seasonStartDay } from "@/chain/seasonClient";
import type {
  SeasonLeaderboardEntryView,
  SeasonPlayerView,
  SeasonView,
} from "@/chain/seasonClient";
import type {
  CampaignMapView,
  CampaignView,
  CompetitionRecord,
} from "@/chain/campaignClient";
import type { ActiveRunRulesView } from "@/chain/runPlan";
import type { ConnectedPlayerValue } from "@/chain/connectedPlayerContext";
import { createReadOnlyWallet } from "@/chain/readOnlyWallet";
import type { PlayerLabelView } from "@/chain/playerLabelClient";
import type { PlayerProfileResult } from "@/hooks/usePlayerProfile";

const SOL = 1_000_000_000n;
const DAY = 86_400;
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
  starThresholdModifier: 128,
  bonusType: 0,
  bonusTriggerType: 0,
  bonusThreshold: 0,
  startingCharges: 0,
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
  // A real combo rule ("3+ Line Combos") so the hero and objective read true.
  const scoringRule: DailyScoringRuleView = CANONICAL_DAILY_SCORING_RULES[2]!;

  const dailyScores = [48_210, 41_880, 37_500, 30_240, 24_110, 18_760];
  const bonusTriggers = [12, 9, 7, 5, 3, 1];
  const moves = [92, 88, 80, 74, 61, 44];
  const attempts = [3, 2, 2, 1, 1, 1];
  const leaderboard: DailyLeaderboardView[] = NAMES.map((name, index) => ({
    player: index === DEV_ROW ? DEV_PLAYER_PUBLIC_KEY : devKey(index + 1),
    playerName: name,
    runId: BigInt(1_000 + index),
    dailyScore: dailyScores[index]!,
    dailyBonusTriggers: bonusTriggers[index]!,
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
    bestDailyBonusTriggers: bonusTriggers[DEV_ROW]!,
    bestEngineScore: Math.round(dailyScores[DEV_ROW]! * 0.7),
    bestMoves: moves[DEV_ROW]!,
    bestScore: dailyScores[DEV_ROW]!,
    seasonRolledUp: false,
    activePaidRunId: 0n,
  };

  return {
    address: devKey(500),
    dayId,
    weeklyId: currentWeeklyId(now),
    seasonId: currentSeasonId(now),
    status: "open",
    mapId: 8,
    opensAt: now - HOUR,
    entriesCloseAt: now + 5 * HOUR,
    runsCloseAt,
    settlementGraceCloseAt: runsCloseAt + 30 * 60,
    recoveryDeadlineAt: runsCloseAt + HOUR,
    finalizedAt: 0,
    entryLamports: 10_000_000n,
    dailyPotLamports: 3_200_000_000n,
    followingDailyLamports: 1_860_000_000n,
    uniquePlayers: 6,
    seasonEligiblePlayers: 6,
    seasonRollups: 0,
    attemptsStarted: 9n,
    runsFinalized: 6n,
    entriesExpired: 0n,
    rulesHash: EMPTY_HASH,
    nextRunId: 1_006n,
    activeRunId: 0n,
    player,
    leaderboard,
    rules: DEV_RUN_RULES,
    scoringRule,
    pressure: CANONICAL_DAILY_PRESSURE,
    endlessThresholds: CANONICAL_DAILY_PRESSURE.thresholds,
    endlessScoreMultipliersX100: CANONICAL_DAILY_PRESSURE.scoreMultipliersX100,
  };
}

function weeklyEntry(
  seed: number,
  name: string,
  value: number,
  finalizedAt: number,
): WeeklyLeaderboardEntryView {
  return {
    player: seed === DEV_ROW ? DEV_PLAYER_PUBLIC_KEY : devKey(seed + 20),
    playerName: name,
    daily: devKey(seed + 120),
    runId: BigInt(2_000 + seed),
    value: BigInt(value),
    score: value,
    finalizedAt,
    replayHash: EMPTY_HASH,
  };
}

export function buildDevWeeklyView(): WeeklyView {
  const now = Math.floor(Date.now() / 1_000);
  const weeklyId = currentWeeklyId(now);
  const board = (values: readonly number[]) =>
    values.map((value, index) =>
      weeklyEntry(index, NAMES[index] ?? `Player_${index}`, value, now - index * 900),
    );
  const boards: WeeklyView["boards"] = [
    board([146, 128, 121, 118]),
    board([9_820, 8_640, 7_510, 6_900]),
    board([612_400, 548_900, 501_200]),
  ];
  return {
    address: devKey(600),
    weeklyId,
    qualificationStartDay: weekStartDay(weeklyId),
    status: "open",
    opensAt: now - 3 * DAY,
    closesAt: now + 4 * DAY,
    finalizedAt: 0,
    activePotLamports: 5_400_000_000n,
    followingWeeklyLamports: 2_700_000_000n,
    participants: 12,
    rulesHash: EMPTY_HASH,
    metricLabels: ["Highest Combo", "Best Single Action", "Full-Run Score"],
    boards,
    leaderboard: boards[2],
  };
}

export function buildDevSeasonView(): SeasonView {
  const now = Math.floor(Date.now() / 1_000);
  const seasonId = currentSeasonId(now);
  const points = [92, 81, 74, 63, 48, 32];
  const leaderboard: SeasonLeaderboardEntryView[] = NAMES.map((name, index) => ({
    player: index === DEV_ROW ? DEV_PLAYER_PUBLIC_KEY : devKey(index + 40),
    playerName: name,
    points: points[index]!,
    finalizedAt: now - index * 1_200,
  }));
  const player: SeasonPlayerView = {
    player: DEV_PLAYER_PUBLIC_KEY,
    points: points[DEV_ROW]!,
    resultCount: 3,
    results: [
      { dayId: currentDailyDayId(now) - 1, points: 25, rank: 3, recordedAt: now - DAY },
      { dayId: currentDailyDayId(now) - 2, points: 20, rank: 5, recordedAt: now - 2 * DAY },
      { dayId: currentDailyDayId(now) - 3, points: 18, rank: 6, recordedAt: now - 3 * DAY },
    ],
    finalCountedAt: 0,
  };
  return {
    address: devKey(700),
    seasonId,
    qualificationStartDay: seasonStartDay(seasonId),
    status: "open",
    opensAt: now - 10 * DAY,
    closesAt: now + 18 * DAY,
    finalizedAt: 0,
    activePotLamports: 7_800_000_000n,
    followingSeasonLamports: 3_100_000_000n,
    sealedDailies: 10,
    leaderboard,
    player,
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
  const dailyRecord: CompetitionRecord = {
    bestPrizeRank: 2,
    podiums: 5,
    wins: 1,
    rewardsLamports: 15n * (SOL / 10n),
  };
  const weeklyRecord: CompetitionRecord = {
    bestPrizeRank: 1,
    podiums: 3,
    wins: 2,
    rewardsLamports: 21n * (SOL / 10n),
  };
  const seasonRecord: CompetitionRecord = {
    bestPrizeRank: 3,
    podiums: 2,
    wins: 0,
    rewardsLamports: 8n * (SOL / 10n),
  };
  return {
    ...base,
    featuredEmblem: DEV_FEATURED_EMBLEM,
    lifetimePaidEntries: 42n,
    dailyRecord,
    weeklyRecord,
    seasonRecord,
    totalWins: dailyRecord.wins + weeklyRecord.wins + seasonRecord.wins,
    totalRewardsLamports:
      dailyRecord.rewardsLamports +
      weeklyRecord.rewardsLamports +
      seasonRecord.rewardsLamports,
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
