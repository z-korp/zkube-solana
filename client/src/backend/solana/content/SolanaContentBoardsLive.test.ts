// @vitest-environment node

import { Schema } from "effect";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  coreRankPayoutPlan,
  initializeZkubeCore,
} from "@/core/zkubeCore";
import { CANONICAL_DAILY_PRESSURE } from "@/core/dailyRules";
import {
  BoardState,
  CampaignCatalog,
  DailyContent,
  TierTable,
} from "../../views";
import type { CampaignView } from "./campaignClient";
import type { DailyView } from "./dailyClient";
import {
  projectSolanaBoards,
  projectSolanaCatalog,
  projectSolanaDailyContent,
  projectSolanaTierTable,
} from "./SolanaContentBoardsLive";

describe("Solana Content and Boards projections", () => {
  it("solana_backend_projects_every_view_field", async () => {
    await initializeZkubeCore();
    const daily = dailyFixture();
    daily.dailyPotLamports = 100_000_000n;
    daily.themeQualifiedPlayers = 1;
    const plan = coreRankPayoutPlan(50_000_000n, 1);
    const boards = projectSolanaBoards({
      daily,
      accounts: [
        {
          kind: "score",
          payoutCount: 1,
          denominator: plan.denominator,
          poolLamports: 50_000_000n,
          sealedAt: daily.runsCloseAt,
          sealed: true,
          rows: [daily.leaderboard[0]!],
        },
        {
          kind: "theme",
          payoutCount: 1,
          denominator: plan.denominator,
          poolLamports: 50_000_000n,
          sealedAt: daily.runsCloseAt,
          sealed: true,
          rows: [daily.themeLeaderboard[0]!],
        },
      ],
      owner: daily.leaderboard[0]!.player,
      nowUnix: daily.runsCloseAt + 1,
      decorations: new Map([
        [
          daily.leaderboard[0]!.player.toBase58(),
          { emblem: 8, tier: 3 },
        ],
      ]),
    });
    const today = projectSolanaDailyContent(daily, false);
    const catalog = projectSolanaCatalog(campaignFixture());
    const tiers = projectSolanaTierTable();

    expect(Schema.decodeUnknownSync(DailyContent)(today)).toEqual(today);
    expect(Schema.decodeUnknownSync(CampaignCatalog)(catalog)).toEqual(catalog);
    expect(Schema.decodeUnknownSync(TierTable)(tiers)).toEqual(tiers);
    for (const board of boards) {
      expect(Schema.decodeUnknownSync(BoardState)(board)).toEqual(board);
      expect(Object.keys(board).sort()).toEqual(
        ["dayId", "kind", "potLamports", "rows", "status", "yourRow"].sort(),
      );
      expect(Object.keys(board.rows[0]!).sort()).toEqual(
        [
          "address",
          "emblem",
          "label",
          "metric",
          "payoutLamports",
          "rank",
          "tier",
        ].sort(),
      );
    }
    expect(Object.keys(today).sort()).toEqual(
      [
        "dayId",
        "freezesAt",
        "objective",
        "opensAt",
        "realm",
        "startingHeight",
        "suspended",
      ].sort(),
    );
    expect(catalog.realms).toHaveLength(10);
    expect(
      catalog.realms.every((realm) => realm.locked !== "purchase"),
    ).toBe(true);
    expect(tiers.blockWeights).toHaveLength(8);
  });
});

function dailyFixture(): DailyView {
  const player = Keypair.generate().publicKey;
  const row = {
    player,
    playerName: "Player",
    runId: 1n,
    dailyScore: 42,
    objectiveTotal: 12n,
    engineScore: 30,
    moves: 8,
    finalizedAttempts: 1,
    score: 42,
    submittedAt: 1_000,
    replayHash: new Uint8Array(32),
  };
  return {
    address: Keypair.generate().publicKey,
    dayId: 1,
    followingDayId: 2,
    status: "finalized",
    mapId: 1,
    opensAt: 0,
    runsCloseAt: 1_000,
    settlementGraceCloseAt: 1_100,
    recoveryDeadlineAt: 1_100,
    finalizedAt: 1_000,
    entryLamports: 10_000_000n,
    dailyPotLamports: 100_000_000n,
    followingDailyLamports: 0n,
    kreditBalance: 1n,
    uniquePlayers: 1,
    attemptsStarted: 1n,
    runsFinalized: 1n,
    entriesExpired: 0n,
    rulesHash: new Uint8Array(32),
    nextRunId: 2n,
    activeRunId: 0n,
    player: null,
    leaderboard: [row],
    themeLeaderboard: [row],
    scoreQualifiedPlayers: 1,
    themeQualifiedPlayers: 1,
    rules: {
      pointsRequired: 0,
      maxMoves: CANONICAL_DAILY_PRESSURE.maxMoves,
      difficulty: 0,
      primary: { kind: 0, value: 0, requiredCount: 0 },
      secondary: { kind: 0, value: 0, requiredCount: 0 },
      activeMutatorId: 1,
      bossId: 0,
      guardian: { bonus: 1, trigger: 1, threshold: 2 },
      startingRows: 4,
    },
    dailyTheme: { kind: 1, value: 2 },
    pressure: CANONICAL_DAILY_PRESSURE,
  };
}

function campaignFixture(): CampaignView {
  return {
    contentVersion: 3,
    maps: Array.from({ length: 10 }, (_, mapIndex) => ({
      mapId: mapIndex + 1,
      themeId: mapIndex + 1,
      enabled: true,
      unlocked: true,
      cleared: false,
      perfected: false,
      levelStars: Array<number>(10).fill(0),
      levels: Array.from({ length: 10 }, (_, levelIndex) => ({
        pointsRequired: 10 + levelIndex,
        maxMoves: 20 + levelIndex,
        difficulty: Math.min(7, levelIndex),
        primary: { kind: 3, value: 0, requiredCount: 2 },
        secondary: { kind: 10, value: 2, requiredCount: 1 },
        activeMutatorId: 21 + mapIndex * 2,
        bossId: levelIndex === 9 ? mapIndex + 1 : 0,
        guardian: { bonus: 1, trigger: 1, threshold: 2 },
        startingRows: 4,
      })),
    })),
  };
}
