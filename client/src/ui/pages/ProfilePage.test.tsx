import React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getZoneGuardian } from "@/config/bossCharacters";
import ProfilePage from "./ProfilePage";

const model = vi.hoisted(() => ({
  wornEmblem: 0, wornBorder: 0, highestTier: 1,
  setWorn: vi.fn<(emblem: number, border: number) => Promise<void>>().mockResolvedValue(undefined),
  zones: [] as { zoneId: number; stars: number; maxStars: number; cleared: boolean; unlocked: boolean }[],
}));
vi.mock("@/backend/client", () => ({
  useConnectedPlayer: () => ({ publicKey: "11111111111111111111111111111111", balanceLamports: 0 }),
  useClientState: () => ({ identity: { label: "Player" }, economy: { profile: model } }),
  useIdentityActions: () => ({ setWorn: model.setWorn }),
  useDaily: () => ({ daily: null }),
}));
vi.mock("@/hooks/usePlayerProfile", () => ({ usePlayerProfile: () => ({
  featuredEmblem: model.wornEmblem, featuredFrameTier: model.wornBorder,
  highestLadderTier: model.highestTier, ladderPoints: 0n, entryStreakDays: 0,
  lifetimePaidEntries: 0n, bestDailyScore: 0, totalRewardsLamports: 0n,
  scoreRecord: { bestPrizeRank: 0, wins: 0, podiums: 0, rewardsLamports: 0n },
  themeRecord: { bestPrizeRank: 0, wins: 0, podiums: 0, rewardsLamports: 0n },
}) }));
vi.mock("@/hooks/useZoneProgress", () => ({ useZoneProgress: () => ({
  zones: model.zones, totalStars: model.zones.reduce((sum, zone) => sum + zone.stars, 0),
}) }));
vi.mock("@/ui/elements/theme-provider/hooks", () => ({ useThemeColors: () => ({ accent: "#A855F7" }) }));
vi.mock("@/ui/components/shared/ZoneBackdrop", () => ({ default: () => null }));
vi.mock("@/ui/components/economy", () => ({
  MONEY_GOLD: "#FACC15", mixHex: (color: string) => color,
  TierFrame: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  EmblemBadge: () => null, GuardianFaceBlock: () => null, KreditCoin: () => null, SolMark: () => null,
}));

beforeEach(() => {
  model.wornEmblem = 0; model.wornBorder = 0; model.highestTier = 1;
  model.setWorn.mockClear();
  model.zones = Array.from({ length: 10 }, (_, index) => ({
    zoneId: index + 1, stars: index === 0 ? 10 : 0, maxStars: 30,
    cleared: index === 0, unlocked: index < 2,
  }));
});
afterEach(cleanup);

describe("money profile identity selection", () => {
  it("keeps a visible but undefeated guardian unavailable to wear", () => {
    render(<ProfilePage />);
    const button = screen.getByRole("button", { name: `Wear the ${getZoneGuardian(2).name} emblem` });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(model.setWorn).not.toHaveBeenCalled();
  });

  it("preserves Automatic when only the border changes after earning a guardian", async () => {
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: "Wear the Copper border" }));
    await waitFor(() => expect(model.setWorn).toHaveBeenCalledWith(0, 1));
  });

  it("can explicitly select the guardian currently displayed by Automatic", async () => {
    render(<ProfilePage />);
    const button = screen.getByRole("button", { name: `Wear the ${getZoneGuardian(1).name} emblem` });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    await waitFor(() => expect(model.setWorn).toHaveBeenCalledWith(1, 0));
  });

  it("does not write again when the selected stored identity is unchanged", () => {
    model.wornEmblem = 1;
    render(<ProfilePage />);
    const button = screen.getByRole("button", { name: `Wear the ${getZoneGuardian(1).name} emblem` });
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);
    expect(model.setWorn).not.toHaveBeenCalled();
  });

  it("can restore Automatic without changing the stored border", async () => {
    model.wornEmblem = 1; model.wornBorder = 1;
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: "Wear the Automatic emblem" }));
    await waitFor(() => expect(model.setWorn).toHaveBeenCalledWith(0, 1));
  });

  it("keeps a fresh profile neutral while wearing an earned border", async () => {
    model.zones[0] = { ...model.zones[0]!, stars: 0, cleared: false };
    render(<ProfilePage />);
    fireEvent.click(screen.getByRole("button", { name: "Wear the Copper border" }));
    await waitFor(() => expect(model.setWorn).toHaveBeenCalledWith(0, 1));
  });

  it("keeps a border earned before a points reset selectable", async () => {
    model.highestTier = 4;
    render(<ProfilePage />);
    const button = screen.getByRole("button", { name: "Wear the Prism border" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(model.setWorn).toHaveBeenCalledWith(0, 4));
  });
});
