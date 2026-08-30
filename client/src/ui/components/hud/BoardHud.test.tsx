import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConstraintType } from "@/game/constraint";
import BoardHud from "./BoardHud";

Object.assign(globalThis, { React });

describe("BoardHud", () => {
  it("labels the cumulative Shape bar and moment Blow state", () => {
    render(
      <BoardHud
        isDaily={false}
        zoneId={1}
        mood="idle"
        score={30}
        targetScore={100}
        themeScore={0}
        level={2}
        combo={0}
        comboThreshold={2}
        pressureScore={0}
        currentDifficulty={0}
        pressureThresholds={[1, 2, 3, 4, 5, 6, 7]}
        pressureScoreMultipliersX100={[100, 100, 100, 100, 100, 100, 100, 100]}
        gameLevel={{
          gameId: 1n,
          level: 2,
          pointsRequired: 100,
          maxMoves: 20,
          difficulty: 0,
          constraintType: ConstraintType.ClearLines,
          constraintValue: 0,
          constraintCount: 12,
          constraint2Type: ConstraintType.PerfectClear,
          constraint2Value: 0,
          constraint2Count: 1,
        }}
        constraintProgress={5}
        constraint2Progress={0}
        latchedStarSources={0b010}
      />,
    );

    expect(screen.getByLabelText("Shape: Clear 12 lines")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Shape progress" }),
    ).toHaveAttribute("aria-valuenow", "5");
    expect(screen.getByLabelText("Blow: Empty the board")).toBeInTheDocument();
    expect(screen.getByText("◇ Waiting for one move")).toBeInTheDocument();
  });
});
