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
import { validatePaymasterTransaction } from "../server/paymaster";
import {
  buildPrepareDailyRunPlan,
  buildCloseDailyChallengePlan,
  buildCloseDailyPlayerPlan,
  buildRefundDailyEntryPlan,
  currentDailyDayId,
  mapDailyGameRulesSnapshot,
  type DailyView,
} from "./dailyClient";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
} from "./pdas";
import { mapActiveRunAccount } from "./runPlan";
import { SessionWallet } from "./sessionWallet";

describe("Daily client", () => {
  it("projects authoritative challenge scoring and pressure tuning", () => {
    const rules = decodedRulesFixture();
    const pressure = decodedPressureFixture();
    const scoringRule = {
      id: 3,
      family: 1,
      kind: 1,
      parameter: 3,
      bonusMultiplierX100: 1_250,
    };

    const view = mapDailyGameRulesSnapshot({ rules, pressure, scoringRule });

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
      scoringRule,
      pressure,
      endlessThresholds: [17, 41, 83, 151, 281, 503, 907],
      endlessScoreMultipliersX100: [101, 149, 211, 307, 401, 601, 809, 1_009],
      endlessRampMultiplierX100: 100,
    });
  });

  it("projects the decoded active-run Daily scores and pressure without client defaults", () => {
    const owner = Keypair.generate().publicKey;
    const dailyChallenge = Keypair.generate().publicKey;
    const pressure = decodedPressureFixture();
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
      dailyScore: 321,
      pressureScore: 144,
      dailyScoringRule: {
        id: 14,
        family: 6,
        kind: 7,
        parameter: 0,
        bonusMultiplierX100: 250,
      },
      dailyPressure: pressure,
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
    } as unknown as Parameters<typeof mapActiveRunAccount>[0];

    const view = mapActiveRunAccount(account);

    expect(view.runId).toBe(9_007_199_254_740_993n);
    expect(view.rules.pointsRequired).toBe(12_345);
    expect(view.dailyScore).toBe(321);
    expect(view.pressureScore).toBe(144);
    expect(view.dailyScoringRule.id).toBe(14);
    expect(view.endlessThresholds).toEqual(pressure.thresholds);
    expect(view.endlessScoreMultipliersX100).toEqual(
      pressure.scoreMultipliersX100,
    );
    expect(view.endlessRampMultiplierX100).toBe(100);
  });

  it("uses UTC cadence IDs and domains every Daily PDA", () => {
    expect(currentDailyDayId(0)).toBe(0);
    expect(currentDailyDayId(86_399)).toBe(0);
    expect(currentDailyDayId(86_400)).toBe(1);
    const owner = Keypair.generate().publicKey;
    const first = deriveDailyChallengePda(1);
    const second = deriveDailyChallengePda(2);
    expect(first.equals(second)).toBe(false);
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

  it("builds the Star entry path with a bounded session accepted by paymaster policy", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(owner);
    const nowUnix = Math.floor(Date.now() / 1_000);
    const connection = {
      getAccountInfo: vi.fn().mockResolvedValue(null),
    } as unknown as Connection;
    const daily = dailyFixture(owner.publicKey);

    const session = Keypair.generate();
    const prepared = await buildPrepareDailyRunPlan({
      connection,
      wallet,
      session,
      daily,
      paymaster: paymaster.publicKey,
      nowUnix,
    });
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: paymaster.publicKey,
        recentBlockhash: "11111111111111111111111111111111",
        instructions: prepared.transactionPlan.transaction.instructions,
      }).compileToV0Message(),
    );
    transaction.sign([owner, session]);
    expect(
      validatePaymasterTransaction(transaction, paymaster.publicKey, nowUnix),
    ).toBeNull();
  });

  it("uses the canonical 10-Star Daily entry", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(owner);
    const nowUnix = Math.floor(Date.now() / 1_000);
    const connection = {
      getAccountInfo: vi.fn().mockResolvedValue(null),
    } as unknown as Connection;
    const daily = dailyFixture(owner.publicKey);
    const session = Keypair.generate();
    const prepared = await buildPrepareDailyRunPlan({
      connection,
      wallet,
      session,
      daily,
      paymaster: paymaster.publicKey,
      nowUnix,
    });
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: paymaster.publicKey,
        recentBlockhash: "11111111111111111111111111111111",
        instructions: prepared.transactionPlan.transaction.instructions,
      }).compileToV0Message(),
    );
    transaction.sign([owner, session]);
    expect(
      validatePaymasterTransaction(transaction, paymaster.publicKey, nowUnix),
    ).toBeNull();

    expect(prepared.transactionPlan.label).toBe("Enter Daily with 10 Stars");
  });

  it("refunds cancelled entries in Stars", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(owner);
    const connection = {} as Connection;
    const daily = dailyFixture(owner.publicKey);
    const plan = await buildRefundDailyEntryPlan({
      connection,
      wallet,
      daily,
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
    expect(
      validatePaymasterTransaction(transaction, paymaster.publicKey),
    ).toBeNull();
  });

  it("builds permissionless Daily cleanup with rent pinned to the paymaster", async () => {
    const caller = Keypair.generate();
    const player = Keypair.generate().publicKey;
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(caller);
    const daily = { ...dailyFixture(player), status: "claimable" as const };
    const plans = await Promise.all([
      buildCloseDailyPlayerPlan({
        connection: {} as Connection,
        wallet,
        daily,
        owner: player,
        paymaster: paymaster.publicKey,
      }),
      buildCloseDailyChallengePlan({
        connection: {} as Connection,
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
          instructions: plan.transaction.instructions,
        }).compileToV0Message(),
      );
      transaction.sign([caller]);
      expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBeNull();
    }
  });
});

