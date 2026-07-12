// @vitest-environment node

import BN from "bn.js";
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
  mapDailyGameRulesSnapshot,
  type DailyView,
} from "./dailyClient";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  deriveDailyVaultPda,
} from "./pdas";
import { mapActiveRunAccount } from "./runPlan";
import { SessionWallet } from "./sessionWallet";
import { withSponsorshipInstruction } from "./sponsorshipClient";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

describe("Daily client", () => {
  it("projects authoritative challenge rules and endless tuning", () => {
    const rules = decodedRulesFixture();
    const endless = decodedEndlessFixture();

    const view = mapDailyGameRulesSnapshot({ rules, ...endless });

    expect(view).toEqual({
      rules: {
        pointsRequired: 12_345,
        maxMoves: 99,
        difficulty: 7,
        primary: { kind: 1, value: 2, requiredCount: 3 },
        secondary: { kind: 4, value: 5, requiredCount: 6 },
        activeMutatorId: 8,
        passiveMutatorId: 9,
        bossId: 10,
        starThresholdModifier: 131,
        bonusType: 11,
        bonusTriggerType: 12,
        bonusThreshold: 456,
        startingCharges: 13,
      },
      endlessThresholds: [17, 41, 83, 151, 281, 503, 907],
      endlessScoreMultipliersX100: [101, 149, 211, 307, 401, 601, 809, 1_009],
      endlessRampMultiplierX100: 137,
    });
  });

  it("projects the decoded active-run endless tuning without client defaults", () => {
    const owner = Keypair.generate().publicKey;
    const dailyChallenge = Keypair.generate().publicKey;
    const endless = decodedEndlessFixture();
    const account = {
      owner,
      runId: new BN("9007199254740993"),
      mode: { daily: {} },
      dailyChallenge,
      mapId: 6,
      level: 4,
      rules: decodedRulesFixture(),
      lifecycle: { active: {} },
      score: 987_654,
      actionCounter: 42,
      moves: 18,
      comboCounter: 3,
      maxCombo: 7,
      primaryProgress: 5,
      secondaryProgress: 2,
      levelLinesCleared: 21,
      totalLinesCleared: 144,
      bonusUses: 4,
      currentDifficulty: 6,
      bonusType: 11,
      bonusCharges: 2,
      grid: Array.from({ length: 80 }, (_, index) => index % 6),
      nextRow: [1, 2, 3, 4, 5, 0, 1, 2],
      hasNextRow: true,
      pendingVrfCounter: 43,
      ...endless,
    } as unknown as Parameters<typeof mapActiveRunAccount>[0];

    const view = mapActiveRunAccount(account);

    expect(view.runId).toBe(9_007_199_254_740_993n);
    expect(view.rules.pointsRequired).toBe(12_345);
    expect(view.endlessThresholds).toEqual(endless.endlessThresholds);
    expect(view.endlessScoreMultipliersX100).toEqual(
      endless.endlessScoreMultipliersX100,
    );
    expect(view.endlessRampMultiplierX100).toBe(137);
  });

  it("uses UTC cadence IDs and domains every Daily PDA", () => {
    expect(currentDailyDayId(0)).toBe(0);
    expect(currentDailyDayId(86_399)).toBe(0);
    expect(currentDailyDayId(86_400)).toBe(1);
    const owner = Keypair.generate().publicKey;
    const first = deriveDailyChallengePda(1);
    const second = deriveDailyChallengePda(2);
    expect(first.equals(second)).toBe(false);
    expect(deriveDailyVaultPda(1).equals(first)).toBe(false);
    expect(
      deriveDailyLeaderboardPda(first).equals(
        deriveDailyLeaderboardPda(second),
      ),
    ).toBe(false);
    expect(
      deriveDailyPlayerPda(first, owner).equals(
        deriveDailyPlayerPda(second, owner),
      ),
    ).toBe(false);
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
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: paymaster.publicKey,
          recentBlockhash: "11111111111111111111111111111111",
          instructions: withSponsorshipInstruction({
            owner: owner.publicKey,
            paymaster: paymaster.publicKey,
            instructions: prepared.transactionPlan.transaction.instructions,
          }),
        }).compileToV0Message(),
      );
      transaction.sign([owner, session]);
      expect(
        validatePaymasterTransaction(transaction, paymaster.publicKey, nowUnix),
      ).toBeNull();
    }
  });

  it("builds claim and cancellation refund plans accepted by paymaster policy", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(owner);
    const connection = {} as Connection;
    const daily = dailyFixture(owner.publicKey);
    const plans = await Promise.all([
      buildClaimDailyPrizePlan({
        connection,
        wallet,
        daily,
        paymaster: paymaster.publicKey,
      }),
      buildRefundDailyEntryPlan({
        connection,
        wallet,
        daily,
        paymaster: paymaster.publicKey,
      }),
    ]);
    for (const plan of plans) {
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: paymaster.publicKey,
          recentBlockhash: "11111111111111111111111111111111",
          instructions: withSponsorshipInstruction({
            owner: owner.publicKey,
            paymaster: paymaster.publicKey,
            instructions: plan.transaction.instructions,
          }),
        }).compileToV0Message(),
      );
      transaction.sign([owner]);
      expect(
        validatePaymasterTransaction(transaction, paymaster.publicKey),
      ).toBeNull();
    }
  });

  it("builds permissionless expiry forfeiture into the configured reward reserve", async () => {
    const caller = Keypair.generate();
    const wallet = new SessionWallet(caller);
    const connection = {} as Connection;
    const daily = dailyFixture(caller.publicKey);
    const plan = await buildForfeitUnclaimedDailyPrizesPlan({
      connection,
      wallet,
      daily,
    });

    expect(plan.label).toBe("Forfeit expired Daily prizes");
    expect(plan.layer).toBe("solana-base");
    expect(plan.feePayer.equals(caller.publicKey)).toBe(true);
    expect(plan.transaction.instructions).toHaveLength(1);
    expect(
      plan.transaction.instructions[0].keys[5].pubkey.equals(daily.rewardVault),
    ).toBe(true);
    expect(
      plan.transaction.instructions[0].keys[7].pubkey.equals(caller.publicKey),
    ).toBe(true);
  });
});

