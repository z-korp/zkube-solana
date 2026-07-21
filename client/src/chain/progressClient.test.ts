// @vitest-environment node
import { describe, expect, it } from "vitest";

import { progressCadenceIds } from "./progressClient";

describe("progress cadence projection", () => {
  it("shares the zero-based zkube-core Monday cadence", () => {
    expect(progressCadenceIds(4 * 86_400)).toEqual({ day: 4, week: 0 });
    expect(progressCadenceIds(10 * 86_400 + 86_399)).toEqual({
      day: 10,
      week: 0,
    });
    expect(progressCadenceIds(11 * 86_400)).toEqual({ day: 11, week: 1 });
  });
});
