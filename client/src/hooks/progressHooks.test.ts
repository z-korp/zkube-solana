// @vitest-environment node
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import type {
  AchievementProgressView,
  QuestProgressView,
} from "@/chain/progressClient";
import { projectAchievements } from "./useAchievements";
import { projectDailyLeaderboard } from "./useDailyLeaderboard";
import { projectQuests } from "./useQuests";

describe("progress projections", () => {
  it("exposes only the 16 Arcade achievement slots", () => {
    expect(projectAchievements(null)).toHaveLength(16);
    expect(projectAchievements(null).map(({ index }) => index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20, 21, 22, 23,
    ]);
  });

  it("uses authoritative achievement thresholds and XP", () => {
    const entries: AchievementProgressView[] = Array.from(
      { length: 12 },
      (_, index) => ({
        index,
        metric: 0,
        progress: index === 8 ? 3n : 0n,
        threshold: index === 8 ? 3n : 1n,
        xpReward: index === 8 ? 333 : 1,
        completed: index === 8,
        active: true,
      }),
    );
    expect(projectAchievements(entries)[8]).toMatchObject({
      target: 3,
      xp: 333,
      progress: 3,
      completed: true,
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
      active: true,
      completed: false,
    };
    expect(projectQuests([entry], 86_400)[0]).toMatchObject({
      target: 7,
      xpReward: 200,
      progress: 6,
      active: true,
    });

    const weekly = {
      ...entry,
      index: 10,
      cadence: "weekly" as const,
      xpReward: 500,
    };
    const entries = Array.from({ length: 11 }, (_, index) =>
      index === 10 ? weekly : { ...entry, index },
    );
    expect(projectQuests(entries, 86_400)[10]).toMatchObject({
      xpReward: 500,
    });

    expect(projectQuests(entries, 2 * 86_400)[15]).toMatchObject({
      name: "Single-turn Power",
      target: 1,
    });
  });

  it("keeps score order and case-sensitive base58 identity", () => {
    const player = Keypair.generate().publicKey;
    const [entry] = projectDailyLeaderboard([
      {
        player,
        playerName: "Wave_Rider7",
        runId: 9n,
        dailyScore: 77,
        dailyBonusTriggers: 2,
        engineScore: 70,
        moves: 12,
        score: 77,
        submittedAt: 123,
      },
    ]);
    expect(entry).toMatchObject({
      rank: 1,
      player: player.toBase58(),
      score: 77,
      playerName: "Wave_Rider7",
    });
  });
});
