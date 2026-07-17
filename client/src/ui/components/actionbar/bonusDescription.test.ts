// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildTriggerDescription } from "./bonusDescription";

describe("campaign bonus descriptions", () => {
  it("describes every fixed campaign trigger family", () => {
    expect(buildTriggerDescription(1, 3, 1)).toContain("3+ lines");
    expect(buildTriggerDescription(2, 15, 1)).toContain("15 lines cleared by moves");
    expect(buildTriggerDescription(4, 3, 1)).toContain("exactly 3 lines");
    expect(buildTriggerDescription(5, 0, 1)).toContain("Perfect clear");
    expect(buildTriggerDescription(6, 0, 1)).toContain("sizes 1–4");
    expect(buildTriggerDescription(7, 8, 1)).toContain("8 Combo Meter points");
  });

  it("includes starting charges even for zero-threshold triggers", () => {
    expect(buildTriggerDescription(5, 0, 2)).toContain("Start with 2");
  });
});
