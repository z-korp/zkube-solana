// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseDailyStatus } from "@/chain/dailyClient";

describe("Daily projection", () => {
  it("rejects unknown decoded Daily status variants", () => {
    expect(parseDailyStatus({ open: {} })).toBe("open");
    expect(parseDailyStatus({ settled: {} })).toBe("unknown");
    expect(parseDailyStatus("open")).toBe("unknown");
  });
});
