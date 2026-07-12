import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
  dismissRun: vi.fn(),
  recoverSession: vi.fn(),
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
        phase: "delegated",
        busy: false,
        error: null,
        watchStatus: null,
        sessionAuthorized: false,
        dismissRun: fixtures.dismissRun,
        recoverSession: fixtures.recoverSession,
      },
      game: {
        id: 7n,
        blocks: [[1]],
        next_row: [1],
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
      },
      gameLevel: { maxMoves: 16, pointsRequired: 10 },
      activeRun,
      outcome: null,
      onBonus: vi.fn(),
      onMove: vi.fn(),
      onCascadeComplete: vi.fn(),
      retrySettlement: vi.fn(),
      finishSettled: vi.fn(),
      closeOutcome: vi.fn(),
      settlingLabel: "Finalizing…",
      startError: null,
    };
  },
}));

vi.mock("@/hooks/useGrid", () => ({ useGrid: () => [] }));
vi.mock("@/stores/navigationStore", () => ({
  useNavigationStore: (
    selector: (state: { navigate: typeof fixtures.navigate }) => unknown,
  ) => selector({ navigate: fixtures.navigate }),
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
  });

  it.each(["playing", "levelComplete"])(
    "lets the player forget a %s run locally when renewal is unavailable",
    (lifecycle) => {
      fixtures.lifecycle = lifecycle;
      render(<PlayScreen />);

      expect(
        screen.getByRole("button", { name: "Renew session" }),
      ).toBeEnabled();
      fireEvent.click(
        screen.getByRole("button", { name: "Forget run locally" }),
      );

      expect(fixtures.dismissRun).toHaveBeenCalledOnce();
      expect(fixtures.navigate).toHaveBeenCalledWith("home");
    },
  );
});
