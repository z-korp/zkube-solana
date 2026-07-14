import { describe, expect, it } from "vitest";

import { constraintDescription, estimateStars } from "./runDisplay";

describe("runDisplay", () => {
  it("uses the archived star-threshold projection", () => {
    expect(estimateStars(20, 10, 128)).toBe(3);
    expect(estimateStars(20, 15, 128)).toBe(2);
    expect(estimateStars(20, 16, 128)).toBe(1);
  });

  it("describes each on-chain constraint kind", () => {
    expect(
      constraintDescription({
        kind: 1,
        value: 2,
        requiredCount: 3,
      }),
    ).toBe("Clear 2+ lines in one move 3 times");
    expect(
      constraintDescription({
        kind: 2,
        value: 4,
        requiredCount: 12,
      }),
    ).toBe("Break 12 blocks of size 4");
    expect(
      constraintDescription({
        kind: 3,
        value: 5,
        requiredCount: 0,
      }),
    ).toBe("Reach 5 on the Combo Meter");
  });
});
