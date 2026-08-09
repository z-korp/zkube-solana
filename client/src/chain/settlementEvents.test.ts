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

function view(dailyRecord: CompetitionRecord): PlayerStateView {
  return {
    owner: OWNER,
    version: 4,
    campaignStars: [],
    featuredEmblem: 0,
    lifetimePaidEntries: 0n,
    dailyRecord,
  };
}

describe("detectSettlementEvents", () => {
  it("baselines silently on the first observation", () => {
    expect(detectSettlementEvents(null, view(record(500_000_000n, 3)))).toEqual([]);
  });

  it("emits a precise Daily event when rewards grow", () => {
    const events = detectSettlementEvents(
      view(record(500_000_000n)),
      view(record(750_000_000n, 2)),
    );
    expect(events).toEqual([
      {
        periodKind: 0,
        label: "Daily",
        deltaLamports: 250_000_000n,
        newTotalLamports: 750_000_000n,
        bestPrizeRank: 2,
      },
    ]);
  });

  it("ignores unchanged or decreased totals", () => {
    expect(
      detectSettlementEvents(view(record(700_000_000n)), view(record(600_000_000n))),
    ).toEqual([]);
  });
});

describe("Daily settlement projection", () => {
  it("returns null when nothing grew", () => {
    expect(pickPrimaryEvent([])).toBeNull();
  });

  it("selects the Daily event and record", () => {
    const state = view(record(900_000_000n, 1));
    const primary = pickPrimaryEvent(
      detectSettlementEvents(view(record(0n)), state),
    );
    expect(primary?.periodKind).toBe(0);
    expect(primary?.newTotalLamports).toBe(900_000_000n);
    expect(periodRecord(state, 0)).toEqual(state.dailyRecord);
  });
});
