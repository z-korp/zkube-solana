// @vitest-environment node

import { type Connection, Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import type { DailyPlayerRecord, DailyView } from "../../client/src/chain/dailyClient";
import type { WeeklyPlayerRecord, WeeklyView } from "../../client/src/chain/weeklyClient";
import {
  dailyPlayerCanClose,
  dailyShouldFinalize,
  DEFAULT_MAX_KEEPER_SPEND_LAMPORTS,
  DEFAULT_MIN_KEEPER_LAMPORTS,
  expiredSessionCleanupAllowance,
  keeperKeypairFromEnv,
  keeperSpendWithinLimit,
  predictedKeeperSpendLamports,
  runKeeperPass,
  weeklyPlayerCanClose,
} from "../src/keeper";

describe("autonomous challenge keeper", () => {
  it("keeps enough reserve for the full variable-capacity cadence accounts", () => {
    const currentDailyAndWeeklyRent = 46_200_480;
    const twoTransactionFees = 10_000;
    expect(DEFAULT_MIN_KEEPER_LAMPORTS).toBeGreaterThan(
      currentDailyAndWeeklyRent + twoTransactionFees,
    );
  });

  it("fails closed at the compiled keeper spend ceiling", () => {
    expect(DEFAULT_MAX_KEEPER_SPEND_LAMPORTS).toBe(50_000_000);
    expect(keeperSpendWithinLimit(50_000_000, 50_000_000)).toBe(true);
    expect(keeperSpendWithinLimit(50_000_001, 50_000_000)).toBe(false);
    expect(keeperSpendWithinLimit(-1, 50_000_000)).toBe(false);
    expect(keeperSpendWithinLimit(1, -1)).toBe(false);
  });

  it("conservatively includes rent debits and the base fee from simulation", () => {
    expect(predictedKeeperSpendLamports(100_000_000, 75_000_000, 5_000)).toBe(
      25_005_000,
    );
    expect(predictedKeeperSpendLamports(100_000_000, 101_000_000, 5_000)).toBe(5_000);
    expect(() => predictedKeeperSpendLamports(1, -1, 5_000)).toThrow(
      "invalid lamports",
    );
  });

  it("pins the keeper secret to its public identity", () => {
    const keeper = Keypair.generate();
    const secret = JSON.stringify(Array.from(keeper.secretKey));
    expect(
      keeperKeypairFromEnv({
        KEEPER_SECRET_KEY: secret,
        ZKUBE_KEEPER_PUBLIC_KEY: keeper.publicKey.toBase58(),
      }).publicKey.equals(keeper.publicKey),
    ).toBe(true);
    expect(() =>
      keeperKeypairFromEnv({
        KEEPER_SECRET_KEY: secret,
        ZKUBE_KEEPER_PUBLIC_KEY: Keypair.generate().publicKey.toBase58(),
      }),
    ).toThrow("does not match ZKUBE_KEEPER_PUBLIC_KEY");
  });

  it("blocks every write when the keeper is below its reserve floor", async () => {
    const log = vi.fn();
    const connection = {
      getBalance: vi.fn().mockResolvedValue(1_499_999_999),
    } as unknown as Connection;

    await expect(
      runKeeperPass({
        connection,
        keeper: Keypair.generate(),
        minimumBalanceLamports: 1_500_000_000,
        log,
      }),
    ).rejects.toThrow("below floor");
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "keeper_readiness",
        ok: false,
        balanceLamports: 1_499_999_999,
      }),
    );
  });

  it("finalizes only after run close and either settlement or grace", () => {
    const daily = {
      status: "open",
      runsCloseAt: 100,
      settlementGraceCloseAt: 200,
      attemptsStarted: 4n,
      runsFinalized: 3n,
    } as DailyView;
    expect(dailyShouldFinalize(daily, 99)).toBe(false);
    expect(dailyShouldFinalize(daily, 150)).toBe(false);
    expect(dailyShouldFinalize(daily, 200)).toBe(true);
    expect(dailyShouldFinalize({ ...daily, runsFinalized: 4n }, 100)).toBe(true);
  });

  it("preserves Daily rollups and cancelled refunds before cleanup", () => {
    const record = {
      address: PublicKey.default,
      owner: PublicKey.default,
      attempts: 1,
      finalizedAttempts: 1,
      bestRunId: 9n,
      weeklyRolledUp: false,
      starRefunded: false,
    } satisfies DailyPlayerRecord;
    expect(dailyPlayerCanClose({ status: "claimable" } as DailyView, record)).toBe(false);
    expect(
      dailyPlayerCanClose(
        { status: "claimable" } as DailyView,
        { ...record, weeklyRolledUp: true },
      ),
    ).toBe(true);
    expect(
      dailyPlayerCanClose(
        { status: "claimable" } as DailyView,
        { ...record, weeklyRolledUp: true, finalizedAttempts: 0 },
      ),
    ).toBe(false);
    expect(
      dailyPlayerCanClose(
        { status: "claimable" } as DailyView,
        { ...record, bestRunId: 0n },
      ),
    ).toBe(true);
    expect(dailyPlayerCanClose({ status: "cancelled" } as DailyView, record)).toBe(false);
    expect(
      dailyPlayerCanClose(
        { status: "cancelled" } as DailyView,
        { ...record, starRefunded: true },
      ),
    ).toBe(true);
  });

  it("closes non-winners immediately but preserves every winner claim", () => {
    const owner = Keypair.generate().publicKey;
    const record = {
      address: PublicKey.default,
      owner,
      solClaimed: false,
      starsClaimed: false,
    } satisfies WeeklyPlayerRecord;
    const weekly = {
      status: "claimable",
      solWinnerCount: 1,
      starWinnerCount: 1,
      leaderboard: [{ player: owner, score: 100 }],
    } as WeeklyView;
    expect(weeklyPlayerCanClose(weekly, record)).toBe(false);
    expect(weeklyPlayerCanClose(weekly, { ...record, solClaimed: true })).toBe(false);
    expect(
      weeklyPlayerCanClose(weekly, {
        ...record,
        solClaimed: true,
        starsClaimed: true,
      }),
    ).toBe(true);
    expect(
      weeklyPlayerCanClose(
        { ...weekly, leaderboard: [] },
        record,
      ),
    ).toBe(true);
    expect(weeklyPlayerCanClose({ ...weekly, status: "closed" }, record)).toBe(true);
  });

  it("caps expired-session revokes inside the shared keeper write budget", () => {
    expect(expiredSessionCleanupAllowance(0, 8)).toBe(2);
    expect(expiredSessionCleanupAllowance(7, 8)).toBe(1);
    expect(expiredSessionCleanupAllowance(8, 8)).toBe(0);
    expect(expiredSessionCleanupAllowance(9, 8)).toBe(0);
  });
});
