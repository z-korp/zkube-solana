import type { AccountInfo, PublicKey as PublicKeyType } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettlementWatcher } from "./useSettlementWatcher";

const OWNER = PublicKey.unique();

// Decode `data[0]` bytes into daily-record lamports (0.1 SOL each) and `data[1]`
// into the daily best rank; 0xff means "malformed" so the untrusted-RPC guard
// can be exercised. Weekly/Season stay empty.
vi.mock("@/chain/campaignClient", () => ({
  decodePlayerStateAccount: (
    _program: unknown,
    _address: PublicKeyType,
    owner: PublicKeyType,
    info: AccountInfo<Buffer>,
  ) => {
    if (info.data[0] === 0xff) throw new Error("malformed PlayerState");
    const units = BigInt(info.data[0] ?? 0);
    const empty = { bestPrizeRank: 0, podiums: 0, wins: 0, rewardsLamports: 0n };
    return {
      owner,
      version: 4,
      campaignStars: [],
      featuredEmblem: 0,
      lifetimePaidEntries: 0n,
      dailyRecord: {
        bestPrizeRank: info.data[1] ?? 0,
        podiums: 0,
        wins: 0,
        rewardsLamports: units * 100_000_000n,
      },
      weeklyRecord: { ...empty },
      seasonRecord: { ...empty },
    };
  },
}));

vi.mock("@/chain/runPlan", () => ({ zkubeProgram: () => ({}) }));

// The PlayerState PDA value is irrelevant here (decode + program are mocked);
// pin it so the test never depends on the deployed program id.
vi.mock("@/chain/pdas", () => ({ derivePlayerStatePda: () => OWNER }));

const harness = vi.hoisted(() => ({
  info: null as AccountInfo<Buffer> | null,
  changeCb: null as ((info: AccountInfo<Buffer>) => void) | null,
  onAccountChange: vi.fn(),
  removeAccountChangeListener: vi.fn(),
  getAccountInfo: vi.fn(),
}));

const connection = {
  getAccountInfo: harness.getAccountInfo,
  onAccountChange: harness.onAccountChange,
  removeAccountChangeListener: harness.removeAccountChangeListener,
};

vi.mock("@/chain/connectionContext", () => ({
  useSolanaConnection: () => ({ connection }),
}));

// Stable references, mirroring the real provider (publicKey / readOnlyWallet are
// memoised there). An unstable object would re-run the effect every render and
// reset the diff baseline.
const CONNECTED_PLAYER = { publicKey: OWNER, readOnlyWallet: { publicKey: OWNER } };

vi.mock("@/chain/connectedPlayerContext", () => ({
  useConnectedPlayer: () => CONNECTED_PLAYER,
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

beforeEach(() => {
  harness.changeCb = null;
  harness.getAccountInfo.mockReset();
  harness.onAccountChange.mockReset();
  harness.removeAccountChangeListener.mockReset();
  harness.onAccountChange.mockImplementation((_addr, cb) => {
    harness.changeCb = cb;
    return 42;
  });
  harness.removeAccountChangeListener.mockResolvedValue(undefined);
});

describe("useSettlementWatcher", () => {
  it("baselines the initial snapshot silently, then emits on a real increase", async () => {
    harness.getAccountInfo.mockResolvedValue(accountInfo([5, 0])); // 0.5 SOL Daily
    const { result } = renderHook(() => useSettlementWatcher());

    await waitFor(() =>
      expect(result.current.view?.dailyRecord.rewardsLamports).toBe(
        500_000_000n,
      ),
    );
    // First observation is a silent baseline — no prize event.
    expect(result.current.latestEvent).toBeNull();

    // A settlement push grows Daily to 0.7 SOL at rank 3.
    act(() => harness.changeCb?.(accountInfo([7, 3])));

    expect(result.current.latestEvent).toEqual({
      periodKind: 0,
      label: "Daily",
      deltaLamports: 200_000_000n,
      newTotalLamports: 700_000_000n,
      bestPrizeRank: 3,
    });
  });

  it("ignores a malformed pushed account and keeps the last trusted snapshot", async () => {
    harness.getAccountInfo.mockResolvedValue(accountInfo([5, 0]));
    const { result } = renderHook(() => useSettlementWatcher());
    await waitFor(() =>
      expect(result.current.view?.dailyRecord.rewardsLamports).toBe(
        500_000_000n,
      ),
    );

    act(() => harness.changeCb?.(accountInfo([0xff]))); // decoder throws

    expect(result.current.view?.dailyRecord.rewardsLamports).toBe(500_000_000n);
    expect(result.current.latestEvent).toBeNull();
  });

  it("tears down the subscription on unmount", async () => {
    harness.getAccountInfo.mockResolvedValue(accountInfo([1, 0]));
    const { result, unmount } = renderHook(() => useSettlementWatcher());
    await waitFor(() => expect(result.current.view).not.toBeNull());

    unmount();
    expect(harness.removeAccountChangeListener).toHaveBeenCalledWith(42);
  });
});
