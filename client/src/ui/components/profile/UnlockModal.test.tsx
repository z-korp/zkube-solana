import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getThemeColors } from "@/config/themes";
import type { ZoneProgressData } from "@/config/profileData";
import UnlockModal from "./UnlockModal";

const campaign = vi.hoisted(() => ({
  unlock: vi.fn(),
  controller: {
    campaign: {
      starsBalance: 50n,
      economyVersion: 2 as const,
    },
    unlocking: false,
    error: null as string | null,
  },
}));

vi.mock("@/contexts/campaign", () => ({
  useCampaign: () => ({
    ...campaign.controller,
    unlock: campaign.unlock,
  }),
}));

const navigation = vi.hoisted(() => ({ openShop: vi.fn() }));

vi.mock("@/stores/navigationStore", () => ({
  useNavigationStore: (
    selector: (state: typeof navigation) => unknown,
  ) => selector(navigation),
}));

beforeAll(() => {
  // vitest.config.ts does not load Vite's React JSX transform.
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  campaign.unlock.mockReset();
  campaign.unlock.mockResolvedValue("signature");
  navigation.openShop.mockReset();
  campaign.controller.campaign = {
    starsBalance: 50n,
    economyVersion: 2,
  };
  campaign.controller.unlocking = false;
  campaign.controller.error = null;
});

const zone: ZoneProgressData = {
  zoneId: 2,
  settingsId: 2,
  name: "Egypt",
  emoji: "🏛️",
  stars: 0,
  maxStars: 30,
  unlocked: false,
  cleared: false,
  isFree: false,
  starCost: 40,
  currentStars: 50,
};

describe("UnlockModal", () => {
  it("unlocks zones only with Stars", async () => {
    const onClose = vi.fn();
    render(
      <UnlockModal
        colors={getThemeColors("theme-2")}
        zone={zone}
        onClose={onClose}
      />,
    );

    expect(screen.queryByText("2.5 USDC")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /unlock for 40★/i }));
    await waitFor(() =>
      expect(campaign.unlock).toHaveBeenCalledWith(2),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("routes insufficient players to the dedicated Shop", () => {
    campaign.controller.campaign = {
      starsBalance: 10n,
      economyVersion: 2,
    };
    const onClose = vi.fn();
    render(
      <UnlockModal
        colors={getThemeColors("theme-2")}
        zone={zone}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /get stars/i }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(navigation.openShop).toHaveBeenCalledWith("home");
  });

  it("shows a disabled loading state while the price is unknown", () => {
    render(
      <UnlockModal
        colors={getThemeColors("theme-2")}
        zone={{ ...zone, starCost: undefined }}
        onClose={vi.fn()}
      />,
    );

    const cta = screen.getByRole("button", { name: /loading price/i });
    expect(cta).toBeDisabled();
    expect(screen.queryByText(/0★ /)).not.toBeInTheDocument();
    expect(screen.queryByText(/unlock for/i)).not.toBeInTheDocument();
  });
});
