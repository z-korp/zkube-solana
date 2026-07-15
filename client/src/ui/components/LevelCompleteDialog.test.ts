import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { calculateLevelStars } from "@/game/level";
import LevelCompleteDialog from "./LevelCompleteDialog";

vi.mock("@/contexts/hooks", () => ({
  useMusicPlayer: () => ({ playSfx: vi.fn() }),
}));

// Vitest does not load Vite's React JSX plugin; nested legacy components use
// the classic JSX runtime while the production build uses the automatic one.
Object.assign(globalThis, { React });

describe("calculateLevelStars", () => {
  it("uses the inclusive on-chain move thresholds", () => {
    expect(
      calculateLevelStars({
        movesUsed: 8,
        star3UsedCap: 8,
        star2UsedCap: 12,
        isIncomplete: false,
      }),
    ).toBe(3);
    expect(
      calculateLevelStars({
        movesUsed: 12,
        star3UsedCap: 8,
        star2UsedCap: 12,
        isIncomplete: false,
      }),
    ).toBe(2);
    expect(
      calculateLevelStars({
        movesUsed: 13,
        star3UsedCap: 8,
        star2UsedCap: 12,
        isIncomplete: false,
      }),
    ).toBe(1);
  });

  it("does not award stars to an incomplete run", () => {
    expect(
      calculateLevelStars({
        movesUsed: 1,
        star3UsedCap: 8,
        star2UsedCap: 12,
        isIncomplete: true,
      }),
    ).toBe(0);
  });

  it("shows the confirmed campaign XP delta", () => {
    render(
      React.createElement(LevelCompleteDialog, {
        isOpen: true,
        onClose: vi.fn(),
        level: 2,
        levelMoves: 8,
        prevTotalScore: 0,
        totalScore: 120,
        gameLevel: {
          gameId: 7n,
          level: 2,
          pointsRequired: 100,
          maxMoves: 20,
          difficulty: 1,
          constraintType: 0,
          constraintValue: 0,
          constraintCount: 0,
          constraint2Type: 0,
          constraint2Value: 0,
          constraint2Count: 0,
          mutatorId: 0,
          star3Threshold: 10,
          star2Threshold: 15,
        },
        xpAwarded: 20,
      }),
    );

    expect(screen.getByText("+20 XP")).toBeInTheDocument();
  });
});
