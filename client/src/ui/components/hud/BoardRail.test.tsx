import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BoardRail from "./BoardRail";

vi.mock("@/contexts/hooks", async () =>
  (await import("@/test/mocks/contexts")).musicPlayerMock(),
);

Object.assign(globalThis, { React });

describe("BoardRail", () => {
  it("shows the Totem target cell count on its glyph", () => {
    render(
      <BoardRail
        themeId="theme-1"
        activeBonus={2}
        bonusSlots={[
          {
            type: 2,
            charges: 1,
            isActive: true,
            icon: "/totem.png",
            name: "Totem",
            description: "Break matching widths",
            triggerDescription: "Every 3 combos",
            totemTarget: { width: 2, cells: 6 },
            startingCharges: 1,
            onClick: vi.fn(),
          },
        ]}
        movesRemaining={9}
        maxMoves={20}
        onSurrender={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Totem: 1 charges; width 2 removes 6 cells",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("×6")).toBeInTheDocument();
  });
});
