import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildDevActiveRun } from "@/dev/devBoard";
import { DEV_PLAYER_PUBLIC_KEY } from "@/dev/fixtures";
import { Game } from "@/game/model";
import { rulesToGameLevelData } from "@/hooks/useGameLevel";
import PlayScreen from "./PlayScreen";

Object.assign(globalThis, { React });

const fixtures = vi.hoisted(() => ({
  activeRun: null as ReturnType<typeof buildDevActiveRun> | null,
  game: null as Game | null,
  gameLevel: null as ReturnType<typeof rulesToGameLevelData> | null,
}));

vi.mock("@/play/usePlayController", () => ({
  usePlayController: () => ({
    run: {
      phase: "delegated",
      busy: false,
      error: null,
      watchStatus: null,
      sessionAuthorized: true,
      publicKey: DEV_PLAYER_PUBLIC_KEY,
      dismissRun: vi.fn(),
      abandonRun: vi.fn(),
      resumePreparedRun: vi.fn(),
    },
    game: fixtures.game,
    gameLevel: fixtures.gameLevel,
    activeRun: fixtures.activeRun,
    outcome: null,
    onBonus: vi.fn(),
    onReroll: vi.fn(() => Promise.resolve()),
    onMove: vi.fn(() => Promise.resolve()),
    onCascadeComplete: vi.fn(),
    retrySettlement: vi.fn(),
    retrySessionRenewal: vi.fn(),
    sessionRenewalStatus: "idle",
    recoverBaseRun: vi.fn(),
    continueSettled: vi.fn(),
    settledReceipt: null,
    settledCleanupStatus: "idle",
    closeOutcome: vi.fn(),
    settlingLabel: "Your run is being saved…",
    terminalSnapshot: null,
    awaitingTerminalCascade: false,
    presentationPhase: "idle",
    settlementStatus: "idle",
    showLevelCard: false,
    continueFromTerminal: vi.fn(),
    finalCampaignMapId: 1,
  }),
  canSubmitRunMove: () => true,
  describeRunStartError: () => null,
}));
vi.mock("@/hooks/useGrid", () => ({ useGrid: () => [] }));
vi.mock("@/stores/navigationStore", async () =>
  (await import("@/test/mocks/navigation")).navigationStoreMock({
    navigate: vi.fn(),
    recoveryRunId: null,
    pendingLevelCompletion: null,
    setPendingLevelCompletion: vi.fn(),
    mapZoneId: 8,
    openSettings: vi.fn(),
  }),
);
vi.mock("@/contexts/hooks", async () =>
  (await import("@/test/mocks/contexts")).musicPlayerMock(),
);
vi.mock("@/ui/elements/theme-provider/hooks", async () =>
  (await import("@/test/mocks/theme")).themeHooksMock("theme-8"),
);
vi.mock("@/ui/theme/ImageAssets", () => ({
  default: () => ({ loader: "/loader.png" }),
}));
vi.mock("@/ui/components/GameBoard", () => ({
  default: () => <div data-testid="game-board" />,
}));
vi.mock("@/ui/components/GameOverDialog", () => ({ default: () => null }));
vi.mock("@/ui/components/VictoryDialog", () => ({ default: () => null }));
vi.mock("@/ui/components/LevelCompleteDialog", () => ({
  default: () => null,
}));

beforeEach(() => {
  window.localStorage.clear();
  fixtures.activeRun = buildDevActiveRun("arena", DEV_PLAYER_PUBLIC_KEY);
  fixtures.game = new Game(fixtures.activeRun);
  fixtures.gameLevel = rulesToGameLevelData(
    fixtures.activeRun.rules,
    fixtures.activeRun.level,
    fixtures.activeRun.runId,
  );
});

describe("PlayScreen explanations", () => {
  it("every_run_verb_has_a_rendered_sentence", () => {
    render(<PlayScreen />);

    expect(screen.getByText("exact 2-line clears")).toBeInTheDocument();
    expect(
      screen.getByText(/Every 4 lines cleared by moves/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hard ×3\.0/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Hammer: 2 charges/ }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Destroy a single block",
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: /Reroll: 1 charge/ }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Replaces the next row · perfect clear awards +1 · hold up to 3",
    );
  });
});
