import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import type { CampaignMapView } from "@/chain/campaignClient";
import type {
  AchievementProgressView,
  QuestProgressView,
} from "@/chain/progressClient";
import { projectAchievements } from "./useAchievements";
import { projectDailyLeaderboard } from "./useDailyLeaderboard";
import { campaignBestLevel } from "./usePlayerMeta";
import { projectQuests } from "./useQuests";

describe("progress projections", () => {
  it("uses authoritative achievement thresholds and XP", () => {
    const entries: AchievementProgressView[] = Array.from(
      { length: 12 },
      (_, index) => ({
        index,
        metric: 0,
        progress: index === 8 ? 3n : 0n,
        threshold: index === 8 ? 3n : 1n,
        xpReward: index === 8 ? 333 : 1,
        claimed: false,
        claimable: index === 8,
      }),
    );
    expect(projectAchievements(entries)[8]).toMatchObject({
      target: 3,
      xp: 333,
      progress: 3,
      completed: true,
      claimable: true,
    });
  });

  it("uses authoritative quest thresholds, rewards, and activity", () => {
    const entry: QuestProgressView = {
      index: 0,
      metric: 1,
      blockSize: null,
      cadence: "daily",
      progress: 6,
      threshold: 7,
      xpReward: 200,
      starReward: 2n,
      active: true,
      claimed: false,
      claimable: false,
    };
    expect(projectQuests([entry], 86_400)[0]).toMatchObject({
      target: 7,
      xpReward: 200,
      starReward: 2,
      progress: 6,
      active: true,
    });

    const weekly = {
      ...entry,
      index: 10,
      cadence: "weekly" as const,
      xpReward: 500,
      starReward: 5n,
    };
    const entries = Array.from({ length: 11 }, (_, index) =>
      index === 10 ? weekly : { ...entry, index },
    );
    expect(projectQuests(entries, 86_400)[10]).toMatchObject({
      xpReward: 500,
      starReward: 5,
    });

    const blockEntries = Array.from({ length: 8 }, (_, index) => ({
      ...entry,
      index,
      metric: index === 7 ? 14 : entry.metric,
      blockSize: index === 7 ? 4 : null,
      threshold: index === 7 ? 6 : entry.threshold,
    }));
    expect(projectQuests(blockEntries, 2 * 86_400)[7]).toMatchObject({
      blockSize: 4,
      target: 6,
      description: "Destroy 6 size-4 blocks",
    });
  });

  it("derives the highest global campaign level from map and level", () => {
    const map = (
      mapId: number,
      stars: number[],
      cleared = false,
    ): CampaignMapView => ({
      mapId,
      themeId: mapId,
      enabled: true,
      unlocked: true,
      purchased: false,
      cleared,
      perfected: false,
      starCost: 0n,
      levelStars: stars,
      levels: [],
    });
    expect(
      campaignBestLevel([
        map(1, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3], true),
        map(3, [2, 1, 0, 0, 0, 0, 0, 0, 0, 0]),
      ]),
    ).toBe(22);
  });

  it("keeps score order and case-sensitive base58 identity", () => {
    const player = Keypair.generate().publicKey;
    const receipt = Keypair.generate().publicKey;
    const [entry] = projectDailyLeaderboard([
      { player, receipt, runId: 9n, score: 77, submittedAt: 123 },
    ]);
    expect(entry).toMatchObject({
      rank: 1,
      player: player.toBase58(),
      score: 77,
      playerName: `${player.toBase58().slice(0, 4)}…${player.toBase58().slice(-4)}`,
    });
  });
});
