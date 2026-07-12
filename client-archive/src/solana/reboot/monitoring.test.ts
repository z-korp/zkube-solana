// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  evaluateOperationalReadiness,
  type DailyOperationalSnapshot,
} from "./monitoring";

describe("stateless operational monitoring", () => {
  it("accepts a balanced active challenge and funded paymaster", () => {
    const result = evaluateOperationalReadiness({
      nowUnix: 1_500,
      paymasterSolLamports: 1_000_000_000n,
      daily: [fixture()],
      thresholds: { minPaymasterLamports: 100_000_000n },
    });
    expect(result.ok).toBe(true);
    expect(result.alerts).toEqual([]);
    expect(result.challenges[0]).toMatchObject({
      expectedVaultBalance: 3_000_000n,
      actualVaultBalance: 3_000_000n,
      outstandingRuns: 0n,
    });
  });

  it("distinguishes accounting drift, vault deficit, and unsolicited surplus", () => {
    const drift = fixture();
    drift.prizeLiability -= 1n;
    drift.vaultBalance -= 500_000n;
    const surplus = fixture();
    surplus.dayId = 2;
    surplus.vaultBalance += 7n;
    const result = evaluateOperationalReadiness({
      nowUnix: 1_500,
      paymasterSolLamports: 1n,
      daily: [drift, surplus],
    });
    expect(result.ok).toBe(false);
    expect(result.alerts.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "DAILY_ACCOUNTING_DRIFT",
      "DAILY_VAULT_DEFICIT",
      "DAILY_VAULT_SURPLUS",
    ]));
  });

  it("reports expired claims, cancellation refunds, run backlog, and low fee funding", () => {
    const claimable = fixture();
    claimable.status = "claimable";
    claimable.finalizedAt = 2_000;
    claimable.claimsCloseAt = 3_000;
    claimable.settledPrizePool = claimable.prizeLiability;
    claimable.runsStarted = 4n;
    claimable.runsFinalized = 3n;
    const cancelled = fixture();
    cancelled.dayId = 2;
    cancelled.status = "cancelled";
    const result = evaluateOperationalReadiness({
      nowUnix: 4_000,
      paymasterSolLamports: 50n,
      daily: [claimable, cancelled],
      thresholds: { minPaymasterLamports: 100n },
    });
    expect(result.ok).toBe(true);
    expect(result.alerts.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "PAYMASTER_SOL_LOW",
      "DAILY_RUN_BACKLOG",
      "DAILY_FORFEITURE_DUE",
      "DAILY_REFUND_BACKLOG",
      "DAILY_SPONSOR_RECLAIM_DUE",
    ]));
  });

  it("fails closed for impossible counters, accounting underflow, and empty paymaster SOL", () => {
    const impossible = fixture();
    impossible.runsFinalized = impossible.runsStarted + 1n;
    impossible.rakeDistributed = impossible.rakeAccrued + 1n;
    const result = evaluateOperationalReadiness({
      nowUnix: 1_500,
      paymasterSolLamports: 0n,
      daily: [impossible],
    });
    expect(result.ok).toBe(false);
    expect(result.alerts.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "PAYMASTER_SOL_EMPTY",
      "DAILY_RUN_COUNTERS",
      "DAILY_ACCOUNTING_UNDERFLOW",
    ]));
  });
});

function fixture(): DailyOperationalSnapshot {
  return {
    address: Keypair.generate().publicKey,
    dayId: 1,
    status: "open",
    opensAt: 1_000,
    entriesCloseAt: 2_000,
    runsCloseAt: 3_000,
    settlementGraceCloseAt: 3_500,
    finalizedAt: 0,
    claimsCloseAt: 0,
    sponsorFunding: 2_000_000n,
    paidEntryFunding: 1_000_000n,
    prizeLiability: 2_900_000n,
    rakeAccrued: 100_000n,
    rakeDistributed: 0n,
    refundsPaid: 0n,
    prizeClaimed: 0n,
    prizeForfeited: 0n,
    settledPrizePool: 0n,
    sponsorReclaimed: false,
    runsStarted: 2n,
    runsFinalized: 2n,
    paymentVault: Keypair.generate().publicKey,
    vaultBalance: 3_000_000n,
    leaderboardSize: 2,
  };
}
