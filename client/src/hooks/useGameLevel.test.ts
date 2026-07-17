// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { ActiveRunRulesView } from "@/chain/runPlan";
import { rulesToGameLevelData } from "./useGameLevel";

const rules: ActiveRunRulesView = {
  pointsRequired: 120,
  maxMoves: 40,
  difficulty: 3,
  primary: { kind: 1, value: 3, requiredCount: 2 },
  secondary: { kind: 2, value: 4, requiredCount: 8 },
  activeMutatorId: 9,
  passiveMutatorId: 7,
  bossId: 2,
  starThresholdModifier: 128,
  bonusType: 1,
  bonusTriggerType: 2,
  bonusThreshold: 4,
  startingCharges: 1,
};

describe("rulesToGameLevelData", () => {
  it("projects every authoritative rule and Rust-parity star threshold", () => {
    expect(rulesToGameLevelData(rules, 6, 42n)).toEqual({
      gameId: 42n,
      level: 6,
      pointsRequired: 120,
      maxMoves: 40,
      difficulty: 3,
      constraintType: 1,
      constraintValue: 3,
      constraintCount: 2,
      constraint2Type: 2,
      constraint2Value: 4,
      constraint2Count: 8,
      mutatorId: 7,
      star3Threshold: 20,
      star2Threshold: 30,
    });
  });

  it.each([
    [127, 22, 32],
    [128, 20, 30],
    [129, 18, 28],
  ])("tracks modifier %i", (modifier, star3Threshold, star2Threshold) => {
    expect(
      rulesToGameLevelData({ ...rules, starThresholdModifier: modifier }, 1),
    ).toMatchObject({ star3Threshold, star2Threshold });
  });
});
