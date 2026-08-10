// @vitest-environment node
import { describe, expect, it } from "vitest";

import { chaseTarget, type FieldStandings } from "./chase";

const standings = (scoreGap: number, themeGap: number | null): FieldStandings => ({
  score: { rank: 4, entrants: 147, gapToNext: scoreGap },
  theme: themeGap === null ? null : { rank: 2, entrants: 61, gapToNext: themeGap },
});

describe("what the rail chases", () => {
  it("chases Score alone until the run is on the Theme board", () => {
    // The Theme board has a positive-metric gate, so a run that has not scored
    // an objective point is not on it and cannot be chasing a place there.
    const target = chaseTarget(standings(2_000, null), 24_180, 0, null);
    expect(target).toEqual({
      board: "score",
      standing: { rank: 4, entrants: 147, gapToNext: 2_000 },
    });
  });

  it("compares gaps against what each board has earned, not in raw points", () => {
    // 2,000 of 24,180 is 8%; 300 of 5,730 is 5%. The Theme place is nearer
    // despite being the far smaller number, which raw points would invert.
    expect(chaseTarget(standings(2_000, 300), 24_180, 5_730, null)?.board).toBe(
      "theme",
    );
    expect(chaseTarget(standings(200, 3_000), 24_180, 5_730, null)?.board).toBe(
      "score",
    );
  });

  it("holds its target until the other board is clearly cheaper", () => {
    // Theme is nearer, but not by enough: a rail that switched here would flip
    // colour on almost every clear.
    const marginal = chaseTarget(standings(2_000, 420), 24_180, 5_730, "score");
    expect(marginal?.board).toBe("score");

    // Decisively cheaper, so it switches.
    const decisive = chaseTarget(standings(2_000, 120), 24_180, 5_730, "score");
    expect(decisive?.board).toBe("theme");
  });

  it("never invents a target without live standings", () => {
    // A rank quoted next to real SOL must come from data, never from a default.
    expect(chaseTarget(null, 24_180, 5_730, "score")).toBeNull();
  });
});
