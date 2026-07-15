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

export const CAMPAIGN_LEVEL_XP_PER_STAR = 10;

export function calculateLevelStars(args: {
  movesUsed: number;
  star3UsedCap: number;
  star2UsedCap: number;
  isIncomplete: boolean;
}): number {
  if (args.isIncomplete) return 0;
  if (args.movesUsed <= args.star3UsedCap) return 3;
  if (args.movesUsed <= args.star2UsedCap) return 2;
  return 1;
}

/**
 * Mirror the program's improvement-only campaign reward for display. The
 * result is shown only after settlement succeeds; the program remains the
 * authoritative source of the credited XP.
 */
export function calculateCampaignXpAwarded(
  previousBestStars: number,
  achievedStars: number,
): number {
  const previous = Math.max(0, Math.min(3, Math.trunc(previousBestStars)));
  const achieved = Math.max(0, Math.min(3, Math.trunc(achievedStars)));
  return Math.max(0, achieved - previous) * CAMPAIGN_LEVEL_XP_PER_STAR;
}
