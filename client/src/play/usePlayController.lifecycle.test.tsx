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
  useMusicPlayer: () => ({
    playSfx: fixtures.playSfx,
    duck: vi.fn(),
    unduck: vi.fn(),
  }),
}));
vi.mock("@/stores/navigationStore", () => ({
  useNavigationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      navigate: fixtures.navigate,
      recoveryRunId: fixtures.recoveryRunId,
      setRecoveryRunId: fixtures.setRecoveryRunId,
      setPendingLevelCompletion: fixtures.setPendingLevelCompletion,
    }),
}));

function strictWrapper({ children }: { children: ReactNode }) {
  return <React.StrictMode>{children}</React.StrictMode>;
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

  it("marks settlement failed without navigating or queueing rewards", async () => {
    const recoverSession = vi.fn().mockResolvedValue({});
    const settleAndAdvance = vi
      .fn()
      .mockRejectedValue(new Error("settlement failed"));
    fixtures.run = delegatedRun(recoverSession, {
      settleAndAdvance,
      sessionAuthorized: true,
      activeRun: {
        ...(delegatedRun(recoverSession).activeRun as Record<string, unknown>),
        lifecycle: "levelComplete",
      },
    });

    const { result } = renderHook(() => usePlayController(), {
      wrapper: strictWrapper,
    });

    await waitFor(() => expect(settleAndAdvance).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.settlementStatus).toBe("failed"));
    expect(fixtures.setPendingLevelCompletion).not.toHaveBeenCalled();
    expect(fixtures.navigate).not.toHaveBeenCalled();

    // Continue stays locked on a failed settlement.
    act(() => result.current.continueFromTerminal());
    expect(fixtures.navigate).not.toHaveBeenCalled();
  });

  it("uses refreshed lifetime stars for the confirmed XP delta", async () => {
    const recoverSession = vi.fn().mockResolvedValue({});
    const settleAndAdvance = vi.fn().mockResolvedValue(null);
    fixtures.campaignRefresh.mockResolvedValue({
      maps: [
        {
          mapId: 1,
          levelStars: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
      ],
    });
    fixtures.run = delegatedRun(recoverSession, {
      settleAndAdvance,
      sessionAuthorized: true,
      activeRun: {
        ...(delegatedRun(recoverSession).activeRun as Record<string, unknown>),
        lifecycle: "levelComplete",
      },
    });

    const { result } = renderHook(() => usePlayController(), {
      wrapper: strictWrapper,
    });

    await waitFor(() => expect(settleAndAdvance).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(result.current.terminalSnapshot?.xpAwarded).toBe(20),
    );
    await waitFor(() =>
      expect(result.current.settlementStatus).toBe("complete"),
    );
    // The reward card lives on the play screen now; the map queue stays empty.
    expect(fixtures.setPendingLevelCompletion).not.toHaveBeenCalled();
  });

  it("sequences cascade → outcome → card and gates Continue on settlement", async () => {
    const recoverSession = vi.fn().mockResolvedValue({});
    let resolveSettle: (value: null) => void = () => {};
    const settleAndAdvance = vi.fn().mockReturnValue(
      new Promise<null>((resolve) => {
        resolveSettle = resolve;
      }),
    );
    const baseRun = delegatedRun(recoverSession).activeRun as Record<
      string,
      unknown
    >;
    const terminalRun = { ...baseRun, lifecycle: "levelComplete", moves: 5 };
    const playMove = vi.fn().mockResolvedValue(terminalRun);
    fixtures.run = delegatedRun(recoverSession, {
      playMove,
      settleAndAdvance,
      sessionAuthorized: true,
    });

    const { result, rerender } = renderHook(() => usePlayController(), {
      wrapper: strictWrapper,
    });

    // The terminal move latches the cascade wait.
    await act(async () => {
      await result.current.onMove(0, 0, 1);
    });
    expect(result.current.awaitingTerminalCascade).toBe(true);
    expect(result.current.presentationPhase).toBe("cascade");
    expect(result.current.outcome).toBeNull();
    expect(result.current.showLevelCard).toBe(false);

    // Provider state flips terminal (as playMove does) → settlement starts
    // immediately, never waiting for the animation.
    fixtures.run.activeRun = terminalRun;
    rerender();
    await waitFor(() => expect(settleAndAdvance).toHaveBeenCalledOnce());
    expect(result.current.presentationPhase).toBe("cascade");

    // Cascade completes → outcome show + the terminal sting, exactly once.
    act(() => result.current.onCascadeComplete());
    await waitFor(() =>
      expect(result.current.presentationPhase).toBe("outcome"),
    );
    expect(fixtures.playSfx).toHaveBeenCalledWith("levelup");
    expect(
      fixtures.playSfx.mock.calls.filter(([sfx]) => sfx === "levelup"),
    ).toHaveLength(1);

    // Win show duration elapses → card. Continue stays locked mid-settlement.
    await waitFor(
      () => expect(result.current.presentationPhase).toBe("card"),
      { timeout: 4000 },
    );
    expect(result.current.showLevelCard).toBe(true);
    act(() => result.current.continueFromTerminal());
    expect(fixtures.navigate).not.toHaveBeenCalled();

    // Settlement completes → Continue lands on the plain map (no level
    // pre-selected — the player picks the next node themselves).
    await act(async () => {
      resolveSettle(null);
    });
    await waitFor(() =>
      expect(result.current.settlementStatus).toBe("complete"),
    );
    act(() => result.current.continueFromTerminal());
    expect(fixtures.navigate).toHaveBeenCalledWith("map");
  });

  it("allows a later authorization lapse to renew once again", async () => {
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

  it("never renews automatically inside diagnostic recovery mode", async () => {
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
