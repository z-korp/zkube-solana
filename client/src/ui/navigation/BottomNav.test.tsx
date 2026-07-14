import React from "react";
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useNavigationStore } from "@/stores/navigationStore";
import BottomNav from "./BottomNav";

vi.mock("@/contexts/progress", () => ({
  useProgress: () => ({ progress: null }),
}));

vi.mock("@/ui/elements/theme-provider/hooks", () => ({
  useTheme: () => ({ themeTemplate: "theme-1" }),
}));

beforeAll(() => {
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  useNavigationStore.setState({
    currentPage: "home",
    previousPage: null,
    isTransitioning: false,
    transitionDirection: null,
    shopOrigin: null,
  });
});

describe("BottomNav", () => {
  it("places Shop between Ranks and Profile and uses the compact Ranks label", () => {
    render(<BottomNav />);

    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Home", "Rewards", "Ranks", "Shop", "Profile", "Settings"]);
  });
});
