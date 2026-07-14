// @vitest-environment node

import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import type { DailyPlayerRecord, DailyView } from "../chain/dailyClient";
import type { WeeklyPlayerRecord, WeeklyView } from "../chain/weeklyClient";
import {
  dailyPlayerCanClose,
  dailyShouldFinalize,
  keeperKeypairFromEnv,
  weeklyPlayerCanClose,
} from "./keeper";

describe("autonomous challenge keeper", () => {
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
      cashClaimed: false,
      starsClaimed: false,
    } satisfies WeeklyPlayerRecord;
    const weekly = {
      status: "claimable",
      cashWinnerCount: 1,
      starWinnerCount: 1,
      leaderboard: [{ player: owner, score: 100 }],
    } as WeeklyView;
    expect(weeklyPlayerCanClose(weekly, record)).toBe(false);
    expect(weeklyPlayerCanClose(weekly, { ...record, cashClaimed: true })).toBe(false);
    expect(
      weeklyPlayerCanClose(weekly, {
        ...record,
        cashClaimed: true,
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
});
