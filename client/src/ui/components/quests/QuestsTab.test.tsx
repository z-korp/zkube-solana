import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import QuestsTab from "./QuestsTab";

const mocks = vi.hoisted(() => ({
  claimQuest: vi.fn<(index: number) => Promise<string>>(),
}));

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
        cubeReward: 0,
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
        claimed: false,
        claimable: true,
        active: true,
      },
    ],
    isLoading: false,
    claiming: null,
    error: null,
    claimQuest: mocks.claimQuest,
  }),
}));

vi.mock("@/ui/components/shared/ProgressBar", () => ({
  default: () => null,
}));

describe("QuestsTab", () => {
  beforeEach(() => {
    mocks.claimQuest.mockReset();
    mocks.claimQuest.mockResolvedValue("signature");
  });

  it("claims a live quest by its catalog index", () => {
    render(<QuestsTab />);

    fireEvent.click(screen.getByRole("button", { name: "Claim +100 XP" }));

    expect(mocks.claimQuest).toHaveBeenCalledWith(3);
  });
});
