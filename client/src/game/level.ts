/** Convert the authored modifier into the legacy move-budget display caps. */
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
