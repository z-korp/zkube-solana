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
  bossId: 2,
  guardian: { bonus: 1, trigger: 2, threshold: 4 },
};

describe("rulesToGameLevelData", () => {
  it("projects every authoritative level rule", () => {
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
    });
  });
});
