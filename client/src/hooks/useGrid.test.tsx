import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActiveRunView } from "@/chain/runPlan";
import { useGrid } from "./useGrid";

const fixtures = vi.hoisted(() => ({
  activeRun: null as ActiveRunView | null,
}));

vi.mock("@/contexts/run", async () =>
  (await import("@/test/mocks/contexts")).runContextMock(() => ({
    activeRun: fixtures.activeRun,
  })),
);

const projectedRun = (
  runId: bigint,
  lifecycle: ActiveRunView["lifecycle"],
  firstCell: number,
): ActiveRunView =>
  ({
    runId,
    lifecycle,
    grid: [firstCell, ...Array<number>(79).fill(0)],
  }) as ActiveRunView;

describe("useGrid", () => {
  beforeEach(() => {
    fixtures.activeRun = null;
  });

  it("hydrates a run, adopts the terminal board once, freezes, and resets", async () => {
    fixtures.activeRun = projectedRun(1n, "playing", 1);
    const { result, rerender } = renderHook(() =>
      useGrid({ gameId: 1n, shouldLog: false }),
    );

    await waitFor(() => expect(result.current[9]?.[0]).toBe(1));

    // The update that flips the lifecycle terminal carries the FINAL board —
    // it must be adopted, not frozen out (the old behavior displayed a board
    // one move stale and caused the end-of-level snap-back).
    act(() => {
      fixtures.activeRun = projectedRun(1n, "levelComplete", 4);
      rerender();
    });
    expect(result.current[9]?.[0]).toBe(4);

    // Subsequent same-run refreshes while terminal are frozen out so nothing
    // repaints the board underneath the completion presentation.
    act(() => {
      fixtures.activeRun = projectedRun(1n, "levelComplete", 7);
      rerender();
    });
    expect(result.current[9]?.[0]).toBe(4);

    act(() => {
      fixtures.activeRun = null;
      rerender();
    });
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("hydrates a different run even when first observed terminal", async () => {
    fixtures.activeRun = projectedRun(2n, "finished", 3);
    const { result } = renderHook(() =>
      useGrid({ gameId: 2n, shouldLog: false }),
    );

    await waitFor(() => expect(result.current[9]?.[0]).toBe(3));
  });
});
