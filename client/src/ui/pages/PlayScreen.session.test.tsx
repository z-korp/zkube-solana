import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import PlayScreen from "./PlayScreen";

const fixtures = vi.hoisted(() => ({
  lifecycle: "playing",
  phase: "delegated",
  gameAvailable: true,
  error: null as string | null,
  sessionAuthorized: false,
  settledReceipt: null as null | {
    runId: bigint;
    score: number;
    moves: number;
  },
  settledCleanupStatus: "idle" as "idle" | "running" | "complete" | "failed",
  recoveryRunId: null as bigint | null,
  publicKey: {
    toBase58: () => "BQNuPSn2oHn9sU9rKA2hdZfDmiMpdwFYX9D9HqvFKTB6",
  },
  dismissRun: vi.fn(),
  abandonRun: vi.fn(() => Promise.reject(new Error("no chain in tests"))),
  recoverSession: vi.fn(),
  retrySessionRenewal: vi.fn(),
  sessionRenewalStatus: "renewing" as "idle" | "renewing" | "failed",
  recoverBaseRun: vi.fn(),
  retrySettlement: vi.fn(),
  continueSettled: vi.fn(),
  navigate: vi.fn(),
  setMusicContext: vi.fn(),
  playSfx: vi.fn(),
  setThemeTemplate: vi.fn(),
}));

vi.mock("@/play/usePlayController", () => ({
  usePlayController: () => {
    const activeRun = {
      runId: 7n,
      mapId: 1,
      level: 1,
      lifecycle: fixtures.lifecycle,
      bonusType: 0,
      bonusCharges: 0,
      rules: {
        bossId: 0,
        activeMutatorId: 0,
        bonusTriggerType: 0,
        bonusThreshold: 0,
        startingCharges: 0,
      },
      endlessThresholds: [1, 2, 3, 4, 5, 6, 7],
      endlessScoreMultipliersX100: [100, 100, 100, 100, 100, 100, 100, 100],
    };
    return {
      run: {
        phase: fixtures.phase,
        busy: false,
        error: fixtures.error,
        watchStatus: null,
        sessionAuthorized: fixtures.sessionAuthorized,
        publicKey: fixtures.publicKey,
        dismissRun: fixtures.dismissRun,
        abandonRun: fixtures.abandonRun,
        recoverSession: fixtures.recoverSession,
      },
      game: fixtures.gameAvailable
        ? {
            id: 7n,
            blocks: [[1]],
            nextRow: [1],
            mode: 0,
            level: 1,
            levelMoves: 1,
            levelScore: 2,
            totalScore: 2,
            combo: 0,
            constraintProgress: 0,
            constraint2Progress: 0,
            currentDifficulty: 1,
            zoneId: 1,
          }
        : null,
      gameLevel: fixtures.gameAvailable
        ? { maxMoves: 16, pointsRequired: 10 }
        : null,
      activeRun: fixtures.gameAvailable ? activeRun : null,
      outcome: null,
      onBonus: vi.fn(),
      onMove: vi.fn(),
      onCascadeComplete: vi.fn(),
      retrySettlement: fixtures.retrySettlement,
      retrySessionRenewal: fixtures.retrySessionRenewal,
      sessionRenewalStatus: fixtures.sessionRenewalStatus,
      recoverBaseRun: fixtures.recoverBaseRun,
      continueSettled: fixtures.continueSettled,
      settledReceipt: fixtures.settledReceipt,
      settledCleanupStatus: fixtures.settledCleanupStatus,
      closeOutcome: vi.fn(),
      settlingLabel: "Finalizing…",
      startError: null,
    };
  },
}));

vi.mock("@/hooks/useGrid", () => ({ useGrid: () => [] }));
vi.mock("@/stores/navigationStore", () => ({
  useNavigationStore: (
    selector: (state: {
      navigate: typeof fixtures.navigate;
      recoveryRunId: bigint | null;
    }) => unknown,
  ) =>
    selector({
      navigate: fixtures.navigate,
      recoveryRunId: fixtures.recoveryRunId,
    }),
}));
vi.mock("@/contexts/hooks", () => ({
  useMusicPlayer: () => ({
    setMusicContext: fixtures.setMusicContext,
    playSfx: fixtures.playSfx,
  }),
}));
vi.mock("@/ui/elements/theme-provider/hooks", () => ({
  useTheme: () => ({
    themeTemplate: "theme-1",
    setThemeTemplate: fixtures.setThemeTemplate,
  }),
}));
vi.mock("@/ui/theme/ImageAssets", () => ({
  default: () => ({ background: "/background.png" }),
}));
vi.mock("@/ui/components/GameBoard", () => ({
  default: () => <div data-testid="game-board" />,
}));
vi.mock("@/ui/components/hud/GameHud", () => ({ default: () => null }));
vi.mock("@/ui/components/actionbar/GameActionBar", () => ({
  default: () => null,
}));
vi.mock("@/ui/components/GameOverDialog", () => ({ default: () => null }));
vi.mock("@/ui/components/VictoryDialog", () => ({ default: () => null }));