function dailyFixture(owner: PublicKey): DailyView {
  const dayId = currentDailyDayId();
  return {
    address: deriveDailyChallengePda(dayId),
    dayId,
    weekId: Math.max(0, Math.floor((dayId * 86_400 + 259_200) / 604_800)),
    seasonId: 1,
    economyVersion: 2,
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
    scoringRule: {
      id: 1,
      family: 0,
      kind: 0,
      parameter: 0,
      bonusMultiplierX100: 0,
    },
    pressure: decodedPressureFixture(),
    endlessThresholds: [15, 40, 80, 150, 280, 500, 900],
    endlessScoreMultipliersX100: [100, 150, 200, 300, 400, 600, 800, 1_000],
    endlessRampMultiplierX100: 100,
    opensAt: 0,
    entriesCloseAt: 2_000_000_000,
    runsCloseAt: 2_000_000_100,
    settlementGraceCloseAt: 2_000_000_200,
    finalizedAt: 0,
    starEntryCost: 10n,
    uniquePlayers: 1,
    closedPlayers: 0,
    weeklyEligiblePlayers: 1,
    weeklyRollups: 0,
    attemptsStarted: 0n,
    runsFinalized: 0n,
    playerEligible: true,
    playerStars: 20n,
    nextRunId: 1n,
    player: null,
    leaderboard: [
      {
        player: owner,
        receipt: Keypair.generate().publicKey,
        runId: 1n,
        dailyScore: 100,
        engineScore: 90,
        moves: 18,
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

function decodedPressureFixture() {
  return {
    thresholds: [17, 41, 83, 151, 281, 503, 907] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    scoreMultipliersX100: [101, 149, 211, 307, 401, 601, 809, 1_009] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    blockWeights: Array.from({ length: 8 }, () => [20, 20, 20, 20, 20]) as [
      [number, number, number, number, number],
      [number, number, number, number, number],
      [number, number, number, number, number],
      [number, number, number, number, number],
      [number, number, number, number, number],
      [number, number, number, number, number],
      [number, number, number, number, number],
      [number, number, number, number, number],
    ],
    startingHeight: 4,
    maxMoves: 180,
  };
}
