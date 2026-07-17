import React from "react";
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Game } from "@/game/model";
import VictoryDialog from "./VictoryDialog";

vi.mock("@/ui/elements/theme-provider/hooks", async () =>
  (await import("@/test/mocks/theme")).themeHooksMock(),
);

describe("VictoryDialog", () => {
  beforeAll(() => {
    vi.stubGlobal("React", React);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("shows the confirmed boss-level XP delta", () => {
    const game = {
      zoneId: 2,
      totalCubes: 40,
      totalScore: 2_000,
      maxComboRun: 5,
    } as Game;

    render(
      React.createElement(VictoryDialog, {
        isOpen: true,
        onClose: vi.fn(),
        game,
        finalCampaignMapId: 32,
        xpAwarded: 30,
      }),
    );

    expect(screen.getByText("+30 XP")).toBeInTheDocument();
    expect(screen.getByText("Campaign level progress")).toBeInTheDocument();
  });
});
