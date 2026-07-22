// @vitest-environment node
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { projectDailyLeaderboard } from "./useDailyLeaderboard";

describe("progress projections", () => {
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
