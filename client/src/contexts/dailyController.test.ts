import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDailyController } from "@/chain/useDailyController";

const fixtures = vi.hoisted(() => ({
  connection: { confirmTransaction: vi.fn() },
  fetchDailyView: vi.fn(async () => null),
  directRunHook: vi.fn(() => {
    throw new Error("useDailyController created a second run controller");
  }),
  run: {
    error: "run controller error",
    phase: "none",
    startDailyRun: vi.fn(),
  },
  useRun: vi.fn(),
  wallet: { publicKey: { toBase58: () => "connected-wallet" } },
}));

vi.mock("@/contexts/run", async () =>
  (await import("@/test/mocks/contexts")).runContextMock(fixtures.useRun),
);

vi.mock("@/chain/connectionContext", () => ({
  useSolanaConnection: () => ({ connection: fixtures.connection }),
}));

vi.mock("@/chain/dailyClient", () => ({
  currentDailyDayId: () => 20,
  fetchDailyView: fixtures.fetchDailyView,
}));

vi.mock("@/chain/connectedPlayerContext", async () =>
  (await import("@/test/mocks/contexts")).connectedPlayerMock(() => ({
    readOnlyWallet: fixtures.wallet,
    sessionStatus: "missing",
  })),
);

vi.mock("@/chain/runPlan", () => ({
  submitVersionedTransactionPlan: vi.fn(),
}));

vi.mock("@/chain/useRunController", () => ({
  useRunController: fixtures.directRunHook,
}));

describe("useDailyController run sharing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.useRun.mockReturnValue(fixtures.run);
  });

  it("uses the RunProvider controller without creating a second controller", async () => {
    const { result } = renderHook(() => useDailyController());

    await waitFor(() =>
      expect(fixtures.fetchDailyView).toHaveBeenCalledTimes(2),
    );

    expect(fixtures.useRun).toHaveBeenCalled();
    expect(fixtures.directRunHook).not.toHaveBeenCalled();
    expect(result.current.run).toBe(fixtures.run);
    expect(result.current.error).toBeNull();
    expect(result.current.run.error).toBe("run controller error");
  });
});
