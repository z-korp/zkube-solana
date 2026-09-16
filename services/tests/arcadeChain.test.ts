import { describe, expect, it } from "vitest";

import {
  DAILY_PAIR_COUNT,
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  ENTRY_SPLIT_LAMPORTS,
  PLAYER_STATE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION,
  RUN_RECOVERY_SECONDS,
  SECONDS_PER_DAY,
  currentDayId,
  dailyPairForDay,
} from "../src/arcadeChain.js";

describe("v5 Daily cadence constants", () => {
  it("pins fresh-bootstrap account versions", () => {
    expect(PROTOCOL_ACCOUNT_VERSION).toBe(6);
    expect(PLAYER_STATE_ACCOUNT_VERSION).toBe(3);
  });

  it("pins the single 23:59 run and entry deadline", () => {
    expect(DAILY_RUN_CLOSE_OFFSET).toBe(23 * 60 * 60 + 59 * 60);
    expect(DAILY_RECOVERY_DEADLINE_OFFSET).toBe(
      DAILY_RUN_CLOSE_OFFSET + RUN_RECOVERY_SECONDS,
    );
    expect(currentDayId(20_651 * SECONDS_PER_DAY + 1)).toBe(20_651);
  });

  it("routes every paid entry only to the following Daily and operator", () => {
    expect(ENTRY_SPLIT_LAMPORTS).toEqual({
      followingDaily: 9_000_000n,
      operator: 1_000_000n,
    });
  });

  it("derives a day's pair from its absolute day only", () => {
    const dayId = 31_415;
    expect(dailyPairForDay(dayId)).toEqual(dailyPairForDay(dayId));
  });

  it("reshuffles each complete realm-objective product cycle", () => {
    const startsDay = DAILY_PAIR_COUNT * 200;
    const cycle = (cycleIndex: number) => Array.from(
      { length: DAILY_PAIR_COUNT },
      (_, offset) => dailyPairForDay(
        startsDay + cycleIndex * DAILY_PAIR_COUNT + offset,
      ).pairIndex,
    );
    const first = cycle(0);
    const second = cycle(1);
    expect(new Set(first).size).toBe(DAILY_PAIR_COUNT);
    expect(new Set(second).size).toBe(DAILY_PAIR_COUNT);
    expect(second).not.toEqual(first);
  });
});
