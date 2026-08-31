import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ClientDailyView } from "@/backend/client";
import DailyBoardsPreview from "./DailyBoardsPreview";

const view = {
  boards: [],
} as unknown as ClientDailyView;

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

describe("DailyBoardsPreview", () => {
  it("opens the full board selected by its column header", () => {
    const onOpenBoard = vi.fn();
    render(
      <DailyBoardsPreview
        view={view}
        address={null}
        onOpenBoard={onOpenBoard}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open score leaderboard" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open theme leaderboard" }),
    );

    expect(onOpenBoard.mock.calls).toEqual([["score"], ["theme"]]);
  });
});
