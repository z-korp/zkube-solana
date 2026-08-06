/**
 * Display-time mirror of the Season banding table: each finalized Daily pays
 * one band result per wallet (best 20 count toward the Season).
 *
 *   Top 1%, capped at rank 3   → 100
 *   Top 5%, capped at rank 10  →  60
 *   Top 10%, capped at rank 20 →  30
 *   Top 25%, capped at rank 50 →  10
 *   Another scoreable result   →   2
 *
 * Presentational only — settlement computes the authoritative bands on chain;
 * this is the "what today's rank is worth" teaser on the Arcade floor.
 */
export function seasonPointsForDailyRank(
  rank: number,
  scoreablePlayers: number,
): number {
  if (rank <= 0 || scoreablePlayers <= 0) return 0;
  const within = (percent: number, cap: number) =>
    rank <= Math.min(cap, Math.max(1, Math.floor(scoreablePlayers * percent)));
  if (within(0.01, 3)) return 100;
  if (within(0.05, 10)) return 60;
  if (within(0.1, 20)) return 30;
  if (within(0.25, 50)) return 10;
  return 2;
}
