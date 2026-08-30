// @vitest-environment node

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  coreRankPayoutPlan,
  initializeZkubeCore,
} from "@/core/zkubeCore";
import { buildDevDailyView } from "@/dev/fixtures";
import {
  BoardState,
  CampaignCatalog,
  DailyContent,
  TierTable,
} from "../../views";
import type { CampaignView } from "./campaignClient";
import {
  projectSolanaBoards,
  projectSolanaCatalog,
  projectSolanaDailyContent,
  projectSolanaTierTable,
} from "./SolanaContentBoardsLive";

describe("Solana Content and Boards projections", () => {
  it("solana_backend_projects_every_view_field", async () => {
    await initializeZkubeCore();
    const daily = buildDevDailyView();
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
    expect(tiers.blockWeights).toHaveLength(8);
  });
});

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
