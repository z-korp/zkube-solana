// @vitest-environment node

import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildCancelDailyChallengePlan,
  buildCreateDailyChallengePlan,
  buildDistributeDailyRakePlan,
  buildFinalizeDailyChallengePlan,
} from "./dailyAdminClient";
import { currentDailyDayId, type DailyView } from "./dailyClient";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyVaultPda,
  deriveTreasuryLedgerPda,
} from "./pdas";
import { SessionWallet } from "./sessionWallet";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

describe("Daily authority client", () => {
  it("publishes PDA-domained immutable windows without a caller-supplied claim deadline", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const dayId = 42;
    const plan = await buildCreateDailyChallengePlan({
      connection: {} as Connection,
      authority,
      publication: {
        dayId,
        mapId: 1,
        rules: endlessRules(),
        endlessThresholds: [15, 40, 80, 150, 280, 500, 900],
        endlessScoreMultipliersX100: [100, 150, 200, 300, 400, 600, 800, 1_000],
        endlessRampMultiplierX100: 100,
        opensAt: 1_000,
        entriesCloseAt: 2_000,
        runsCloseAt: 3_000,
        settlementGraceCloseAt: 4_000,
        starEntryCost: 10n,
        payoutBps: [4_000, 2_000, 1_200, 800, 600, 400, 300, 300, 200, 200],
        paymentMint: Keypair.generate().publicKey,
        paymentTokenProgram: TOKEN_PROGRAM_ID,
      },
    });
    const challenge = deriveDailyChallengePda(dayId);
    const keys = plan.transaction.instructions[0].keys;

    expect(keys[1].pubkey.equals(challenge)).toBe(true);
    expect(keys[2].pubkey.equals(deriveDailyLeaderboardPda(challenge))).toBe(
      true,
    );
    expect(keys[4].pubkey.equals(deriveDailyVaultPda(dayId))).toBe(true);
  });

  it("separates authority cancellation from permissionless finalize and rake distribution", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const caller = new SessionWallet(Keypair.generate());
    const daily = dailyFixture();
    const [cancel, finalize, distribute] = await Promise.all([
      buildCancelDailyChallengePlan({
        connection: {} as Connection,
        authority,
        daily,
      }),
      buildFinalizeDailyChallengePlan({
        connection: {} as Connection,
        caller,
        daily,
      }),
      buildDistributeDailyRakePlan({
        connection: {} as Connection,
        caller,
        daily,
        teamVault: Keypair.generate().publicKey,
        paymasterVault: Keypair.generate().publicKey,
        treasuryVault: Keypair.generate().publicKey,
      }),
    ]);

    expect(cancel.feePayer.equals(authority.publicKey)).toBe(true);
    expect(finalize.feePayer.equals(caller.publicKey)).toBe(true);
    expect(distribute.feePayer.equals(caller.publicKey)).toBe(true);
    expect(
      distribute.transaction.instructions[0].keys[1].pubkey.equals(
        deriveTreasuryLedgerPda(),
      ),
    ).toBe(true);
  });
});

function endlessRules() {
  return {
    level: 1,
    pointsRequired: 0xffff_ffff,
    maxMoves: 0xffff,
    difficulty: 1,
    primary: { kind: 0, value: 0, requiredCount: 0 },
    secondary: { kind: 0, value: 0, requiredCount: 0 },
    activeMutatorId: 0,
    passiveMutatorId: 0,
    bossId: 0,
    blockWeights: [100, 100, 100, 100, 100] as const,
    scoreMultiplierX100: 100,
    comboMultiplierX100: 100,
    lineClearBonus: 0,
    perfectClearBonus: 0,
    starThresholdModifier: 100,
    bonusType: 0,
    bonusTriggerType: 0,
    bonusThreshold: 0,
    startingCharges: 0,
    startingRows: 4,
  };
}

function dailyFixture(): DailyView {
  const dayId = currentDailyDayId();
  return {
    address: deriveDailyChallengePda(dayId),
    dayId,
    status: "open",
    mapId: 1,
    rules: endlessRules(),
    endlessThresholds: [15, 40, 80, 150, 280, 500, 900],
    endlessScoreMultipliersX100: [100, 150, 200, 300, 400, 600, 800, 1_000],
    endlessRampMultiplierX100: 100,
    opensAt: 0,
    entriesCloseAt: 1,
    runsCloseAt: 2,
    settlementGraceCloseAt: 3,
    finalizedAt: 0,
    claimsCloseAt: 0,
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
    paymentVault: deriveDailyVaultPda(dayId),
    rewardVault: Keypair.generate().publicKey,
    playerEligible: false,
    playerStars: 0n,
    nextRunId: 0n,
    player: null,
    leaderboard: [],
  };
}
