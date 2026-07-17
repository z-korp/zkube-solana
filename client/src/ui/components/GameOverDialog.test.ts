import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Game } from "@/game/model";
import GameOverDialog from "./GameOverDialog";

vi.mock("@/contexts/daily", () => ({
  useDaily: () => ({ daily: null }),
}));
vi.mock("@/chain/connectedPlayerContext", () => ({
  useConnectedPlayer: () => ({ publicKey: null }),
}));
vi.mock("@/ui/elements/theme-provider/hooks", async () =>
  (await import("@/test/mocks/theme")).themeHooksMock(),
);

describe("GameOverDialog settlement recovery", () => {
  beforeAll(() => {
    vi.stubGlobal("React", React);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("offers an actionable retry when Daily settlement fails", () => {
    const retry = vi.fn();
    const close = vi.fn();
    const game = {
      mode: 1,
      currentDifficulty: 7,
      endlessScoreMultipliersX100: [100, 125, 150, 175, 200, 225, 250, 250],
      totalScore: 304,
      engineScore: 106,
      challengeBonus: 198,
      moves: 65,
      maxComboRun: 4,
      level: 1,
      zoneId: 1,
    } as Game;

    render(
      React.createElement(GameOverDialog, {
        isOpen: true,
        onClose: close,
        closeDisabled: true,
        settlementFailed: true,
        settlementError: "Daily settlement routing failed",
        onRetrySettlement: retry,
        game,
      }),
    );

    expect(
      screen.getByText("Daily settlement routing failed"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry settlement" }));

    expect(retry).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });
});
