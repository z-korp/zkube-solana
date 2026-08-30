import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BoardRail from "./BoardRail";
import { useNavigationStore } from "@/stores/navigationStore";

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

  it("opens the shared settings sheet and keeps give-up behind two taps", () => {
    const onSurrender = vi.fn();
    useNavigationStore.setState({ settingsOpen: false });
    render(
      <BoardRail
        themeId="theme-1"
        activeBonus={0}
        bonusSlots={[]}
        movesRemaining={9}
        maxMoves={20}
        onSurrender={onSurrender}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(useNavigationStore.getState().settingsOpen).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Give up this run" }));
    expect(onSurrender).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm give up" }));
    expect(onSurrender).toHaveBeenCalledOnce();
  });
});
