import React from "react";
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PublicKey } from "@solana/web3.js";

import { useNavigationStore } from "@/stores/navigationStore";
import BottomNav from "./BottomNav";

const fixtures = vi.hoisted(() => ({
  publicKey: null as unknown,
}));

vi.mock("@/chain/connectedPlayerContext", async () =>
  (await import("@/test/mocks/contexts")).connectedPlayerMock(() => ({
    publicKey: fixtures.publicKey,
  })),
);

vi.mock("@/ui/elements/theme-provider/hooks", async () =>
  (await import("@/test/mocks/theme")).themeHooksMock(),
);

beforeAll(() => {
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  useNavigationStore.setState({
    currentPage: "arcade",
    previousPage: null,
    isTransitioning: false,
    transitionDirection: null,
  });
});

describe("BottomNav", () => {
  it("renders the four-tab nav with Home first — Ranks is merged into Arcade", () => {
    fixtures.publicKey = PublicKey.default;
    render(<BottomNav />);

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Home",
      "Arcade",
      "Campaign",
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
