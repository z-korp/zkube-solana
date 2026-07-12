// @vitest-environment node

import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { validatePaymasterTransaction } from "../../server/paymaster";
import {
  buildClaimDailyPrizePlan,
  buildForfeitUnclaimedDailyPrizesPlan,
  buildPrepareDailyRunPlan,
  buildRefundDailyEntryPlan,
  currentDailyDayId,
  type DailyView,
} from "./dailyClient";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  deriveDailyVaultPda,
} from "./pdas";
import { SessionWallet } from "./sessionWallet";
import { withSponsorshipInstruction } from "./sponsorshipClient";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

describe("Daily client", () => {
  it("uses UTC cadence IDs and domains every Daily PDA", () => {
    expect(currentDailyDayId(0)).toBe(0);
    expect(currentDailyDayId(86_399)).toBe(0);
    expect(currentDailyDayId(86_400)).toBe(1);
    const owner = Keypair.generate().publicKey;
    const first = deriveDailyChallengePda(1);
    const second = deriveDailyChallengePda(2);
    expect(first.equals(second)).toBe(false);
    expect(deriveDailyVaultPda(1).equals(first)).toBe(false);
    expect(deriveDailyLeaderboardPda(first).equals(deriveDailyLeaderboardPda(second))).toBe(false);
    expect(deriveDailyPlayerPda(first, owner).equals(deriveDailyPlayerPda(second, owner))).toBe(false);
  });

  it("builds both entry paths with bounded sessions accepted by paymaster policy", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(owner);
    const nowUnix = Math.floor(Date.now() / 1_000);
    const connection = {
      getAccountInfo: vi.fn().mockResolvedValue(null),
    } as unknown as Connection;
    const daily = dailyFixture(owner.publicKey);

    for (const payment of ["stars", "usdc"] as const) {
      const session = Keypair.generate();
      const prepared = await buildPrepareDailyRunPlan({
        connection,
        wallet,
        session,
        daily,
        payment,
        paymaster: paymaster.publicKey,
        nowUnix,
      });
      const transaction = new VersionedTransaction(new TransactionMessage({
        payerKey: paymaster.publicKey,
        recentBlockhash: "11111111111111111111111111111111",
        instructions: withSponsorshipInstruction({
          owner: owner.publicKey,
          paymaster: paymaster.publicKey,
          instructions: prepared.transactionPlan.transaction.instructions,
        }),
      }).compileToV0Message());
      transaction.sign([owner, session]);
      expect(validatePaymasterTransaction(transaction, paymaster.publicKey, nowUnix)).toBeNull();
    }
  });

  it("builds claim and cancellation refund plans accepted by paymaster policy", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(owner);
    const connection = {} as Connection;
    const daily = dailyFixture(owner.publicKey);
    const plans = await Promise.all([
      buildClaimDailyPrizePlan({ connection, wallet, daily, paymaster: paymaster.publicKey }),
      buildRefundDailyEntryPlan({ connection, wallet, daily, paymaster: paymaster.publicKey }),
    ]);
    for (const plan of plans) {
      const transaction = new VersionedTransaction(new TransactionMessage({
        payerKey: paymaster.publicKey,
        recentBlockhash: "11111111111111111111111111111111",
        instructions: withSponsorshipInstruction({
          owner: owner.publicKey,
          paymaster: paymaster.publicKey,
          instructions: plan.transaction.instructions,
        }),
      }).compileToV0Message());
      transaction.sign([owner]);
      expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBeNull();
    }
  });

  it("builds permissionless expiry forfeiture into the configured reward reserve", async () => {
    const caller = Keypair.generate();
    const wallet = new SessionWallet(caller);
    const connection = {} as Connection;
    const daily = dailyFixture(caller.publicKey);
    const plan = await buildForfeitUnclaimedDailyPrizesPlan({ connection, wallet, daily });

    expect(plan.label).toBe("Forfeit expired Daily prizes");
    expect(plan.layer).toBe("solana-base");
    expect(plan.feePayer.equals(caller.publicKey)).toBe(true);
    expect(plan.transaction.instructions).toHaveLength(1);
    expect(plan.transaction.instructions[0].keys[5].pubkey.equals(daily.rewardVault)).toBe(true);
    expect(plan.transaction.instructions[0].keys[7].pubkey.equals(caller.publicKey)).toBe(true);
  });
});

function dailyFixture(owner: PublicKey): DailyView {
  const dayId = currentDailyDayId();
  return {
    address: deriveDailyChallengePda(dayId),
    dayId,
    status: "open",
    mapId: 1,
    opensAt: 0,
    entriesCloseAt: 2_000_000_000,
    runsCloseAt: 2_000_000_100,
    settlementGraceCloseAt: 2_000_000_200,
    finalizedAt: 0,
    claimsCloseAt: 2_000_000_300,
    entryPrice: 1_000_000n,
    starEntryCost: 10n,
    sponsorFunding: 0n,
    prizeLiability: 0n,
    settledPrizePool: 0n,
    prizeForfeited: 0n,
    totalPaidAttempts: 0n,
    totalFreeAttempts: 0n,
    runsStarted: 0n,
    runsFinalized: 0n,
    paymentMint: Keypair.generate().publicKey,
    paymentTokenProgram: TOKEN_PROGRAM_ID,
    paymentVault: Keypair.generate().publicKey,
    rewardVault: Keypair.generate().publicKey,
    playerEligible: true,
    playerStars: 20n,
    nextRunId: 1n,
    player: null,
    leaderboard: [{
      player: owner,
      receipt: Keypair.generate().publicKey,
      runId: 1n,
      score: 100,
      submittedAt: 1,
    }],
  };
}
