// @vitest-environment node
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { dailyLeaderboardRank, parseDailyStatus } from "@/chain/dailyClient";

const key = () => Keypair.generate().publicKey;

describe("Daily projection", () => {
  it("shares rank for exact official ties regardless of engine score or moves", () => {
    const playerOne = key();
    const playerTwo = key();
    const entries = [playerOne, playerTwo].map((player, index) => ({
      player,
      playerName: null,
      runId: BigInt(index + 1),
      dailyScore: 100,
      dailyBonusTriggers: 4,
      engineScore: index === 0 ? 10 : 99,
      moves: index === 0 ? 99 : 1,
      score: 100,
      submittedAt: 500,
    }));

    expect(dailyLeaderboardRank(entries, 0)).toBe(1);
    expect(dailyLeaderboardRank(entries, 1)).toBe(1);
  });

  it("rejects unknown decoded Daily status variants", () => {
    expect(parseDailyStatus({ open: {} })).toBe("open");
    expect(parseDailyStatus({ settled: {} })).toBe("unknown");
    expect(parseDailyStatus("open")).toBe("unknown");
  });

});