beforeAll(() => {
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("PlayScreen expired-session escape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.lifecycle = "playing";
    fixtures.phase = "delegated";
    fixtures.gameAvailable = true;
    fixtures.error = null;
    fixtures.sessionAuthorized = false;
    fixtures.settledReceipt = null;
    fixtures.settledCleanupStatus = "idle";
    fixtures.sessionRenewalStatus = "renewing";
    fixtures.recoveryRunId = null;
  });

  it.each(["playing", "levelComplete"])(
    "silently renews a %s run while retaining the local escape hatch",
    (lifecycle) => {
      fixtures.lifecycle = lifecycle;
      render(<PlayScreen />);

      expect(screen.getByText("Renewing session…")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Renew session" }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Forget run locally" }),
      );

      expect(fixtures.dismissRun).toHaveBeenCalledOnce();
      expect(fixtures.navigate).toHaveBeenCalledWith("home");
    },
  );

  it.each(["playing", "levelComplete"])(
    "offers one explicit retry after silent %s renewal fails",
    (lifecycle) => {
      fixtures.lifecycle = lifecycle;
      fixtures.error = "rotation failed";
      fixtures.sessionRenewalStatus = "failed";
      render(<PlayScreen />);

      fireEvent.click(screen.getByRole("button", { name: "Retry session" }));

      expect(fixtures.retrySessionRenewal).toHaveBeenCalledOnce();
      expect(fixtures.recoverSession).not.toHaveBeenCalled();
    },
  );
});

describe("PlayScreen settled summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.phase = "none";
    fixtures.gameAvailable = false;
    fixtures.error = null;
    fixtures.sessionAuthorized = false;
    fixtures.recoveryRunId = null;
    fixtures.settledReceipt = { runId: 7n, score: 10, moves: 6 };
    fixtures.settledCleanupStatus = "complete";
    fixtures.sessionRenewalStatus = "idle";
  });

  it("makes Continue a navigation-only controller action", () => {
    render(<PlayScreen />);

    expect(
      screen.queryByRole("button", { name: "Collect rent & continue" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(fixtures.continueSettled).toHaveBeenCalledOnce();
    expect(fixtures.retrySettlement).not.toHaveBeenCalled();
  });

  it("shows Retry settlement and blocks Continue after cleanup failure", () => {
    fixtures.error = "device fee balance low";
    fixtures.settledCleanupStatus = "failed";

    render(<PlayScreen />);

    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry settlement" }));
    expect(fixtures.retrySettlement).toHaveBeenCalledOnce();
    expect(fixtures.continueSettled).not.toHaveBeenCalled();
  });
});

describe("PlayScreen orphaned base-run recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.lifecycle = "levelComplete";
    fixtures.phase = "none";
    fixtures.gameAvailable = false;
    fixtures.error = null;
    fixtures.sessionAuthorized = false;
    fixtures.settledReceipt = null;
    fixtures.settledCleanupStatus = "idle";
    fixtures.sessionRenewalStatus = "idle";
    fixtures.recoveryRunId = 1n;
  });

  it("recovers the requested settled run with the enabled session", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fixtures.recoverBaseRun.mockResolvedValue("signature");

    render(<PlayScreen />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Recover settled run 1" }),
      );
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(fixtures.recoverBaseRun).toHaveBeenCalledOnce();
    expect(fixtures.recoverBaseRun).toHaveBeenCalledWith(1n);
  });

  it("does not request an external wallet confirmation for safe cleanup", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fixtures.recoverBaseRun.mockResolvedValue("signature");

    render(<PlayScreen />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Recover settled run 1" }),
      );
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(fixtures.recoverBaseRun).toHaveBeenCalledWith(1n);
  });

  it("keeps recovery modal and hides unrelated run controls", () => {
    fixtures.phase = "delegated";
    fixtures.gameAvailable = true;

    render(<PlayScreen />);

    expect(screen.getByText("Recovery unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("game-board")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Renew session" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Recover settled run 1" }),
    ).not.toBeInTheDocument();
  });
});
