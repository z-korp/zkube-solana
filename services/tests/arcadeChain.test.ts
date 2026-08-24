import { describe, expect, it } from "vitest";

import {
  ARCADE_ACCOUNT_VERSION,
  DAILY_POOL_CAPACITY,
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  ENTRY_SPLIT_LAMPORTS,
  PLAYER_STATE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION,
  RUN_RECOVERY_SECONDS,
  SECONDS_PER_DAY,
  currentDayId,
  dailyContentSelection,
} from "../src/arcadeChain";

describe("v5 Daily cadence constants", () => {
  it("pins fresh-bootstrap account versions", () => {
    expect(PROTOCOL_ACCOUNT_VERSION).toBe(1);
    expect(PLAYER_STATE_ACCOUNT_VERSION).toBe(1);
    expect(ARCADE_ACCOUNT_VERSION).toBe(1);
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

  it("does not let a catalog start rotate a day's pool selection", () => {
    const dayId = 31_415;
    expect(dailyContentSelection(
      dayId - 20,
      dayId,
      10,
    )).toEqual(dailyContentSelection(
      dayId,
      dayId,
      10,
    ));
  });

  it("reshuffles each complete raised-capacity cycle", () => {
    const startsDay = DAILY_POOL_CAPACITY * 200;
    const cycle = (cycleIndex: number) => Array.from(
      { length: DAILY_POOL_CAPACITY },
      (_, offset) => dailyContentSelection(
        startsDay,
        startsDay + cycleIndex * DAILY_POOL_CAPACITY + offset,
        DAILY_POOL_CAPACITY,
      ).poolIndex,
    );
    const first = cycle(0);
    const second = cycle(1);
    expect(new Set(first).size).toBe(DAILY_POOL_CAPACITY);
    expect(new Set(second).size).toBe(DAILY_POOL_CAPACITY);
    expect(second).not.toEqual(first);
  });
});
