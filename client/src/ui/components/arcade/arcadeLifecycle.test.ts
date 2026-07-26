// @vitest-environment node
import { describe, expect, it } from "vitest";

import { computeArcadeLifecycle } from "./arcadeLifecycle";

const DAY = 20_651;
const START = DAY * 86_400;

const daily = (
  status: "funding" | "open" | "finalized" | "unknown",
  dayId = DAY,
) => ({
  dayId,
  status,
  opensAt: START,
  entriesCloseAt: START + 23 * 60 * 60 + 45 * 60,
});

describe("Arcade Daily lifecycle", () => {
  it("keeps the normal post-midnight preparation grace", () => {
    expect(computeArcadeLifecycle({
      view: daily("funding"),
      hasActiveRun: false,
      nowUnix: START + 14 * 60,
    })).toBe("preparing");
  });

  it("calls out a missing or funding Daily after the grace window", () => {
    expect(computeArcadeLifecycle({
      view: null,
      hasActiveRun: false,
      nowUnix: START + 15 * 60,
    })).toBe("delayed");
    expect(computeArcadeLifecycle({
      view: daily("funding"),
      hasActiveRun: false,
      nowUnix: START + 20 * 60,
    })).toBe("delayed");
  });

  it("distinguishes a retained previous Daily from a missing current one", () => {
    expect(computeArcadeLifecycle({
      view: daily("finalized", DAY - 1),
      hasActiveRun: false,
      nowUnix: START + 60,
    })).toBe("stale");
  });

  it("does not mistake a preloaded following Daily for today's challenge", () => {
    expect(computeArcadeLifecycle({
      view: daily("funding", DAY + 1),
      hasActiveRun: false,
      nowUnix: START + 20 * 60,
    })).toBe("delayed");
  });

  it("preserves resume and paid-entry precedence", () => {
    expect(computeArcadeLifecycle({
      view: null,
      hasActiveRun: true,
      nowUnix: START + 60 * 60,
    })).toBe("resume");
    expect(computeArcadeLifecycle({
      view: daily("open"),
      hasActiveRun: false,
      nowUnix: START + 60 * 60,
    })).toBe("entries-open");
  });
});
