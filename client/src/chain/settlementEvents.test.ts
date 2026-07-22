// @vitest-environment node

import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import type { CompetitionRecord, PlayerStateView } from "./campaignClient";
import {
  detectSettlementEvents,
  periodRecord,
  pickPrimaryEvent,
} from "./settlementEvents";

const OWNER = PublicKey.unique();

function record(rewardsLamports: bigint, bestPrizeRank = 0): CompetitionRecord {
  return { bestPrizeRank, podiums: 0, wins: 0, rewardsLamports };
}

function view(
  daily: CompetitionRecord,
  weekly: CompetitionRecord,
  season: CompetitionRecord,
): PlayerStateView {
  return {
    owner: OWNER,
    version: 4,
    campaignStars: [],
    featuredEmblem: 0,
    lifetimePaidEntries: 0n,
    dailyRecord: daily,
    weeklyRecord: weekly,
    seasonRecord: season,
  };
}

describe("detectSettlementEvents", () => {
  it("baselines silently on the first observation", () => {
    const next = view(record(500_000_000n, 3), record(0n), record(0n));
    expect(detectSettlementEvents(null, next)).toEqual([]);
  });

  it("emits one precise event per period whose rewards grew", () => {
    const previous = view(record(500_000_000n), record(0n), record(0n));
    const next = view(
      record(500_000_000n),
      record(250_000_000n, 2),
      record(0n),
    );

    const events = detectSettlementEvents(previous, next);
    expect(events).toEqual([
      {
        periodKind: 1,
        label: "Weekly",
        deltaLamports: 250_000_000n,
        newTotalLamports: 250_000_000n,
        bestPrizeRank: 2,
      },
    ]);
  });

  it("ignores unchanged or decreased totals (never a fabricated prize)", () => {
    const previous = view(record(700_000_000n), record(300_000_000n), record(0n));
    // Daily unchanged, Weekly decreased (a stale/reorged read) — no events.
    const next = view(record(700_000_000n), record(200_000_000n), record(0n));
    expect(detectSettlementEvents(previous, next)).toEqual([]);
  });

  it("reports every board a settlement burst paid", () => {
    const previous = view(record(0n), record(0n), record(0n));
    const next = view(
      record(100_000_000n, 4),
      record(50_000_000n, 3),
      record(900_000_000n, 5),
    );
    const events = detectSettlementEvents(previous, next);
    expect(events.map((event) => event.periodKind)).toEqual([0, 1, 2]);
    expect(events.map((event) => event.deltaLamports)).toEqual([
      100_000_000n,
      50_000_000n,
      900_000_000n,
    ]);
  });
});

describe("pickPrimaryEvent", () => {
  it("returns null when nothing grew", () => {
    expect(pickPrimaryEvent([])).toBeNull();
  });

  it("picks the largest increase in a burst", () => {
    const previous = view(record(0n), record(0n), record(0n));
    const next = view(
      record(100_000_000n),
      record(50_000_000n),
      record(900_000_000n, 5),
    );
    const primary = pickPrimaryEvent(detectSettlementEvents(previous, next));
    expect(primary?.periodKind).toBe(2);
    expect(primary?.newTotalLamports).toBe(900_000_000n);
  });

  it("breaks ties toward the shorter cadence", () => {
    const previous = view(record(0n), record(0n), record(0n));
    const next = view(record(200_000_000n), record(200_000_000n), record(0n));
    const primary = pickPrimaryEvent(detectSettlementEvents(previous, next));
    expect(primary?.periodKind).toBe(0);
  });
});

describe("periodRecord", () => {
  it("maps each period kind to its record", () => {
    const state = view(record(1n), record(2n), record(3n));
    expect(periodRecord(state, 0).rewardsLamports).toBe(1n);
    expect(periodRecord(state, 1).rewardsLamports).toBe(2n);
    expect(periodRecord(state, 2).rewardsLamports).toBe(3n);
  });
});
