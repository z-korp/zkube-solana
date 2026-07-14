// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_PAYMASTER_LAMPORTS,
  evaluateOperationalReadiness,
  projectPaymasterReserve,
  type DailyOperationalSnapshot,
} from "./monitoring";

describe("stateless operational monitoring", () => {
  it("projects reclaimable working capital for fresh player cohorts", () => {
    expect(DEFAULT_MIN_PAYMASTER_LAMPORTS).toBe(1_500_000_000n);
    expect(
      [1, 10, 25, 100].map((players) => {
        const projection = projectPaymasterReserve(players);
        return [players, projection.recommendedMinimumLamports];
      }),
    ).toEqual([
      [1, 740_649_216n],
      [10, 994_285_920n],
      [25, 1_417_013_760n],
      [100, 3_530_652_960n],
    ]);
    expect(() => projectPaymasterReserve(0)).toThrow(/activePlayers/);
  });

  it("accepts a consistent active challenge and funded paymaster", () => {
    const result = evaluateOperationalReadiness({
      nowUnix: 1_500,
      paymasterSolLamports: 1_000_000_000n,
      daily: [fixture()],
      thresholds: { minPaymasterLamports: 100_000_000n },
    });

    expect(result.ok).toBe(true);
    expect(result.alerts).toEqual([]);
    expect(result.challenges[0]).toMatchObject({
      outstandingRuns: 0n,
      outstandingRollups: 0n,
      outstandingCleanup: 2n,
    });
  });

  it("reports elapsed run and Weekly-rollup backlogs", () => {
    const daily = fixture();
    daily.status = "claimable";
    daily.finalizedAt = 3_600;
    daily.attemptsStarted = 4n;
    daily.runsFinalized = 3n;
    daily.weeklyEligiblePlayers = 2n;
    daily.weeklyRollups = 1n;
    const result = evaluateOperationalReadiness({
      nowUnix: 4_000,
      paymasterSolLamports: 50n,
      daily: [daily],
      thresholds: { minPaymasterLamports: 100n },
    });

    expect(result.ok).toBe(true);
    expect(result.alerts.map(({ code }) => code)).toEqual([
      "PAYMASTER_SOL_LOW",
      "DAILY_RUN_BACKLOG",
      "DAILY_ROLLUP_BACKLOG",
    ]);
  });

  it("fails closed for impossible counters, windows, and empty paymaster SOL", () => {
    const impossible = fixture();
    impossible.entriesCloseAt = impossible.opensAt;
    impossible.runsFinalized = impossible.attemptsStarted + 1n;
    impossible.weeklyEligiblePlayers = impossible.uniquePlayers + 1n;
    impossible.weeklyRollups = impossible.weeklyEligiblePlayers + 1n;
    impossible.closedPlayers = impossible.uniquePlayers + 1n;
    impossible.leaderboardSize = Number(impossible.uniquePlayers + 1n);
    const result = evaluateOperationalReadiness({
      nowUnix: 1_500,
      paymasterSolLamports: 0n,
      daily: [impossible],
    });

    expect(result.ok).toBe(false);
    expect(result.alerts.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "PAYMASTER_SOL_EMPTY",
      "DAILY_WINDOW_ORDER",
      "DAILY_RUN_COUNTERS",
      "DAILY_ELIGIBILITY_COUNTERS",
      "DAILY_ROLLUP_COUNTERS",
      "DAILY_CLEANUP_COUNTERS",
      "DAILY_LEADERBOARD_COUNTERS",
    ]));
  });
});

function fixture(): DailyOperationalSnapshot {
  return {
    address: Keypair.generate().publicKey,
    dayId: 1,
    weekId: 1,
    status: "open",
    opensAt: 1_000,
    entriesCloseAt: 2_000,
    runsCloseAt: 3_000,
    settlementGraceCloseAt: 3_500,
    finalizedAt: 0,
    entryStars: 10n,
    uniquePlayers: 2n,
    closedPlayers: 0n,
    weeklyEligiblePlayers: 2n,
    weeklyRollups: 2n,
    attemptsStarted: 2n,
    runsFinalized: 2n,
    leaderboardSize: 2,
  };
}
