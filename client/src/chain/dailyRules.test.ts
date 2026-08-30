// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  dailyContentFromPairIndex,
  dailyIsScheduled,
  nextScheduledDaily,
} from "./dailyRules";
import { DAILY_PAIR_COUNT } from "./dailyRules.generated";
import { coreDailyPairIndex } from "../core/zkubeCore";

describe("v5 Daily realm and objective draw", () => {
  it("draws a full reproducible product cycle anchored to absolute days", async () => {
    const startsDay = 32_000;
    const selected = await Promise.all(
      Array.from({ length: DAILY_PAIR_COUNT }, (_, offset) =>
        coreDailyPairIndex(startsDay + offset).then((pairIndex) =>
          dailyContentFromPairIndex(startsDay + offset, pairIndex)),
      ),
    );
    expect(selected.slice(0, 20).map(({ pairIndex }) => pairIndex)).toEqual([
      53, 131, 145, 13, 73, 91, 31, 97, 74, 39,
      5, 132, 138, 26, 151, 99, 20, 119, 54, 15,
    ]);
    expect(new Set(selected.map(({ pairIndex }) => pairIndex)).size).toBe(
      DAILY_PAIR_COUNT,
    );
    expect(dailyContentFromPairIndex(
      startsDay + 1,
      await coreDailyPairIndex(startsDay + 1),
    )).toEqual(selected[1]);
  });

  it("uses the explicit suspension boundary", () => {
    expect(dailyIsScheduled(20_000, 0)).toBe(true);
    expect(dailyIsScheduled(20_005, 20_010)).toBe(false);
    expect(dailyIsScheduled(20_010, 20_010)).toBe(true);
    expect(nextScheduledDaily(20_005, 20_010)).toBe(20_010);
    expect(nextScheduledDaily(20_010, 20_010)).toBe(20_011);
  });
});
