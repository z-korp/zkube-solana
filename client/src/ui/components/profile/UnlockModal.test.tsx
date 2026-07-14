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
  buyStars: vi.fn(),
  controller: {
    campaign: {
      starsBalance: 50n,
      economyVersion: 2 as const,
      starPacks: [] as { stars: bigint; price: bigint; enabled: boolean }[],
    },
    unlocking: false,
    error: null as string | null,
  },
}));

vi.mock("@/contexts/campaign", () => ({
  useCampaign: () => ({
    ...campaign.controller,
    unlock: campaign.unlock,
    buyStars: campaign.buyStars,
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
  campaign.buyStars.mockReset();
  campaign.buyStars.mockResolvedValue("signature");
  campaign.controller.campaign = {
    starsBalance: 50n,
    economyVersion: 2,
    starPacks: [],
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
  it("formats six-decimal USDC base units without floating point", () => {
    expect(formatUsdcBaseUnits(2_500_000n)).toBe("2.5");
    expect(formatUsdcBaseUnits(1_000_001n)).toBe("1.000001");
  });

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

    fireEvent.click(screen.getByRole("button", { name: /unlock with stars/i }));
    await waitFor(() =>
      expect(campaign.unlock).toHaveBeenCalledWith(2),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("exposes canonical Star packs", async () => {
    campaign.controller.campaign = {
      starsBalance: 10n,
      economyVersion: 2,
      starPacks: [{ stars: 10n, price: 1_000_000n, enabled: true }],
    };
    render(
      <UnlockModal
        colors={getThemeColors("theme-2")}
        zone={zone}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText("2.5 USDC")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /buy now/i })).toBeNull();
    expect(screen.getByText(/bound to this Vault/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /10★.*1 USDC/i }));
    await waitFor(() => expect(campaign.buyStars).toHaveBeenCalledWith(0));
  });
});
