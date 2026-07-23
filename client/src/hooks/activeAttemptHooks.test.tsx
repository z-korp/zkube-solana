import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useActiveDailyAttempt } from "./useActiveDailyAttempt";
import { useActiveStoryAttempt } from "./useActiveStoryAttempt";

const fixture = vi.hoisted(() => ({
  run: {
    phase: "none",
    activeRun: null as null | {
      runId: bigint;
      mode: string;
      mapId: number;
      level: number;
    },
    receipt: null,
    campaign: null as unknown,
    arcade: null as unknown,
  },
}));

fixture.run.campaign = fixture.run;
fixture.run.arcade = fixture.run;

vi.mock("@/contexts/run", async () =>
  (await import("@/test/mocks/contexts")).runContextMock(fixture.run),
);

describe("authoritative active-attempt projection", () => {
  beforeEach(() => {
    fixture.run.phase = "none";
    fixture.run.activeRun = null;
    fixture.run.receipt = null;
  });

  it("exposes a prepared campaign run without relying on browser storage", () => {
    fixture.run.phase = "base";
    fixture.run.activeRun = {
      runId: 1n,
      mode: "campaign",
      mapId: 1,
      level: 1,
    };

    const { result } = renderHook(() => useActiveStoryAttempt());

    expect(result.current).toEqual({
      gameId: 1n,
      zoneId: 1,
      level: 1,
      settled: false,
    });
  });

  it("exposes a prepared Daily run without relying on browser storage", () => {
    fixture.run.phase = "base";
    fixture.run.activeRun = {
      runId: 2n,
      mode: "daily",
      mapId: 3,
      level: 1,
    };

    const { result } = renderHook(() => useActiveDailyAttempt());

    expect(result.current).toEqual({
      gameId: 2n,
      level: 1,
      mode: "daily",
      isReplay: false,
      settled: false,
    });
  });

  it("projects Campaign progress only from the Campaign slot", () => {
    fixture.run.phase = "base";
    fixture.run.activeRun = {
      runId: 3n,
      mode: "practice",
      mapId: 8,
      level: 1,
    };

    const story = renderHook(() => useActiveStoryAttempt());
    const arcade = renderHook(() => useActiveDailyAttempt());

    expect(story.result.current).toBeNull();
    expect(arcade.result.current).toMatchObject({
      gameId: 3n,
      mode: "practice",
    });
  });
});
