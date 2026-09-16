// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  dailyWindow, dayIdAt, scheduledDailyWindow, nextScheduledDaily,
  compareBoardEntries,
} from "../src/zkubeCore.js";

describe("generated Node zkube-core boundary", () => {
  it("keeper_rule_boundaries_use_the_core_at_day_and_ordering_limits", () => {
    for (const day of [0, 1, 20_000, 0xffff_ffff]) {
      const window = dailyWindow(day);
      expect(dayIdAt(BigInt(window.opensAt))).toBe(day);
      expect(window.runsCloseAt - window.opensAt).toBe(86_340);
      expect(window.recoveryDeadlineAt - window.runsCloseAt).toBe(21_600);
    }
    expect(() => dayIdAt(-1n)).toThrow();
    expect(() => dayIdAt(0x1_0000_0000n * 86_400n)).toThrow();
    expect(scheduledDailyWindow(10, 20)).toEqual({ first: 20, following: 21 });
    expect(nextScheduledDaily(10, 20)).toBe(20);
    expect(nextScheduledDaily(20, 20)).toBe(21);
    expect(() => scheduledDailyWindow(0xffff_ffff, 0)).toThrow();
    const a = new Uint8Array(32), b = new Uint8Array(32).fill(255);
    expect(compareBoardEntries(0xffff_ffff_ffff_ffffn, 9, b, 0n, 0, a)).toBe(-1);
    expect(compareBoardEntries(10n, -1, b, 10n, 1, a)).toBe(-1);
    expect(compareBoardEntries(10n, 1, a, 10n, 1, b)).toBe(-1);
    expect(compareBoardEntries(10n, 1, a, 10n, 1, a)).toBe(0);
    expect(() => compareBoardEntries(1n, 0, new Uint8Array(31), 1n, 0, b)).toThrow();
  });

});
