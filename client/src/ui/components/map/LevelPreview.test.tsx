import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConstraintType } from "@/game/constraint";
import { getThemeColors } from "@/config/themes";
import type { MapNodeData } from "@/hooks/useMapData";
import LevelPreview from "./LevelPreview";

Object.assign(globalThis, { React });

vi.mock("@/ui/components/shared/GuardianQuote", () => ({
  default: () => null,
}));
vi.mock("@/ui/components/shared/useGuardianTalk", () => ({
  useGuardianTalk: () => ({ src: "/guardian.png", text: "", typing: false }),
}));

describe("LevelPreview", () => {
  it("labels all three star sources before play and names the realm trigger", () => {
    const levelConfig = {
      gameId: 1n,
      level: 6,
      pointsRequired: 120,
      maxMoves: 18,
      difficulty: 3,
      constraintType: ConstraintType.TriggerFired,
      constraintValue: 0,
      constraintCount: 2,
      constraint2Type: ConstraintType.PerfectClear,
      constraint2Value: 0,
      constraint2Count: 1,
    };
    const node: MapNodeData = {
      nodeIndex: 5,
      zone: 2,
      nodeInZone: 5,
      type: "classic",
      draftPhase: null,
      contractLevel: 6,
      displayLabel: "6",
      state: "current",
      levelConfig,
      zoneTheme: "theme-2",
    };

    render(
      <LevelPreview
        node={node}
        game={null}
        gameLevel={levelConfig}
        zoneId={2}
        colors={getThemeColors("theme-2")}
        onPlay={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Star rules latch in any order"),
    ).toBeInTheDocument();
    expect(screen.getByText("★")).toBeInTheDocument();
    expect(screen.getByText("★★")).toBeInTheDocument();
    expect(screen.getByText("★★★")).toBeInTheDocument();
    expect(screen.getByText("Reach 120 Score")).toBeInTheDocument();
    expect(screen.getByText("Fire Sobek's Strike 2 times")).toBeInTheDocument();
  });
});
