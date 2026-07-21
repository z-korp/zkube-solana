import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AchievementsTab from "./AchievementsTab";

vi.mock("@/hooks/useAchievements", () => ({
  ACHIEVEMENT_CATEGORIES: [
    "Grinder",
    "Sweeper",
    "Combo Master",
    "Guardian Slayer",
    "Explorer",
    "Challenger",
  ],
  useAchievements: () => ({
    achievements: [
      {
        id: 1n,
        shortId: "GRINDER_I",
        name: "Grinder I",
        description: "Start a run",
        target: 1,
        xp: 50,
        category: "Grinder",
        tier: 1,
        icon: "🎮",
        taskId: 2n,
        index: 0,
        progress: 1,
        completed: true,
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/ui/components/shared/ProgressBar", () => ({
  default: () => null,
}));

describe("AchievementsTab", () => {
  it("shows completed achievement XP without a claim action", () => {
    render(<AchievementsTab />);

    expect(screen.getByText("All tiers complete")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /claim/i })).toBeNull();
  });
});
