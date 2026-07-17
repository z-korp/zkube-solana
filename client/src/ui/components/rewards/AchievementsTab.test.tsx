import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AchievementsTab from "./AchievementsTab";

const { claimAchievement } = vi.hoisted(() => ({
  claimAchievement: vi.fn<() => Promise<string>>(),
}));

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
        claimed: false,
        claimable: true,
      },
    ],
    isLoading: false,
    claiming: null,
    error: null,
    claimAchievement,
  }),
}));

vi.mock("@/ui/components/shared/ProgressBar", () => ({
  default: () => null,
}));

describe("AchievementsTab", () => {
  beforeEach(() => {
    claimAchievement.mockReset();
    claimAchievement.mockResolvedValue("signature");
  });

  it("claims the on-chain achievement by catalog index", () => {
    render(<AchievementsTab />);

    fireEvent.click(screen.getByRole("button", { name: "Claim +50 XP" }));

    expect(claimAchievement).toHaveBeenCalledWith(0);
  });
});
