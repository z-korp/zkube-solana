// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildTriggerDescription } from "./bonusDescription";

describe("campaign bonus descriptions", () => {
  it("describes every fixed campaign trigger family", () => {
    expect(buildTriggerDescription(1, 3, 1))
      .toBe("Clear 3+ lines in a move · Start with 1");
    expect(buildTriggerDescription(2, 15, 1))
      .toBe("Every 15 lines cleared by moves · Start with 1");
    expect(buildTriggerDescription(3, 100, 1))
      .toBe("Charge when a move carries your score past each 100 points · Start with 1");
    expect(buildTriggerDescription(4, 3, 1))
      .toBe("Clear exactly 3 lines in a move · Start with 1");
    expect(buildTriggerDescription(5, 0, 1))
      .toBe("Perfect clear · max 1 charge between moves · Start with 1");
    expect(buildTriggerDescription(6, 0, 1))
      .toBe("Destroy block sizes 1–4 in one move · Start with 1");
    expect(buildTriggerDescription(7, 8, 1))
      .toBe("Every 8 Combo Meter points · max 1 per action · Start with 1");
  });

  it("includes starting charges even for zero-threshold triggers", () => {
    expect(buildTriggerDescription(5, 0, 2)).toContain("Start with 2");
  });
});
