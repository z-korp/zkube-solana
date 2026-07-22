import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePrizeDeltaTrigger } from "./usePrizeDeltaTrigger";

const fixtures = vi.hoisted(() => {
  const empty = () => ({
    bestPrizeRank: 0,
    podiums: 0,
    wins: 0,
    rewardsLamports: 0n,
  });
  return {
    empty,
    address: "PLAYER1111111111111111111111111111111111111",
    profile: {
      loading: false,
      error: null as string | null,
      dailyRecord: empty(),
      weeklyRecord: empty(),
      seasonRecord: empty(),
    },
  };
});

const EMPTY_RECORD = fixtures.empty();

vi.mock("@/chain/connectedPlayerContext", () => ({
  useConnectedPlayer: () => ({
    publicKey: { toBase58: () => fixtures.address },
  }),
}));

vi.mock("@/hooks/usePlayerProfile", () => ({
  usePlayerProfile: () => fixtures.profile,
}));

function record(rewardsLamports: bigint) {
  return { ...EMPTY_RECORD, rewardsLamports };
}

describe("usePrizeDeltaTrigger", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fixtures.profile = {
      loading: false,
      error: null,
      dailyRecord: fixtures.empty(),
      weeklyRecord: fixtures.empty(),
      seasonRecord: fixtures.empty(),
    };
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("baselines silently on the first observation for a wallet", () => {
    fixtures.profile.dailyRecord = record(500_000_000n);
    const { result } = renderHook(() => usePrizeDeltaTrigger());

    expect(result.current.prize).toBeNull();
    // The baseline is now persisted for this wallet.
    expect(
      window.localStorage.getItem(
        `zkube:v4:rewards-seen:${fixtures.address}`,
      ),
    ).toContain("500000000");
  });

  it("fires once for a grown period and attributes it correctly", () => {
    // Seed the baseline first.
    fixtures.profile.dailyRecord = record(500_000_000n);
    const { result, rerender } = renderHook(() => usePrizeDeltaTrigger());
    expect(result.current.prize).toBeNull();

    // The Weekly record grows by 0.25 SOL.
    fixtures.profile.weeklyRecord = record(250_000_000n);
    rerender();

    expect(result.current.prize).toEqual({
      periodKind: 1,
      periodLabel: "Weekly",
      amountLamports: 250_000_000n,
    });

    // Re-render with the same data does not re-fire (baseline was persisted).
    act(() => result.current.dismiss());
    rerender();
    expect(result.current.prize).toBeNull();
  });

  it("attributes to the largest-growing period when several grow", () => {
    const { rerender, result } = renderHook(() => usePrizeDeltaTrigger());
    expect(result.current.prize).toBeNull();

    fixtures.profile.dailyRecord = record(100_000_000n);
    fixtures.profile.seasonRecord = record(900_000_000n);
    rerender();

    expect(result.current.prize?.periodLabel).toBe("Season");
    expect(result.current.prize?.amountLamports).toBe(900_000_000n);
  });

  it("shows nothing while the profile read is loading", () => {
    fixtures.profile.loading = true;
    fixtures.profile.dailyRecord = record(500_000_000n);
    const { result } = renderHook(() => usePrizeDeltaTrigger());

    expect(result.current.prize).toBeNull();
    // No baseline is written from an in-flight read.
    expect(
      window.localStorage.getItem(
        `zkube:v4:rewards-seen:${fixtures.address}`,
      ),
    ).toBeNull();
  });
});
