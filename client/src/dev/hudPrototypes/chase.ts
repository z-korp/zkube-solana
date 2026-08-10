/**
 * Which board the in-run rail is chasing.
 *
 * One rail cannot chase two ladders, and a daily run is ranked on both Score
 * and Theme at once. It therefore chases whichever place is nearest to being
 * taken, which keeps the target winnable rather than decorative.
 */

export interface FieldStanding {
  rank: number;
  entrants: number;
  /** Points still needed to take the place above. */
  gapToNext: number;
}

export interface FieldStandings {
  score: FieldStanding;
  /**
   * Absent until the run has scored an objective point: the Theme board has a
   * positive-metric gate, so a run at zero is not on that board at all.
   */
  theme: FieldStanding | null;
}

export interface ChaseTarget {
  board: "score" | "theme";
  standing: FieldStanding;
}

/** How much of what you already earned on a board the next place costs. */
function relativeCost(gap: number, earned: number): number {
  return gap / Math.max(1, earned);
}

/**
 * Pick the target.
 *
 * Comparing raw gaps would be meaningless — a Score gap runs to tens of
 * thousands where a Theme gap is hundreds — so each is measured against what
 * the run has already earned on its own board. Switching boards requires the
 * challenger to be a fifth cheaper than the incumbent; without that hysteresis
 * the rail flips colour on almost every clear.
 */
export function chaseTarget(
  standings: FieldStandings | null,
  score: number,
  themeScore: number,
  previous: "score" | "theme" | null,
): ChaseTarget | null {
  if (!standings) return null;
  if (!standings.theme) return { board: "score", standing: standings.score };

  const scoreCost = relativeCost(standings.score.gapToNext, score);
  const themeCost = relativeCost(standings.theme.gapToNext, themeScore);
  const cheaper: "score" | "theme" = themeCost < scoreCost ? "theme" : "score";

  if (previous && previous !== cheaper) {
    const challenger = cheaper === "theme" ? themeCost : scoreCost;
    const held = cheaper === "theme" ? scoreCost : themeCost;
    if (challenger > held * 0.8) {
      return {
        board: previous,
        standing: previous === "theme" ? standings.theme : standings.score,
      };
    }
  }
  return {
    board: cheaper,
    standing: cheaper === "theme" ? standings.theme : standings.score,
  };
}
