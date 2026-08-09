import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettlementEvent } from "@/chain/settlementEvents";
import { usePrizeDeltaTrigger } from "./usePrizeDeltaTrigger";

type DailyPeriod = {
  periodKind: 0;
  label: "Daily";
  bestPrizeRank: number;
  podiums: number;
  wins: number;
  rewardsLamports: bigint;
  hasPrize: boolean;
};

const fixtures = vi.hoisted(() => {
  const period = (rewardsLamports = 0n, bestPrizeRank = 0): DailyPeriod => ({
    periodKind: 0,
    label: "Daily",
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
    periods: [period()] as DailyPeriod[],
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

const seenKey = `zkube:v5:rewards-seen:${fixtures.address}`;

describe("usePrizeDeltaTrigger", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fixtures.result = fixtures.fresh();
  });

  afterEach(() => window.localStorage.clear());

  it("baselines silently on the first observation", () => {
    fixtures.result.periods[0] = fixtures.period(500_000_000n);
    const { result } = renderHook(() => usePrizeDeltaTrigger());

    expect(result.current.prize).toBeNull();
    expect(window.localStorage.getItem(seenKey)).toBe("500000000");
  });

  it("fires once for a grown Daily reward", () => {
    fixtures.result.periods[0] = fixtures.period(500_000_000n);
    const { result, rerender } = renderHook(() => usePrizeDeltaTrigger());

    fixtures.result.periods[0] = fixtures.period(750_000_000n, 2);
    fixtures.result.latestEvent = {
      periodKind: 0,
      label: "Daily",
      newTotalLamports: 750_000_000n,
      deltaLamports: 250_000_000n,
      bestPrizeRank: 2,
    };
    rerender();

    expect(result.current.prize).toEqual({
      periodKind: 0,
      periodLabel: "Daily",
      amountLamports: 250_000_000n,
      bestPrizeRank: 2,
    });

    act(() => result.current.dismiss());
    rerender();
    expect(result.current.prize).toBeNull();
  });

  it("shows nothing while the settlement read is loading", () => {
    fixtures.result.loading = true;
    fixtures.result.periods[0] = fixtures.period(500_000_000n);
    const { result } = renderHook(() => usePrizeDeltaTrigger());

    expect(result.current.prize).toBeNull();
    expect(window.localStorage.getItem(seenKey)).toBeNull();
  });
});
