import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import type { ActiveRunView } from "@/chain/runPlan";
import {
  canSettleTerminalRun,
  pendingCompletionFromRun,
  projectRunResult,
  settleStageLabel,
} from "./usePlayController";

const activeRun = (): ActiveRunView => ({
  owner: Keypair.generate().publicKey,
  runId: 5n,
  mode: "campaign",
  dailyChallenge: Keypair.generate().publicKey,
  mapId: 2,
  level: 3,
  rules: {
    pointsRequired: 100,
    maxMoves: 20,
    difficulty: 2,
    primary: { kind: 1, value: 2, requiredCount: 3 },
    secondary: { kind: 0, value: 0, requiredCount: 0 },
    activeMutatorId: 1,
    passiveMutatorId: 2,
    bossId: 0,
    starThresholdModifier: 128,
    bonusType: 1,
    bonusTriggerType: 2,
    bonusThreshold: 3,
    startingCharges: 1,
  },
  lifecycle: "levelComplete",
  score: 110,
  actionCounter: 4,
  moves: 8,
  comboCounter: 2,
  maxCombo: 4,
  primaryProgress: 3,
  secondaryProgress: 0,
  levelLinesCleared: 5,
  totalLinesCleared: 9,
  bonusUses: 1,
  currentDifficulty: 2,
  endlessThresholds: [15, 40, 80, 150, 280, 500, 900],
  endlessScoreMultipliersX100: [100, 150, 200, 300, 400, 600, 800, 1_000],
  bonusType: 1,
  bonusCharges: 2,
  grid: Array.from({ length: 80 }, () => 0),
  nextRow: Array.from({ length: 8 }, () => 0),
  pendingVrfCounter: 0,
});

describe("play controller projections", () => {
  it("returns the authoritative board result to Grid", () => {
    expect(projectRunResult(activeRun())).toMatchObject({
      over: true,
      nextRow: Array.from({ length: 8 }, () => 0),
    });
  });

  it("snapshots pending completion before settlement", () => {
    expect(pendingCompletionFromRun(activeRun())).toMatchObject({
      level: 3,
      levelMoves: 8,
      totalScore: 110,
      isIncomplete: false,
      xpAwarded: 30,
      gameLevel: {
        gameId: 5n,
        pointsRequired: 100,
        star3Threshold: 10,
        star2Threshold: 15,
      },
    });
  });

  it("shows only the lifetime star improvement after settlement", () => {
    expect(pendingCompletionFromRun(activeRun(), 1).xpAwarded).toBe(20);
    expect(pendingCompletionFromRun(activeRun(), 3).xpAwarded).toBe(0);
    expect(
      pendingCompletionFromRun(
        { ...activeRun(), lifecycle: "finished" },
        0,
      ).xpAwarded,
    ).toBe(0);
    expect(
      pendingCompletionFromRun({ ...activeRun(), mode: "daily" }, 0)
        .xpAwarded,
    ).toBe(0);
  });

  it("exposes each auto-settlement stage", () => {
    expect(settleStageLabel("committing")).toBe("Committing to Solana…");
    expect(settleStageLabel("settling")).toBe("Waiting for base copyback…");
    expect(settleStageLabel("cleaning")).toBe("Cleaning up settled run…");
  });

  it("waits for session renewal before committing a delegated terminal run", () => {
    expect(canSettleTerminalRun("delegated", false)).toBe(false);
    expect(canSettleTerminalRun("delegated", true)).toBe(true);
    expect(canSettleTerminalRun("settleable", false)).toBe(true);
    expect(canSettleTerminalRun("base", true)).toBe(false);
    expect(canSettleTerminalRun("settleable", true, 1n)).toBe(false);
    expect(canSettleTerminalRun("delegated", true, 1n)).toBe(false);
  });
});

describe("describeRunStartError", () => {
  it("maps a dry player-funding simulation to renewal guidance", async () => {
    const { describeRunStartError } = await import("./usePlayController");
    const raw =
      'Simulation failed for Prepare campaign run: {"InstructionError":[4,{"Custom":1}]}';
    const described = describeRunStartError(raw);
    expect(described.headline).toBe(
      "This device's zKube fee allowance is low — renew zKube to keep playing.",
    );
    expect(described.detail).toBe(raw);
  });

  it("maps InsufficientFundsForRent to the same renewal guidance", async () => {
    const { describeRunStartError } = await import("./usePlayController");
    const described = describeRunStartError(
      'Simulation failed for Prepare and delegate active run: {"InsufficientFundsForRent":{"account_index":0}}',
    );
    expect(described.kind).toBe("deviceSessionRenewal");
    expect(described.headline).toContain("renew zKube");
  });

  it("maps an authoritative active-run conflict to resume guidance", async () => {
    const { describeRunStartError } = await import("./usePlayController");
    const described = describeRunStartError(
      "Run 15 is already active. Resume or abandon it before starting another.",
    );
    expect(described.kind).toBe("activeRunExists");
    expect(described.headline).toContain("Resume or abandon");
  });

  it("passes ordinary errors through unchanged", async () => {
    const { describeRunStartError } = await import("./usePlayController");
    const described = describeRunStartError("Map 3 is locked");
    expect(described.headline).toBe("Map 3 is locked");
    expect(described.detail).toBeNull();
  });
});
