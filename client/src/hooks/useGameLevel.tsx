import { useMemo } from "react";

import { useRun } from "@/contexts/run";
import { ConstraintType } from "@/game/constraint";
import { applyStarThresholdModifier } from "@/game/level";
import type { ActiveRunRulesView } from "@/chain/runPlan";

export interface GameLevelData {
  gameId: bigint;
  level: number;
  pointsRequired: number;
  maxMoves: number;
  difficulty: number;
  constraintType: ConstraintType;
  constraintValue: number;
  constraintCount: number;
  constraint2Type: ConstraintType;
  constraint2Value: number;
  constraint2Count: number;
  mutatorId: number;
  star3Threshold: number;
  star2Threshold: number;
}

export function rulesToGameLevelData(
  rules: ActiveRunRulesView,
  level: number,
  gameId = 0n,
): GameLevelData {
  const { star3Pct, star2Pct } = applyStarThresholdModifier(
    rules.starThresholdModifier,
  );
  return {
    gameId,
    level,
    pointsRequired: rules.pointsRequired,
    maxMoves: rules.maxMoves,
    difficulty: rules.difficulty,
    constraintType: rules.primary.kind as ConstraintType,
    constraintValue: rules.primary.value,
    constraintCount: rules.primary.requiredCount,
    constraint2Type: rules.secondary.kind as ConstraintType,
    constraint2Value: rules.secondary.value,
    constraint2Count: rules.secondary.requiredCount,
    mutatorId: rules.passiveMutatorId,
    star3Threshold: Math.floor((rules.maxMoves * star3Pct) / 100),
    star2Threshold: Math.floor((rules.maxMoves * star2Pct) / 100),
  };
}

export const useGameLevel = ({
  gameId,
}: {
  gameId: bigint | undefined;
}): GameLevelData | null => {
  const run = useRun();
  return useMemo(() => {
    const active = run.activeRun;
    if (!active) return null;
    return rulesToGameLevelData(
      active.rules,
      active.level,
      gameId ?? active.runId,
    );
  }, [gameId, run.activeRun]);
};
