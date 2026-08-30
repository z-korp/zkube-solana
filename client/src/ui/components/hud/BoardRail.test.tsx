import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByText(/Every 3 combos/)).toBeInTheDocument();
  });

  it("explains spending and reroll on first tap or long press", () => {
    vi.useFakeTimers();
    try {
      const hammer = vi.fn();
      render(
        <BoardRail
          themeId="theme-1"
          activeBonus={0}
          runId={7n}
          bonusSlots={[
            {
              type: 1,
              charges: 1,
              isActive: true,
              icon: "/hammer.png",
              name: "Hammer",
              description: "Destroy a single block",
              triggerDescription: "Clear exactly 2 lines in a move",
              triggerProgress: {
                current: 0,
                threshold: 2,
                suffix: "this move",
              },
              onClick: hammer,
            },
            {
              type: "reroll",
              charges: 2,
              isActive: true,
              icon: "/reroll.png",
              name: "Reroll",
              description:
                "Replaces the next row · perfect clear awards +1 · hold up to 3",
              triggerDescription: "Held rerolls",
              onClick: vi.fn(),
            },
          ]}
          movesRemaining={9}
          maxMoves={20}
          onSurrender={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /Hammer: 1 charge/ }));
      expect(screen.getByRole("status")).toHaveTextContent(
        "Destroy a single block",
      );
      expect(hammer).toHaveBeenCalledOnce();

      fireEvent.pointerDown(
        screen.getByRole("button", { name: /Reroll: 2 charges/ }),
      );
      act(() => vi.advanceTimersByTime(550));
      expect(screen.getByRole("status")).toHaveTextContent(
        "Replaces the next row · perfect clear awards +1 · hold up to 3",
      );
    } finally {
      vi.useRealTimers();
    }
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
