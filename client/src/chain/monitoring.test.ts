// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  evaluateOperationalReadiness,
  type DailyOperationalSnapshot,
} from "./monitoring";

describe("stateless operational monitoring", () => {
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
    weeklyEligiblePlayers: 2n,
    weeklyRollups: 2n,
    attemptsStarted: 2n,
    runsFinalized: 2n,
    leaderboardSize: 2,
  };
}
