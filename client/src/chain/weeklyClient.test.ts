// @vitest-environment node
import { describe, expect, it } from "vitest";

import { currentWeeklyId, weekStartDay } from "./weeklyClient";

describe("Weekly period projection", () => {
  it("matches zkube-core's zero-based Monday-aligned weeks", () => {
    expect(currentWeeklyId(4 * 86_400)).toBe(0);
    expect(currentWeeklyId(10 * 86_400 + 86_399)).toBe(0);
    expect(currentWeeklyId(11 * 86_400)).toBe(1);
    expect(weekStartDay(0)).toBe(4);
    expect(weekStartDay(1)).toBe(11);
  });
});
