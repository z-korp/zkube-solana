// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  ARCADE_ACCOUNT_VERSION,
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  PERIOD_SETTLEMENT_DELAY_SECONDS,
  PROTOCOL_ACCOUNT_VERSION,
  RUN_RECOVERY_SECONDS,
  SECONDS_PER_DAY,
  fundingPeriodsForDay,
  seasonIdForDay,
  seasonStartDay,
  weekIdForDay,
  weekStartDay,
} from "../src/arcadeChain";

describe("Arcade cadence math", () => {
  it("keeps protocol-run and Arcade account versions distinct", () => {
    expect(PROTOCOL_ACCOUNT_VERSION).toBe(1);
    expect(ARCADE_ACCOUNT_VERSION).toBe(2);
  });

  it("matches the on-chain 05:30 UTC settlement delay", () => {
    expect(DAILY_RECOVERY_DEADLINE_OFFSET).toBe(
      DAILY_RUN_CLOSE_OFFSET + RUN_RECOVERY_SECONDS,
    );
    expect(PERIOD_SETTLEMENT_DELAY_SECONDS).toBe(
      DAILY_RUN_CLOSE_OFFSET + RUN_RECOVERY_SECONDS - SECONDS_PER_DAY,
    );
    expect(PERIOD_SETTLEMENT_DELAY_SECONDS).toBe(5 * 60 * 60 + 30 * 60);
  });

  it("uses Monday 1970-01-05 for Weekly and 28-day Season epoch zero", () => {
    expect(weekIdForDay(4)).toBe(0);
    expect(weekIdForDay(10)).toBe(0);
    expect(weekIdForDay(11)).toBe(1);
    expect(weekStartDay(1)).toBe(11);
    expect(seasonIdForDay(4)).toBe(0);
    expect(seasonIdForDay(31)).toBe(0);
    expect(seasonIdForDay(32)).toBe(1);
    expect(seasonStartDay(1)).toBe(32);
  });

  it("funds the following period across a Season boundary", () => {
    expect(fundingPeriodsForDay(31)).toEqual({
      qualificationDayId: 31,
      qualificationWeekId: 3,
      qualificationSeasonId: 0,
      dailyFundingDayId: 32,
      weeklyFundingWeekId: 4,
      seasonFundingSeasonId: 1,
    });
  });
});
