import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Game } from "@/game/model";
import GameOverDialog from "./GameOverDialog";

vi.mock("@/backend/client", () => ({
  useDaily: () => ({ daily: null }),
  useConnectedPlayer: () => ({ publicKey: null }),
  useClientState: () => ({ economy: { profile: { bestScore: 0 } } }),
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
