/**
 * The pressure tier ladder, shared by the HUD prototypes.
 *
 * A copy of the one inside `GameHud`, deliberately: the prototypes are here to
 * be thrown away or promoted, and reaching into the shipped HUD for it would
 * couple the thing being replaced to the things replacing it. Whichever
 * prototype wins takes this with it and the original goes.
 */
export interface TierStep {
  name: string;
  color: string;
  threshold: number;
  multiplier: number;
}

const TIER_NAMES = [
  "Very Easy",
  "Easy",
  "Medium",
  "Medium Hard",
  "Hard",
  "Very Hard",
  "Expert",
  "Master",
] as const;

const TIER_COLORS = [
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
): TierStep[] {
  return TIER_NAMES.map((name, index) => ({
    name,
    color: TIER_COLORS[index]!,
    threshold: index === 0 ? 0 : (thresholds[index - 1] ?? Number.MAX_SAFE_INTEGER),
    multiplier: (multipliersX100[index] ?? 100) / 100,
  }));
}

/** Which step the run is on: the higher of its difficulty and its pressure. */
export function currentTierIndex(
  scale: readonly TierStep[],
  currentDifficulty: number,
  pressureScore: number,
): number {
  const byDifficulty = Math.max(0, Math.min(currentDifficulty, scale.length - 1));
  let byPressure = 0;
  for (let index = scale.length - 1; index >= 0; index -= 1) {
    if (pressureScore >= scale[index]!.threshold) {
      byPressure = index;
      break;
    }
  }
  return Math.max(byDifficulty, byPressure);
}
