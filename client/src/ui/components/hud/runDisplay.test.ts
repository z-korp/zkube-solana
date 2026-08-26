// @vitest-environment node
import { describe, expect, it } from "vitest";

import { constraintDescription } from "./runDisplay";

describe("runDisplay", () => {
  it("describes each on-chain constraint kind", () => {
    const cases: Array<[number, number, number, string]> = [
      [1, 3, 2, "Make 2 3-line combos"],
      [2, 4, 12, "Break 12 blocks of width 4"],
      [3, 0, 12, "Clear 12 lines"],
      [4, 2, 4, "Make 4 exact 2-line combos"],
      [5, 30, 3, "Make 3 moves worth 30+ points"],
      [6, 0, 3, "Wake the guardian 3 times"],
      [7, 0, 3, "Clear 3 bonus lines"],
      [8, 0, 10, "Smash 10 blocks with bonuses"],
      [9, 4, 1, "Clear 4 lines at once"],
      [10, 3, 1, "Clear exactly 3 lines at once"],
      [11, 1, 5, "Clear a line 5 moves in a row"],
      [12, 1, 10, "Break 10 blocks of width 1 at once"],
      [13, 0, 1, "Break every width at once"],
      [14, 40, 1, "Make a 40-point move"],
      [15, 2, 1, "Clear 2 lines with one bonus"],
      [16, 0, 1, "Empty the board"],
    ];
    for (const [kind, value, requiredCount, expected] of cases) {
      expect(constraintDescription({ kind, value, requiredCount })).toBe(expected);
    }
  });
});
