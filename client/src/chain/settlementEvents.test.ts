// @vitest-environment node

import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import type { CompetitionRecord, PlayerStateView } from "../backend/solana/content/campaignClient";
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
  scoreRecord: CompetitionRecord,
  themeRecord: CompetitionRecord = record(0n),
): PlayerStateView {
  return {
    owner: OWNER,
    version: 4,
    campaignStars: [],
    featuredEmblem: 0,
    lifetimePaidEntries: 0n,
    kreditBalance: 0n,
    ladderPoints: 0n,
    highestLadderTier: 0,
    bestDailyScore: 0,
    lastEntryDayId: 0,
    entryStreakDays: 0,
    scoreRecord,
    themeRecord,
  };
}

describe("detectSettlementEvents", () => {
  it("baselines silently on the first observation", () => {
    expect(detectSettlementEvents(null, view(record(500_000_000n, 3)))).toEqual([]);
  });

  it("emits a precise Score event when rewards grow", () => {
    const events = detectSettlementEvents(
      view(record(500_000_000n)),
      view(record(750_000_000n, 2)),
    );
    expect(events).toEqual([
      {
        periodKind: 0,
        label: "Score",
        deltaLamports: 250_000_000n,
        newTotalLamports: 750_000_000n,
        bestPrizeRank: 2,
      },
    ]);
  });

  it("emits one event per board when a single burst pays both", () => {
    // One entry places on both boards, so a settlement pass can pay twice.
    const events = detectSettlementEvents(
      view(record(0n), record(0n)),
      view(record(300_000_000n, 4), record(120_000_000n, 9)),
    );
    expect(events.map((event) => event.label)).toEqual(["Score", "Theme"]);
    expect(events.map((event) => event.deltaLamports)).toEqual([
      300_000_000n,
      120_000_000n,
    ]);
  });

  it("keeps the boards independent, so one growing never implies the other", () => {
    const events = detectSettlementEvents(
      view(record(500_000_000n), record(70_000_000n)),
      view(record(500_000_000n), record(90_000_000n, 3)),
    );
    expect(events).toEqual([
      {
        periodKind: 1,
        label: "Theme",
        deltaLamports: 20_000_000n,
        newTotalLamports: 90_000_000n,
        bestPrizeRank: 3,
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

  it("selects the largest event and reads each board's own record", () => {
    const state = view(record(900_000_000n, 1), record(40_000_000n, 6));
    const primary = pickPrimaryEvent(
      detectSettlementEvents(view(record(0n), record(0n)), state),
    );
    expect(primary?.periodKind).toBe(0);
    expect(primary?.newTotalLamports).toBe(900_000_000n);
    expect(periodRecord(state, 0)).toEqual(state.scoreRecord);
    expect(periodRecord(state, 1)).toEqual(state.themeRecord);
  });
});
