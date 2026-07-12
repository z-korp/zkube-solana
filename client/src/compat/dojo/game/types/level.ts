/**
 * Convert the on-chain star-threshold modifier into move-budget percentages.
 *
 * This mirrors `calculate_level_stars` in the deployed Solana program. A
 * modifier of 128 is neutral; larger values make the thresholds stricter and
 * smaller values make them more forgiving, in five-point increments.
 */
export function applyStarThresholdModifier(modifier: number): {
  star3Pct: number;
  star2Pct: number;
} {
  const positive = modifier >= 128;
  const magnitude = positive ? modifier - 128 : 128 - modifier;
  const change = magnitude * 5;
  const star3Pct = positive
    ? Math.max(10, 50 - change)
    : Math.min(90, 50 + change);
  const star2Pct = positive
    ? Math.max(star3Pct + 1, 75 - change)
    : Math.min(99, 75 + change);

  return { star3Pct, star2Pct };
}
