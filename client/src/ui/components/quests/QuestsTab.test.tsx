import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import QuestsTab from "./QuestsTab";

vi.mock("@/hooks/useQuests", () => ({
  groupQuests: (quests: Array<{ type: string }>) => ({
    daily: quests.filter((quest) => quest.type === "daily"),
    weekly: quests.filter((quest) => quest.type === "weekly"),
    finisher: quests.filter((quest) => quest.type === "finisher"),
  }),
  useQuests: () => ({
    quests: [
      {
        id: 1n,
        shortId: "QUEST_LINE_SWEEPER",
        name: "Line Sweeper",
        description: "Clear 20 lines",
        target: 20,
        xpReward: 100,
        type: "daily",
        icon: "📏",
        taskId: 2n,
        start: 0,
        duration: 86_400,
        interval: 86_400,
        index: 3,
        intervalId: 1,
        progress: 20,
        completed: true,
        active: true,
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/ui/components/shared/ProgressBar", () => ({
  default: () => null,
}));

describe("QuestsTab", () => {
  it("shows completed quest XP as already applied", () => {
    render(<QuestsTab />);

    expect(screen.getByText("Complete · XP applied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /claim/i })).toBeNull();
  });
});
