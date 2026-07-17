/**
 * Shared ActiveRun fixtures for vitest suites.
 *
 * Defaults are neutral (zeroed counters, empty board) so each test overrides
 * only the values it asserts on. The returned object mirrors the field set
 * the client suites have always exercised; optional daily-only projections
 * (dailyScore, dailyScoringRule, …) are intentionally left unset exactly like
 * the historical inline fixtures, hence the cast.
 */
import { Keypair } from "@solana/web3.js";

import type { ActiveRunRulesView, ActiveRunView } from "@/chain/runPlan";

export function makeRunRules(
  overrides: Partial<ActiveRunRulesView> = {},
): ActiveRunRulesView {
  return {
    pointsRequired: 10,
    maxMoves: 20,
    difficulty: 0,
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
    ...overrides,
  };
}

export function makeActiveRun(
  overrides: Partial<ActiveRunView> = {},
): ActiveRunView {
  return {
    owner: Keypair.generate().publicKey,
    runId: 1n,
    mode: "campaign",
    dailyChallenge: Keypair.generate().publicKey,
    mapId: 1,
    level: 1,
    rules: makeRunRules(),
    lifecycle: "playing",
    score: 0,
    actionCounter: 0,
    moves: 0,
    comboCounter: 0,
    maxCombo: 0,
    primaryProgress: 0,
    secondaryProgress: 0,
    levelLinesCleared: 0,
    totalLinesCleared: 0,
    bonusUses: 0,
    currentDifficulty: 1,
    endlessThresholds: [1, 2, 3, 4, 5, 6, 7],
    endlessScoreMultipliersX100: [100, 100, 100, 100, 100, 100, 100, 100],
    bonusType: 0,
    bonusCharges: 0,
    grid: Array.from({ length: 80 }, () => 0),
    nextRow: Array.from({ length: 8 }, () => 0),
    pendingVrfCounter: 0,
    ...overrides,
  } as ActiveRunView;
}
