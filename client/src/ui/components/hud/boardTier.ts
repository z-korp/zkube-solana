/**
 * The pressure tier the run is on, and what it multiplies by.
 *
 * The score multiplier keeps climbing after the authored row danger reaches
 * its top name and colour.
 */
import { PRESSURE_STEP } from "@/chain/protocolVersions.generated";

export interface BoardTierStep {
  index: number;
  name: string;
  color: string;
  threshold: number;
  multiplier: number;
  pointsToNext: number;
  nextMultiplier: number;
}

const NAMES = [
  "Very Easy",
  "Easy",
  "Medium",
  "Medium Hard",
  "Hard",
  "Very Hard",
  "Expert",
  "Master",
] as const;

const COLORS = [
  "#22c55e",
  "#84cc16",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#dc2626",
  "#9333ea",
  "#f59e0b",
] as const;

export function boardTier(pressureScore: number): BoardTierStep {
  const score = Math.max(0, Math.floor(pressureScore));
  const index = Math.floor(score / PRESSURE_STEP);
  const namedIndex = Math.min(index, NAMES.length - 1);
  const multiplier = 1 + index * 0.5;
  return {
    index,
    name: NAMES[namedIndex]!,
    color: COLORS[namedIndex]!,
    threshold: index * PRESSURE_STEP,
    multiplier,
    pointsToNext: (index + 1) * PRESSURE_STEP - score,
    nextMultiplier: multiplier + 0.5,
  };
}
