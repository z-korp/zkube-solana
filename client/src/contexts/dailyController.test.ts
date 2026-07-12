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
  wallet: { publicKey: { toBase58: () => "embedded-wallet" } },
}));

vi.mock("@/contexts/run", () => ({
  useRun: fixtures.useRun,
}));

vi.mock("@/chain/connectionContext", () => ({
  useSolanaConnection: () => ({ connection: fixtures.connection }),
}));

vi.mock("@/chain/dailyClient", () => ({
  buildClaimDailyPrizePlan: vi.fn(),
  buildRefundDailyEntryPlan: vi.fn(),
  fetchDailyView: fixtures.fetchDailyView,
}));

vi.mock("@/chain/embeddedIdentityContext", () => ({
  useEmbeddedIdentity: () => ({ wallet: fixtures.wallet }),
}));

vi.mock("@/chain/paymasterClient", () => ({
  fetchPaymasterClient: vi.fn(),
}));

vi.mock("@/chain/runPlan", () => ({
  submitSponsoredTransactionPlan: vi.fn(),
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
      expect(fixtures.fetchDailyView).toHaveBeenCalledTimes(1),
    );

    expect(fixtures.useRun).toHaveBeenCalled();
    expect(fixtures.directRunHook).not.toHaveBeenCalled();
    expect(result.current.run).toBe(fixtures.run);
    expect(result.current.error).toBe("run controller error");
  });
});
