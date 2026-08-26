import { afterEach, describe, expect, it, vi } from "vitest";

import { makeActiveRun, makeRunRules } from "@/test/fixtures/activeRun";

import {
  PLAYTEST_ACTION_EVENT,
  buildPlaytestActionRecord,
  logAcceptedPlaytestAction,
} from "./playtestActionLogger";

function gridWithRows(...rows: number[][]): number[] {
  return rows.flatMap((row) => [...row]);
}

describe("dev playtest action logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records one accepted action from authoritative snapshots", () => {
    const rules = makeRunRules({
      primary: { kind: 2, value: 3, requiredCount: 4 },
      secondary: { kind: 5, value: 2, requiredCount: 1 },
    });
    const before = makeActiveRun({
      runId: 42n,
      mapId: 3,
      level: 7,
      rules,
      actionCounter: 8,
      totalLinesCleared: 11,
      bonusType: 2,
      bonusCharges: 1,
      rerollCharges: 1,
      primaryProgress: 2,
      secondaryProgress: 0,
      grid: gridWithRows([1, 0, 0, 0, 0, 0, 0, 0], [0, 2, 0, 0, 0, 0, 0, 0]),
      nextRow: [1, 1, 0, 0, 0, 0, 0, 0],
    });
    const after = makeActiveRun({
      ...before,
      actionCounter: 9,
      totalLinesCleared: 13,
      primaryProgress: 4,
      secondaryProgress: 1,
      grid: gridWithRows(
        [1, 0, 0, 0, 0, 0, 0, 0],
        [0, 2, 0, 0, 0, 0, 0, 0],
        [0, 0, 3, 0, 0, 0, 0, 0],
      ),
      nextRow: [0, 0, 4, 4, 0, 0, 0, 0],
    });

    expect(buildPlaytestActionRecord(before, after, "move")).toEqual({
      schemaVersion: 1,
      event: PLAYTEST_ACTION_EVENT,
      runId: "42",
      mode: "campaign",
      mapId: 3,
      level: 7,
      action: "move",
      actionIndex: 9,
      heightBefore: 2,
      heightAfter: 3,
      totalLinesBefore: 11,
      totalLinesAfter: 13,
      linesCleared: 2,
      bonusAvailable: true,
      bonusUsed: false,
      rerollCharges: 1,
      rerollUsed: false,
      visiblePreviewRow: [1, 1, 0, 0, 0, 0, 0, 0],
      constraints: {
        primary: {
          kind: 2,
          value: 3,
          requiredCount: 4,
          before: 2,
          after: 4,
        },
        secondary: {
          kind: 5,
          value: 2,
          requiredCount: 1,
          before: 0,
          after: 1,
        },
      },
    });
  });

  it("writes one JSON line for an accepted action and none for a rejection", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const before = makeActiveRun({ actionCounter: 2 });
    const after = makeActiveRun({ ...before, actionCounter: 3 });

    logAcceptedPlaytestAction(before, after, "reroll");
    logAcceptedPlaytestAction(after, after, "reroll");

    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      event: PLAYTEST_ACTION_EVENT,
      action: "reroll",
      actionIndex: 3,
      rerollUsed: true,
    });
  });
});
