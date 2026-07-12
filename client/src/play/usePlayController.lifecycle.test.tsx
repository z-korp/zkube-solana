import React, { type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayController } from "./usePlayController";

const fixtures = vi.hoisted(() => ({
  run: {} as Record<string, unknown>,
  campaignRefresh: vi.fn(),
  progressRefresh: vi.fn(),
  dailyRefresh: vi.fn(),
  navigate: vi.fn(),
  setPendingLevelCompletion: vi.fn(),
  setRecoveryRunId: vi.fn(),
  playSfx: vi.fn(),
}));

vi.mock("@/contexts/run", () => ({
  useRun: () => fixtures.run,
}));
vi.mock("@/contexts/campaign", () => ({
  useCampaignController: () => ({
    campaign: { maps: [] },
    loading: false,
    refresh: fixtures.campaignRefresh,
  }),
}));
vi.mock("@/contexts/progress", () => ({
  useProgressController: () => ({ refresh: fixtures.progressRefresh }),
}));
vi.mock("@/contexts/daily", () => ({
  useDailyController: () => ({ refresh: fixtures.dailyRefresh }),
}));
vi.mock("@/contexts/hooks", () => ({
  useMusicPlayer: () => ({ playSfx: fixtures.playSfx }),
}));
vi.mock("@/stores/navigationStore", () => ({
  useNavigationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      navigate: fixtures.navigate,
      mapZoneId: 1,
      pendingPreviewLevel: null,
      setPendingPreviewLevel: vi.fn(),
      setGameId: vi.fn(),
      recoveryRunId: null,
      setRecoveryRunId: fixtures.setRecoveryRunId,
      setPendingLevelCompletion: fixtures.setPendingLevelCompletion,
    }),
}));

const receipt = {
  owner: { equals: () => true },
  runId: 7n,
  mode: "campaign",
  mapId: 1,
  level: 1,
  score: 10,
  moves: 6,
  levelStars: 3,
  completed: true,
  consumed: true,
};

function strictWrapper({ children }: { children: ReactNode }) {
  return <React.StrictMode>{children}</React.StrictMode>;
}

function settledRun(cleanup: ReturnType<typeof vi.fn>) {
  return {
    phase: "settled",
    receipt,
    activeRun: null,
    busy: false,
    error: null,
    sessionAuthorized: false,
    settleStage: null,
    cleanup,
    recoverBaseRun: vi.fn(),
    recoverSettlement: vi.fn(),
    settleAndAdvance: vi.fn(),
    startCampaignRun: vi.fn(),
    playMove: vi.fn(),
    applyBonus: vi.fn(),
  };
}

describe("usePlayController automatic settled cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.campaignRefresh.mockResolvedValue(undefined);
    fixtures.progressRefresh.mockResolvedValue(undefined);
    fixtures.dailyRefresh.mockResolvedValue(undefined);
  });

  it("fires cleanup once, retains the summary, and keeps Continue navigation-only", async () => {
    const cleanup = vi.fn().mockImplementation(async () => {
      fixtures.run.phase = "none";
      fixtures.run.receipt = null;
      return "cleanup-signature";
    });
    fixtures.run = settledRun(cleanup);

    const { result, rerender } = renderHook(() => usePlayController(), {
      wrapper: strictWrapper,
    });

    await waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    rerender();
    await waitFor(() =>
      expect(result.current.settledCleanupStatus).toBe("complete"),
    );

    expect(cleanup).toHaveBeenCalledOnce();
    expect(result.current.settledReceipt).toMatchObject({
      runId: 7n,
      score: 10,
      moves: 6,
    });
    expect(fixtures.navigate).not.toHaveBeenCalled();

    act(() => result.current.continueSettled());

    expect(cleanup).toHaveBeenCalledOnce();
    expect(fixtures.navigate).toHaveBeenCalledOnce();
    expect(fixtures.navigate).toHaveBeenCalledWith("map");
  });

  it("does not auto-retry a failed cleanup until Retry settlement", async () => {
    const cleanup = vi.fn().mockRejectedValue(new Error("paymaster failed"));
    fixtures.run = settledRun(cleanup);

    const { result, rerender } = renderHook(() => usePlayController(), {
      wrapper: strictWrapper,
    });

    await waitFor(() =>
      expect(result.current.settledCleanupStatus).toBe("failed"),
    );
    rerender();
    rerender();
    expect(cleanup).toHaveBeenCalledOnce();

    act(() => result.current.retrySettlement());

    await waitFor(() => expect(cleanup).toHaveBeenCalledTimes(2));
  });
});
