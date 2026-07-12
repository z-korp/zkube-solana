import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { getThemeColors } from "@/config/themes";
import TierContext from "./TierContext";

describe("TierContext", () => {
  it("shows adjacent live scores without inventing reward tiers", () => {
    render(
      <TierContext
        colors={getThemeColors("theme-1")}
        myRank={2}
        myScore={850}
        totalEntries={3}
        entries={[
          { rank: 1, score: 1_000, name: "First" },
          { rank: 2, score: 850, name: "You" },
          { rank: 3, score: 700, name: "Third" },
        ]}
        scoreLabel=" pts"
      />,
    );

    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Third")).toBeInTheDocument();
    expect(screen.getByText("850 pts")).toBeInTheDocument();
    expect(screen.queryByText(/projected|reward|★/i)).not.toBeInTheDocument();
  });
});
