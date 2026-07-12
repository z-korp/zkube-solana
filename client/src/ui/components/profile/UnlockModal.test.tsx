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
import UnlockModal, { formatUsdcBaseUnits } from "./UnlockModal";

const campaign = vi.hoisted(() => ({
  unlock: vi.fn(),
  controller: {
    campaign: { starsBalance: 50n },
    unlocking: false,
    error: null as string | null,
  },
}));

vi.mock("@/contexts/campaign", () => ({
  useCampaignController: () => ({
    ...campaign.controller,
    unlock: campaign.unlock,
  }),
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
  campaign.controller.campaign = { starsBalance: 50n };
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
  price: 2_500_000n,
  currentStars: 50,
};

describe("UnlockModal", () => {
  it("formats six-decimal USDC base units without floating point", () => {
    expect(formatUsdcBaseUnits(2_500_000n)).toBe("2.5");
    expect(formatUsdcBaseUnits(1_000_001n)).toBe("1.000001");
  });

  it("offers only full Stars or full USDC campaign unlocks", async () => {
    const onClose = vi.fn();
    render(
      <UnlockModal
        colors={getThemeColors("theme-2")}
        zone={zone}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("2.5 USDC")).toBeInTheDocument();
    expect(screen.queryByText(/discount/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "10%" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /unlock with stars/i }));
    await waitFor(() =>
      expect(campaign.unlock).toHaveBeenCalledWith(2, "stars"),
    );

    fireEvent.click(screen.getByRole("button", { name: /buy now/i }));
    await waitFor(() =>
      expect(campaign.unlock).toHaveBeenCalledWith(2, "usdc"),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