function dailyFixture(owner: PublicKey): DailyView {
  const dayId = currentDailyDayId();
  return {
    address: deriveDailyChallengePda(dayId),
    dayId,
    status: "open",
    mapId: 1,
    rules: {
      pointsRequired: 0xffff_ffff,
      maxMoves: 0xffff,
      difficulty: 1,
      primary: { kind: 0, value: 0, requiredCount: 0 },
      secondary: { kind: 0, value: 0, requiredCount: 0 },
      activeMutatorId: 0,
      passiveMutatorId: 0,
      bossId: 0,
      starThresholdModifier: 128,
      bonusType: 0,
      bonusTriggerType: 0,
      bonusThreshold: 0,
      startingCharges: 0,
    },
    endlessThresholds: [15, 40, 80, 150, 280, 500, 900],
    endlessScoreMultipliersX100: [100, 150, 200, 300, 400, 600, 800, 1_000],
    endlessRampMultiplierX100: 100,
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
    leaderboard: [
      {
        player: owner,
        receipt: Keypair.generate().publicKey,
        runId: 1n,
        score: 100,
        submittedAt: 1,
      },
    ],
  };
}

function decodedRulesFixture() {
  return {
    pointsRequired: 12_345,
    maxMoves: 99,
    difficulty: 7,
    primary: { kind: 1, value: 2, requiredCount: 3 },
    secondary: { kind: 4, value: 5, requiredCount: 6 },
    activeMutatorId: 8,
    passiveMutatorId: 9,
    bossId: 10,
    starThresholdModifier: 131,
    bonusType: 11,
    bonusTriggerType: 12,
    bonusThreshold: 456,
    startingCharges: 13,
  };
}

function decodedEndlessFixture() {
  return {
    endlessThresholds: [17, 41, 83, 151, 281, 503, 907],
    endlessScoreMultipliersX100: [101, 149, 211, 307, 401, 601, 809, 1_009],
    endlessRampMultiplierX100: 137,
  };
}
