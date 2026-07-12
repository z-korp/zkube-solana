import React, { type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Keypair } from "@solana/web3.js";
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
  recoveryRunId: null as bigint | null,
}));

vi.mock("@/contexts/run", () => ({
  useRun: () => fixtures.run,
}));
vi.mock("@/contexts/campaign", () => ({
  useCampaign: () => ({
    campaign: { maps: [] },
    loading: false,
    refresh: fixtures.campaignRefresh,
  }),
}));
vi.mock("@/contexts/progress", () => ({
  useProgress: () => ({ refresh: fixtures.progressRefresh }),
}));
vi.mock("@/contexts/daily", () => ({
  useDaily: () => ({ refresh: fixtures.dailyRefresh }),
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
      recoveryRunId: fixtures.recoveryRunId,
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
    recoverSession: vi.fn(),
    watchStatus: null,
  };
}

function delegatedRun(
  recoverSession: ReturnType<typeof vi.fn>,
  overrides: Record<string, unknown> = {},
) {
  const activeRun = {
    owner: Keypair.generate().publicKey,
    runId: 9n,
    mode: "campaign",
    dailyChallenge: Keypair.generate().publicKey,
    mapId: 1,
    level: 1,
    rules: {
      pointsRequired: 10,
      maxMoves: 16,
      difficulty: 1,
      primary: { kind: 0, value: 0, requiredCount: 0 },
      secondary: { kind: 0, value: 0, requiredCount: 0 },
      activeMutatorId: 0,
      passiveMutatorId: 0,
      bossId: 0,
      starThresholdModifier: 100,
      bonusType: 0,
      bonusTriggerType: 0,
      bonusThreshold: 0,
      startingCharges: 0,
    },
    lifecycle: "playing",
    score: 0,
    actionCounter: 0,
    moves: 0,
    comboCounter: 0,
    maxCombo: 0,
    primaryProgress: 0,
    secondaryProgress: 0,
    levelLinesCleared: 0,
    totalLinesCleared: 0,
    bonusUses: 0,
    currentDifficulty: 1,
    endlessThresholds: [1, 2, 3, 4, 5, 6, 7],
    endlessScoreMultipliersX100: [100, 100, 100, 100, 100, 100, 100, 100],
    endlessRampMultiplierX100: 100,
    bonusType: 0,
    bonusCharges: 0,
    grid: new Array(80).fill(0),
    nextRow: new Array(8).fill(0),
    pendingVrfCounter: 0,
  };
  return {
    phase: "delegated",
    receipt: null,
    activeRun,
    busy: false,
    error: null,
    sessionAuthorized: false,
    settleStage: null,
    watchStatus: null,
    cleanup: vi.fn(),
    recoverBaseRun: vi.fn(),
    recoverSettlement: vi.fn(),
    settleAndAdvance: vi.fn(),
    startCampaignRun: vi.fn(),
    playMove: vi.fn(),
    applyBonus: vi.fn(),
    recoverSession,
    ...overrides,
  };
}

describe("usePlayController automatic settled cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.campaignRefresh.mockResolvedValue(undefined);
    fixtures.progressRefresh.mockResolvedValue(undefined);
    fixtures.dailyRefresh.mockResolvedValue(undefined);
    fixtures.recoveryRunId = null;
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

describe("usePlayController silent session renewal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.campaignRefresh.mockResolvedValue(undefined);
    fixtures.progressRefresh.mockResolvedValue(undefined);
    fixtures.dailyRefresh.mockResolvedValue(undefined);
    fixtures.recoveryRunId = null;
  });

  it("attempts renewal once and waits for an explicit retry after failure", async () => {
    const recoverSession = vi
      .fn()
      .mockRejectedValue(new Error("rotation failed"));
    fixtures.run = delegatedRun(recoverSession);

    const { result, rerender } = renderHook(() => usePlayController(), {
      wrapper: strictWrapper,
    });

    await waitFor(() =>
      expect(result.current.sessionRenewalStatus).toBe("failed"),
    );
    const activeRun = fixtures.run.activeRun;
    rerender();
    fixtures.run.phase = "missing";
    fixtures.run.activeRun = null;
    rerender();
    fixtures.run.phase = "delegated";
    fixtures.run.activeRun = activeRun;
    rerender();
    expect(recoverSession).toHaveBeenCalledOnce();

    act(() => result.current.retrySessionRenewal());

    await waitFor(() => expect(recoverSession).toHaveBeenCalledTimes(2));
  });

  it("waits for renewal and busy state before terminal auto-settlement", async () => {
    const recoverSession = vi.fn().mockResolvedValue({});
    const settleAndAdvance = vi.fn().mockResolvedValue(null);
    fixtures.run = delegatedRun(recoverSession, {
      settleAndAdvance,
      activeRun: {
        ...(delegatedRun(recoverSession).activeRun as Record<string, unknown>),
        lifecycle: "levelComplete",
      },
    });

    const { rerender } = renderHook(() => usePlayController(), {
      wrapper: strictWrapper,
    });

    await waitFor(() => expect(recoverSession).toHaveBeenCalledOnce());
    expect(settleAndAdvance).not.toHaveBeenCalled();

    fixtures.run.sessionAuthorized = true;
    fixtures.run.busy = true;
    rerender();
    expect(settleAndAdvance).not.toHaveBeenCalled();

    fixtures.run.busy = false;
    rerender();
    await waitFor(() => expect(settleAndAdvance).toHaveBeenCalledOnce());
  });

  it("allows a later authorization lapse to rotate once again", async () => {
    const recoverSession = vi.fn().mockResolvedValue({});
    fixtures.run = delegatedRun(recoverSession);

    const { result, rerender } = renderHook(() => usePlayController(), {
      wrapper: strictWrapper,
    });

    await waitFor(() => expect(recoverSession).toHaveBeenCalledOnce());
    fixtures.run.sessionAuthorized = true;
    rerender();
    await waitFor(() =>
      expect(result.current.sessionRenewalStatus).toBe("idle"),
    );

    fixtures.run.sessionAuthorized = false;
    rerender();
    await waitFor(() => expect(recoverSession).toHaveBeenCalledTimes(2));
  });

  it("never rotates automatically inside diagnostic recovery mode", async () => {
    const recoverSession = vi.fn().mockResolvedValue({});
    fixtures.run = delegatedRun(recoverSession);
    fixtures.recoveryRunId = 1n;

    const { rerender } = renderHook(() => usePlayController(), {
      wrapper: strictWrapper,
    });
    rerender();

    await act(async () => Promise.resolve());
    expect(recoverSession).not.toHaveBeenCalled();
  });
});
