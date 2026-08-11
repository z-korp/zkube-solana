/**
 * The pressure tier the run is on, and what it multiplies by.
 *
 * The run climbs on the higher of its two pressures: the difficulty the engine
 * has stepped to, and the pressure score it has accumulated. Colours are the
 * ladder's own, from green through to the master amber.
 */
export interface BoardTierStep {
  name: string;
  color: string;
  threshold: number;
  multiplier: number;
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

export function buildTierScale(
  thresholds: readonly number[],
  multipliersX100: readonly number[],
): BoardTierStep[] {
  return NAMES.map((name, index) => ({
    name,
    color: COLORS[index]!,
    threshold:
      index === 0 ? 0 : (thresholds[index - 1] ?? Number.MAX_SAFE_INTEGER),
    multiplier: (multipliersX100[index] ?? 100) / 100,
  }));
}

export function boardTier(
  thresholds: readonly number[],
  multipliersX100: readonly number[],
  currentDifficulty: number,
  pressureScore: number,
): BoardTierStep {
  const scale = buildTierScale(thresholds, multipliersX100);
  const byDifficulty = Math.max(
    0,
    Math.min(currentDifficulty, scale.length - 1),
  );
  let byPressure = 0;
  for (let index = scale.length - 1; index >= 0; index -= 1) {
    if (pressureScore >= scale[index]!.threshold) {
      byPressure = index;
      break;
    }
  }
  return scale[Math.max(byDifficulty, byPressure)]!;
}
