import React from "react";
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PublicKey } from "@solana/web3.js";

import { useNavigationStore } from "@/stores/navigationStore";
import BottomNav from "./BottomNav";

const fixtures = vi.hoisted(() => ({
  publicKey: null as unknown,
}));

vi.mock("@/contexts/progress", () => ({
  useProgress: () => ({ progress: null }),
}));

vi.mock("@/chain/connectedPlayerContext", () => ({
  useConnectedPlayer: () => ({ publicKey: fixtures.publicKey }),
}));

vi.mock("@/ui/elements/theme-provider/hooks", async () => {
  const { getThemeColors } = await import("@/config/themes");
  return {
    useTheme: () => ({ themeTemplate: "theme-1" }),
    useThemeColors: () => getThemeColors("theme-1"),
  };
});

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
  it("places Shop between Arena and Profile", () => {
    fixtures.publicKey = PublicKey.default;
    render(<BottomNav />);

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Home",
      "Rewards",
      "Arena",
      "Shop",
      "Profile",
    ]);
    expect(buttons.every((button) => !button.hasAttribute("disabled"))).toBe(
      true,
    );
  });

  it("locks every tab until a wallet is connected", () => {
    fixtures.publicKey = null;
    render(<BottomNav />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});
