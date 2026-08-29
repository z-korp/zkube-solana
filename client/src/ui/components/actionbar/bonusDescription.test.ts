// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildTriggerDescription } from "./bonusDescription";

describe("campaign bonus descriptions", () => {
  it("describes every fixed campaign trigger family", () => {
    expect(buildTriggerDescription(1, 3)).toBe("Clear 3+ lines in a move");
    expect(buildTriggerDescription(2, 15)).toBe("Every 15 lines cleared by moves");
    expect(buildTriggerDescription(4, 3)).toBe("Clear exactly 3 lines in a move");
    expect(buildTriggerDescription(6, 0)).toBe("Break every size in one move");
    expect(buildTriggerDescription(7, 3)).toBe("Every 3 combos");
    expect(buildTriggerDescription(8, 6)).toBe("Break 6+ blocks in one move");
    expect(buildTriggerDescription(9, 3)).toBe("Clear a line 3 moves in a row");
  });
});
