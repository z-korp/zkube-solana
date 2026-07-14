import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import SegmentedTabs from "./SegmentedTabs";

beforeAll(() => {
  // vitest.config.ts does not load Vite's React JSX transform.
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const TABS = ["Quests", "Daily", "Weekly"] as const;

describe("SegmentedTabs", () => {
  it("renders every tab and reports switches", () => {
    const onChange = vi.fn();
    render(
      <SegmentedTabs
        tabs={TABS}
        active="Quests"
        onChange={onChange}
        layoutId="test-tabs"
      />,
    );

    for (const tab of TABS) {
      expect(screen.getByRole("button", { name: tab })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    expect(onChange).toHaveBeenCalledWith("Weekly");
  });

  it("shows a badge count on the flagged tab", () => {
    render(
      <SegmentedTabs
        tabs={TABS}
        active="Daily"
        onChange={vi.fn()}
        layoutId="test-tabs-badge"
        badges={{ Quests: 3 }}
      />,
    );

    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
