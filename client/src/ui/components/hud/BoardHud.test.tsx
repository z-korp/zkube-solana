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
        streak={0}
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

  it("renders the Theme sentence, streak, and named pressure step", () => {
    render(
      <BoardHud
        isDaily
        zoneId={2}
        mood="idle"
        score={420}
        targetScore={0}
        themeScore={12}
        themeDescription="width-3 blocks broken"
        level={1}
        combo={3}
        streak={2}
        comboThreshold={2}
        pressureScore={25}
        currentDifficulty={1}
        pressureThresholds={[10, 40, 80, 150, 280, 500, 900]}
        pressureScoreMultipliersX100={[
          100, 150, 200, 300, 400, 600, 800, 1_000,
        ]}
        gameLevel={null}
        constraintProgress={0}
        constraint2Progress={0}
        latchedStarSources={0}
      />,
    );

    expect(screen.getByText("width-3 blocks broken")).toBeInTheDocument();
    expect(screen.getByText("2 streak")).toBeInTheDocument();
    expect(screen.getByText("Easy ×1.5 · 15 to Medium")).toBeInTheDocument();
  });
});
