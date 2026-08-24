// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  dailyContentSelection,
  dailyIsScheduled,
  nextScheduledDaily,
} from "./dailyRules";
import { DAILY_POOL_CAPACITY } from "./protocolVersions.generated";

describe("v5 Daily content pool", () => {
  it("draws a full reproducible cycle and resolves any future day", async () => {
    const startsDay = 20_000;
    const selected = await Promise.all(
      Array.from({ length: 10 }, (_, offset) =>
        dailyContentSelection(startsDay, startsDay + offset, 10)),
    );
    expect(selected.map(({ poolIndex }) => poolIndex)).toEqual([
      6, 2, 1, 9, 0, 4, 3, 7, 8, 5,
    ]);
    expect(new Set(selected.map(({ poolIndex }) => poolIndex)).size).toBe(10);
    const nextCycle = await Promise.all(
      Array.from({ length: 10 }, (_, offset) =>
        dailyContentSelection(startsDay, startsDay + 10 + offset, 10)),
    );
    expect(new Set(nextCycle.map(({ poolIndex }) => poolIndex)).size).toBe(10);
    expect(nextCycle).not.toEqual(selected);
    expect(await dailyContentSelection(startsDay, startsDay + 1, 10))
      .toEqual(selected[1]);
    expect(await dailyContentSelection(startsDay - 7, startsDay + 1, 10))
      .toEqual(selected[1]);
  });

  it("represents suspensions as an explicit empty or not-yet-started catalog", () => {
    expect(dailyIsScheduled(20_000, 20_000, 0)).toBe(false);
    expect(() => nextScheduledDaily(20_000, 20_000, 0)).toThrow(
      "no paid Daily",
    );
    expect(dailyIsScheduled(20_005, 20_010, 10)).toBe(false);
    expect(nextScheduledDaily(20_005, 20_010, 10)).toBe(20_010);
  });

  it("draws every entry at the raised capacity", async () => {
    const startsDay = DAILY_POOL_CAPACITY * 200;
    const selected = await Promise.all(
      Array.from({ length: DAILY_POOL_CAPACITY }, (_, offset) =>
        dailyContentSelection(
          startsDay,
          startsDay + offset,
          DAILY_POOL_CAPACITY,
        )),
    );
    expect(new Set(selected.map(({ poolIndex }) => poolIndex)).size).toBe(
      DAILY_POOL_CAPACITY,
    );
  });
});
