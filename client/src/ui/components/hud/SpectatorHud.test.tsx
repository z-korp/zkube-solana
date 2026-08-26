import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeActiveRun, makeRunRules } from "@/test/fixtures/activeRun";
import SpectatorHud from "./SpectatorHud";

Object.assign(globalThis, { React });

describe("SpectatorHud", () => {
  it("shows Shape as progress and Blow as a waiting moment", () => {
    render(
      <SpectatorHud
        run={makeActiveRun({
          score: 30,
          primaryProgress: 5,
          secondaryProgress: 0,
          rules: makeRunRules({
            pointsRequired: 100,
            primary: { kind: 3, value: 0, requiredCount: 12 },
            secondary: { kind: 16, value: 0, requiredCount: 1 },
          }),
        })}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Shape: Clear 12 lines")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Shape progress" }),
    ).toHaveAttribute("aria-valuenow", "5");
    expect(screen.getByLabelText("Blow: Empty the board")).toBeInTheDocument();
    expect(screen.getByText("◇ Waiting")).toBeInTheDocument();
  });
});
