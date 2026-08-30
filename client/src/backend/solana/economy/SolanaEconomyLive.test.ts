// @vitest-environment node

import { Schema } from "effect";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { initializeZkubeCore } from "@/core/zkubeCore";
import { EconomyState } from "../../views";
import type { PlayerStateView } from "./playerStateClient";
import { projectSolanaEconomy } from "./SolanaEconomyLive";

describe("Solana Economy projection", () => {
  it("solana_backend_projects_every_view_field", async () => {
    await initializeZkubeCore();
    const view = projectSolanaEconomy(profileFixture(), [
      {
        dayId: 41,
        board: "theme",
        amountLamports: 9_000_000n,
        expiresAt: 2_000_000,
      },
    ]);

    expect(Schema.decodeUnknownSync(EconomyState)(view)).toEqual(view);
    expect(Object.keys(view).sort()).toEqual(
      ["claimable", "kredits", "profile"].sort(),
    );
    expect(Object.keys(view.profile).sort()).toEqual(
      [
        "bestScore",
        "highestTier",
        "ladderPoints",
        "ladderTier",
        "records",
        "stars",
        "streak",
        "wornBorder",
        "wornEmblem",
      ].sort(),
    );
    expect(view.profile.stars).toHaveLength(100);
    expect(view.claimable[0]).toEqual({
      dayId: 41,
      board: "theme",
      lamports: 9_000_000n,
      expiresAt: 2_000_000,
    });
  });
});

function profileFixture(): PlayerStateView {
  return {
    owner: Keypair.generate().publicKey,
    version: 1,
    campaignStars: Array<number>(25).fill(0),
    featuredEmblem: 7,
    lifetimePaidEntries: 9n,
    kreditBalance: 4n,
    ladderPoints: 70n,
    highestLadderTier: 2,
    featuredFrameTier: 1,
    bestDailyScore: 12_345,
    lastEntryDayId: 40,
    entryStreakDays: 3,
    scoreRecord: {
      bestPrizeRank: 2,
      podiums: 1,
      wins: 0,
      rewardsLamports: 10_000_000n,
    },
    themeRecord: {
      bestPrizeRank: 1,
      podiums: 2,
      wins: 1,
      rewardsLamports: 20_000_000n,
    },
  };
}
