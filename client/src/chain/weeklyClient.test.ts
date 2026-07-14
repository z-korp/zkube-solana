// @vitest-environment node

import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import { validatePaymasterTransaction } from "../server/paymaster";
import { SessionWallet } from "./sessionWallet";
import {
  buildClaimWeeklyCashPlan,
  buildClaimWeeklyStarsPlan,
  buildFinalizeWeeklyPlan,
  buildForfeitWeeklyCashPlan,
  buildRollupDailyPlan,
  currentWeeklyId,
  type WeeklyView,
} from "./weeklyClient";
import { deriveDailyChallengePda, deriveWeeklyChallengePda } from "./pdas";
import type { DailyView } from "./dailyClient";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

const economyRuntime = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));

vi.mock("./economyClient", () => ({
  fetchEconomyRuntime: vi.fn(async () => economyRuntime.value),
}));

describe("Weekly client", () => {
  it("uses Monday-anchored UTC cadence IDs", () => {
    expect(currentWeeklyId(0)).toBe(0);
    expect(currentWeeklyId(345_599)).toBe(0);
    expect(currentWeeklyId(345_600)).toBe(1);
    expect(currentWeeklyId(950_399)).toBe(1);
    expect(currentWeeklyId(950_400)).toBe(2);
  });

  it("builds sponsored cash, Star, and permissionless finalization plans", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(owner);
    const connection = {} as Connection;
    const weekly = weeklyFixture(owner.publicKey);
    const plans = await Promise.all([
      buildClaimWeeklyCashPlan({
        connection,
        wallet,
        weekly,
        paymaster: paymaster.publicKey,
      }),
      buildClaimWeeklyStarsPlan({
        connection,
        wallet,
        weekly,
        paymaster: paymaster.publicKey,
      }),
      buildFinalizeWeeklyPlan({
        connection,
        wallet,
        weekly,
        paymaster: paymaster.publicKey,
      }),
    ]);

    for (const plan of plans) {
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: paymaster.publicKey,
          recentBlockhash: "11111111111111111111111111111111",
          instructions: plan.transaction.instructions,
        }).compileToV0Message(),
      );
      transaction.sign([owner]);
      expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBeNull();
      expect(transaction.serialize().length).toBeLessThanOrEqual(1_232);
    }
  });

  it("builds sponsored permissionless expiry forfeiture against the pinned reserve", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(owner);
    const weekly = weeklyFixture(owner.publicKey);
    economyRuntime.value = {
      address: Keypair.generate().publicKey,
      protocol: Keypair.generate().publicKey,
      contentVersion: 2,
      paymentMint: weekly.paymentMint,
      paymentTokenProgram: weekly.paymentTokenProgram,
      rewardVault: Keypair.generate().publicKey,
      dailyRulesVersion: 1,
      dailyEntryStars: 10n,
      zoneUnlockStars: 20n,
      weeklyStipendXp: 2_500,
      weeklyStipendStars: 30n,
      cashWinnerStars: 30n,
    };
    const connection = {} as Connection;
    const plan = await buildForfeitWeeklyCashPlan({
      connection,
      wallet,
      weekly,
      paymaster: paymaster.publicKey,
    });
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: paymaster.publicKey,
        recentBlockhash: "11111111111111111111111111111111",
        instructions: plan.transaction.instructions,
      }).compileToV0Message(),
    );
    transaction.sign([owner]);
    expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBeNull();
  });

  it("lets a signed keeper roll another player's eligible Daily record", async () => {
    const caller = Keypair.generate();
    const playerOwner = Keypair.generate().publicKey;
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(caller);
    const weekly = weeklyFixture(caller.publicKey);
    const dayId = weekly.weekId * 7 - 3;
    const daily = {
      economyVersion: 2,
      address: deriveDailyChallengePda(dayId),
      dayId,
      weekId: weekly.weekId,
    } as DailyView;
    const plan = await buildRollupDailyPlan({
      connection: {} as Connection,
      wallet,
      daily,
      weekly,
      paymaster: paymaster.publicKey,
      playerOwner,
    });
    expect(plan.transaction.instructions[0].keys[6].pubkey.equals(playerOwner)).toBe(true);
    expect(plan.transaction.instructions[0].keys[8].pubkey.equals(caller.publicKey)).toBe(true);

    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: paymaster.publicKey,
        recentBlockhash: "11111111111111111111111111111111",
        instructions: plan.transaction.instructions,
      }).compileToV0Message(),
    );
    transaction.sign([caller]);
    expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBeNull();
  });
});

function weeklyFixture(owner: PublicKey): WeeklyView {
  const weekId = currentWeeklyId();
  return {
    address: deriveWeeklyChallengePda(weekId),
    weekId,
    status: "claimable",
    opensAt: 0,
    closesAt: 0,
    finalizesAt: 0,
    finalizedAt: 0,
    claimsCloseAt: 2_000_000_000,
    committedCashPool: 10_000_000n,
    cashClaimed: 0n,
    participants: 20,
    cashWinnerCount: 1,
    starWinnerCount: 1,
    paymentMint: Keypair.generate().publicKey,
    paymentTokenProgram: TOKEN_PROGRAM_ID,
    paymentVault: Keypair.generate().publicKey,
    player: {
      score: 500,
      resultCount: 5,
      cashClaimed: false,
      starsClaimed: false,
    },
    leaderboard: [{ player: owner, score: 500 }],
  };
}
