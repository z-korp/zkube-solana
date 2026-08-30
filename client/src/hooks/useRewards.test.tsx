import type { AccountInfo, PublicKey as PublicKeyType } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { act, renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RewardsProvider, useRewards } from "./useRewards";

const OWNER = PublicKey.unique();
const OWNER_ADDRESS = OWNER.toBase58();

vi.mock("@/chain/campaignClient", () => ({
  decodePlayerStateAccount: (
    _program: unknown,
    _address: PublicKeyType,
    owner: PublicKeyType,
    info: AccountInfo<Buffer>,
  ) => {
    if (info.data[0] === 0xff) throw new Error("malformed PlayerState");
    return {
      owner,
      version: 5,
      campaignStars: [],
      featuredEmblem: 0,
      lifetimePaidEntries: 0n,
      kreditBalance: 0n,
      ladderPoints: 0n,
      highestLadderTier: 0,
      bestDailyScore: 0,
      lastEntryDayId: 0,
      entryStreakDays: 0,
      scoreRecord: {
        bestPrizeRank: info.data[1] ?? 0,
        podiums: 0,
        wins: 0,
        rewardsLamports: BigInt(info.data[0] ?? 0) * 100_000_000n,
      },
      themeRecord: {
        bestPrizeRank: 0,
        podiums: 0,
        wins: 0,
        rewardsLamports: 0n,
      },
    };
  },
}));

vi.mock("@/chain/runPlan", () => ({
  zkubeProgram: () => ({}),
  submitVersionedTransactionPlan: vi.fn(),
}));
vi.mock("@/chain/pdas", () => ({ derivePlayerStatePda: () => OWNER }));
vi.mock("@/chain/dailyClient", () => ({
  currentDailyDayId: () => 1,
  fetchUnclaimedRewards: async () => [],
  buildClaimDailyPrizePlan: vi.fn(),
}));
vi.mock("@/contexts/daily", () => ({
  useDaily: () => ({ daily: null }),
}));
vi.mock("@/dev/devBypass", () => ({ DEV_BYPASS_ACTIVE: false }));
vi.mock("@/dev/fixtures", () => ({ devUnclaimedRewards: () => [] }));

const harness = vi.hoisted(() => ({
  change: null as ((info: AccountInfo<Buffer>) => void) | null,
  getAccountInfo: vi.fn(),
  onAccountChange: vi.fn(),
  removeAccountChangeListener: vi.fn(),
}));

const connection = {
  getAccountInfo: harness.getAccountInfo,
  onAccountChange: harness.onAccountChange,
  removeAccountChangeListener: harness.removeAccountChangeListener,
};

vi.mock("@/chain/connectionContext", () => ({
  useSolanaConnection: () => ({ connection }),
}));

const PLAYER = {
  publicKey: OWNER,
  readOnlyWallet: { publicKey: OWNER },
  requireSession: vi.fn(),
  refreshBalance: vi.fn(),
};
vi.mock("@/chain/connectedPlayerContext", () => ({
  useConnectedPlayer: () => PLAYER,
}));

function accountInfo(data: number[]): AccountInfo<Buffer> {
  return {
    data: Buffer.from(data),
    owner: OWNER,
    executable: false,
    lamports: 1,
    rentEpoch: 0,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <RewardsProvider>{children}</RewardsProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
  harness.change = null;
  harness.getAccountInfo.mockReset();
  harness.onAccountChange.mockReset();
  harness.removeAccountChangeListener.mockReset();
  harness.onAccountChange.mockImplementation((_address, callback) => {
    harness.change = callback;
    return 42;
  });
  harness.removeAccountChangeListener.mockResolvedValue(undefined);
});

describe("useRewards", () => {
  it("uses one silent baseline for the ceremony and a later award", async () => {
    harness.getAccountInfo.mockResolvedValue(accountInfo([5, 0]));
    const { result } = renderHook(() => useRewards(), { wrapper });

    await waitFor(() =>
      expect(result.current.totalRewardsLamports).toBe(500_000_000n),
    );
    expect(result.current.prize).toBeNull();
    expect(
      window.localStorage.getItem(`zkube:v5:rewards-seen:${OWNER_ADDRESS}`),
    ).toBe("500000000");

    act(() => harness.change?.(accountInfo([7, 3])));
    await waitFor(() =>
      expect(result.current.prize).toEqual({
        periodKind: 0,
        periodLabel: "Score",
        amountLamports: 200_000_000n,
        bestPrizeRank: 3,
      }),
    );
    expect(
      Object.keys(window.localStorage).filter((key) =>
        key.includes("rewards-seen"),
      ),
    ).toEqual([`zkube:v5:rewards-seen:${OWNER_ADDRESS}`]);

    act(() => result.current.dismissPrize());
    expect(result.current.prize).toBeNull();
  });

  it("keeps the last trusted state after a malformed update", async () => {
    harness.getAccountInfo.mockResolvedValue(accountInfo([5, 0]));
    const { result } = renderHook(() => useRewards(), { wrapper });
    await waitFor(() =>
      expect(result.current.totalRewardsLamports).toBe(500_000_000n),
    );

    act(() => harness.change?.(accountInfo([0xff])));
    expect(result.current.totalRewardsLamports).toBe(500_000_000n);
    expect(result.current.prize).toBeNull();
  });

  it("tears down its single profile subscription", async () => {
    harness.getAccountInfo.mockResolvedValue(accountInfo([1, 0]));
    const { result, unmount } = renderHook(() => useRewards(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();
    expect(harness.removeAccountChangeListener).toHaveBeenCalledWith(42);
  });
});
