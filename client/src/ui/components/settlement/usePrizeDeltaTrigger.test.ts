import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettlementEvent } from "@/chain/settlementEvents";
import { usePrizeDeltaTrigger } from "./usePrizeDeltaTrigger";

type Period = {
  periodKind: 0 | 1 | 2;
  label: "Daily" | "Weekly" | "Season";
  bestPrizeRank: number;
  podiums: number;
  wins: number;
  rewardsLamports: bigint;
  hasPrize: boolean;
};

const fixtures = vi.hoisted(() => {
  const period = (
    periodKind: 0 | 1 | 2,
    label: "Daily" | "Weekly" | "Season",
    rewardsLamports = 0n,
    bestPrizeRank = 0,
  ): Period => ({
    periodKind,
    label,
    bestPrizeRank,
    podiums: 0,
    wins: 0,
    rewardsLamports,
    hasPrize: bestPrizeRank > 0 || rewardsLamports > 0n,
  });
  const fresh = () => ({
    loading: false,
    error: null as string | null,
    latestEvent: null as SettlementEvent | null,
    periods: [
      period(0, "Daily"),
      period(1, "Weekly"),
      period(2, "Season"),
    ] as Period[],
  });
  return {
    period,
    fresh,
    address: "PLAYER1111111111111111111111111111111111111",
    result: fresh(),
  };
});

vi.mock("@/chain/connectedPlayerContext", () => ({
  useConnectedPlayer: () => ({
    publicKey: { toBase58: () => fixtures.address },
  }),
}));

vi.mock("@/hooks/useSettlementResult", () => ({
  useSettlementResult: () => fixtures.result,
}));

const seenKey = `zkube:v4:rewards-seen:${fixtures.address}`;

function event(
  periodKind: 0 | 1 | 2,
  label: "Daily" | "Weekly" | "Season",
  newTotalLamports: bigint,
  deltaLamports: bigint,
  bestPrizeRank = 0,
): SettlementEvent {
  return { periodKind, label, deltaLamports, newTotalLamports, bestPrizeRank };
}

describe("usePrizeDeltaTrigger", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fixtures.result = fixtures.fresh();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("baselines silently on the first observation for a wallet", () => {
    fixtures.result.periods[0] = fixtures.period(0, "Daily", 500_000_000n);
    const { result } = renderHook(() => usePrizeDeltaTrigger());

    expect(result.current.prize).toBeNull();
    // The baseline is now persisted for this wallet.
    expect(window.localStorage.getItem(seenKey)).toContain("500000000");
  });

  it("fires once for a grown period with the precise period, amount, and rank", () => {
    // Seed the baseline first.
    fixtures.result.periods[0] = fixtures.period(0, "Daily", 500_000_000n);
    const { result, rerender } = renderHook(() => usePrizeDeltaTrigger());
    expect(result.current.prize).toBeNull();

    // The Weekly record grows by 0.25 SOL, surfaced by the precise event.
    fixtures.result.periods[1] = fixtures.period(1, "Weekly", 250_000_000n, 2);
    fixtures.result.latestEvent = event(1, "Weekly", 250_000_000n, 250_000_000n, 2);
    rerender();

    expect(result.current.prize).toEqual({
      periodKind: 1,
      periodLabel: "Weekly",
      amountLamports: 250_000_000n,
      bestPrizeRank: 2,
    });

    // Re-render with the same data does not re-fire (seen was persisted).
    act(() => result.current.dismiss());
    rerender();
    expect(result.current.prize).toBeNull();
  });

  it("attributes to the largest-growing period when several grow", () => {
    const { rerender, result } = renderHook(() => usePrizeDeltaTrigger());
    expect(result.current.prize).toBeNull();

    fixtures.result.periods[0] = fixtures.period(0, "Daily", 100_000_000n);
    fixtures.result.periods[2] = fixtures.period(2, "Season", 900_000_000n, 5);
    fixtures.result.latestEvent = event(2, "Season", 900_000_000n, 900_000_000n, 5);
    rerender();

    expect(result.current.prize?.periodLabel).toBe("Season");
    expect(result.current.prize?.amountLamports).toBe(900_000_000n);
    expect(result.current.prize?.bestPrizeRank).toBe(5);
  });

  it("advances every grown period so a later win is never double-counted", () => {
    // Baseline, then a burst pays both Daily and Weekly at once.
    const { rerender, result } = renderHook(() => usePrizeDeltaTrigger());
    fixtures.result.periods[0] = fixtures.period(0, "Daily", 300_000_000n);
    fixtures.result.periods[1] = fixtures.period(1, "Weekly", 100_000_000n);
    fixtures.result.latestEvent = event(0, "Daily", 300_000_000n, 300_000_000n);
    rerender();
    // Largest increase (Daily) is celebrated.
    expect(result.current.prize?.periodLabel).toBe("Daily");
    act(() => result.current.dismiss());

    // Weekly's seen total was advanced too: the persisted baseline holds 0.1 SOL
    // for Weekly, so its earlier growth cannot be re-counted.
    expect(window.localStorage.getItem(seenKey)).toContain("100000000");

    // A fresh Weekly win of +0.05 grows the total to 0.15; only the new 0.05
    // delta is celebrated, not the full 0.15.
    fixtures.result.periods[1] = fixtures.period(1, "Weekly", 150_000_000n);
    fixtures.result.latestEvent = event(1, "Weekly", 150_000_000n, 50_000_000n);
    rerender();
    expect(result.current.prize).toEqual({
      periodKind: 1,
      periodLabel: "Weekly",
      amountLamports: 50_000_000n,
      bestPrizeRank: 0,
    });
  });

  it("shows nothing while the settlement read is loading", () => {
    fixtures.result.loading = true;
    fixtures.result.periods[0] = fixtures.period(0, "Daily", 500_000_000n);
    const { result } = renderHook(() => usePrizeDeltaTrigger());

    expect(result.current.prize).toBeNull();
    // No baseline is written from an in-flight read.
    expect(window.localStorage.getItem(seenKey)).toBeNull();
  });
});
