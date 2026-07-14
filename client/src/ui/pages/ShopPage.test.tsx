import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PublicKey } from "@solana/web3.js";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { StarPackQuote, StarShopView } from "@/chain/shopClient";
import ShopPage from "./ShopPage";

const fixtures = vi.hoisted(() => ({
  identity: {
    publicKey: null as PublicKey | null,
    usdcBaseUnits: 20_000_000n as bigint | null,
    refreshBalance: vi.fn(),
  },
  campaignRefresh: vi.fn(),
  progressRefresh: vi.fn(),
  dailyRefresh: vi.fn(),
  navigation: {
    shopOrigin: "daily" as "daily" | "home" | null,
    navigate: vi.fn(),
    goBack: vi.fn(),
    openWalletSettings: vi.fn(),
  },
  controller: {
    shop: null as StarShopView | null,
    loading: false,
    purchasingPack: null as number | null,
    error: null as string | null,
    refresh: vi.fn(),
    purchase: vi.fn(),
  },
}));

vi.mock("@/chain/connectedPlayerContext", () => ({
  useConnectedPlayer: () => fixtures.identity,
}));

vi.mock("@/chain/useShopController", () => ({
  StarShopQuoteChangedError: class StarShopQuoteChangedError extends Error {},
  useShopController: () => fixtures.controller,
}));

vi.mock("@/contexts/campaign", () => ({
  useCampaign: () => ({ refresh: fixtures.campaignRefresh }),
}));

vi.mock("@/contexts/progress", () => ({
  useProgress: () => ({ refresh: fixtures.progressRefresh }),
}));

vi.mock("@/contexts/daily", () => ({
  useDaily: () => ({ refresh: fixtures.dailyRefresh }),
}));

vi.mock("@/stores/navigationStore", () => ({
  useNavigationStore: (
    selector: (state: typeof fixtures.navigation) => unknown,
  ) => selector(fixtures.navigation),
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
  vi.clearAllMocks();
  fixtures.identity.usdcBaseUnits = 20_000_000n;
  fixtures.identity.publicKey = PublicKey.default;
  fixtures.identity.refreshBalance.mockResolvedValue(0);
  fixtures.campaignRefresh.mockResolvedValue(null);
  fixtures.progressRefresh.mockResolvedValue(null);
  fixtures.dailyRefresh.mockResolvedValue(null);
  fixtures.navigation.shopOrigin = "daily";
  fixtures.controller.shop = shopView();
  fixtures.controller.loading = false;
  fixtures.controller.purchasingPack = null;
  fixtures.controller.error = null;
  fixtures.controller.purchase.mockResolvedValue("devnet-signature-1234");
  fixtures.controller.refresh.mockResolvedValue(fixtures.controller.shop);
});

describe("ShopPage", () => {
  it("renders five packs, dynamic spending power, and merchandising badges", () => {
    render(<ShopPage />);

    expect(screen.getAllByRole("button", { name: /Stars for/ })).toHaveLength(5);
    expect(screen.getByText("Popular")).toBeInTheDocument();
    expect(screen.getByText("Best value")).toBeInTheDocument();
    expect(screen.getByText(/1 Daily entry · 10\/40 toward a zone/)).toBeInTheDocument();
    expect(screen.getByText(/10 Daily entries · 2 zone unlocks/)).toBeInTheDocument();
    expect(screen.getByText(/Devnet · Test USDC/)).toBeInTheDocument();
  });

  it("shows the exact confirmation and refreshes all balances after purchase", async () => {
    render(<ShopPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "100 Stars for 5 USDC" }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Atomic payment split")).toBeInTheDocument();
    expect(screen.getAllByText("0.5 USDC")).toHaveLength(2);
    expect(screen.getByText("4 USDC")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve 5 USDC in wallet" }));
    await waitFor(() =>
      expect(fixtures.controller.purchase).toHaveBeenCalledWith(
        expect.objectContaining({ index: 1, stars: 100n }),
      ),
    );
    await waitFor(() => {
      expect(fixtures.campaignRefresh).toHaveBeenCalledOnce();
      expect(fixtures.progressRefresh).toHaveBeenCalledOnce();
      expect(fixtures.dailyRefresh).toHaveBeenCalledOnce();
      expect(fixtures.identity.refreshBalance).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole("button", { name: "Return to Daily" })).toBeEnabled();
  });

  it("routes an underfunded pack directly to wallet settings", () => {
    fixtures.identity.usdcBaseUnits = 0n;
    render(<ShopPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "10 Stars for 1 USDC" }),
    );
    expect(fixtures.navigation.openWalletSettings).toHaveBeenCalledWith("shop");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows live sale pricing and the regular price", () => {
    const sale = shopView();
    sale.saleEnabled = true;
    sale.saleLive = true;
    sale.saleStartsAt = BigInt(Math.floor(Date.now() / 1_000) - 60);
    sale.saleEndsAt = BigInt(Math.floor(Date.now() / 1_000) + 3_600);
    sale.packs[0] = {
      ...sale.packs[0],
      currentPrice: 900_000n,
      salePrice: 900_000n,
      onSale: true,
    };
    fixtures.controller.shop = sale;
    render(<ShopPage />);

    expect(screen.getByText("Star sale live")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "10 Stars for 0.9 USDC" })).toHaveTextContent(
      "1",
    );
    expect(screen.getByText("Save 10%")).toBeInTheDocument();
  });
});

function shopView(): StarShopView {
  const prices = [1_000_000n, 5_000_000n, 10_000_000n, 40_000_000n, 80_000_000n];
  const stars = [10n, 100n, 250n, 500n, 1_000n];
  const packs = stars.map((value, index): StarPackQuote => ({
    index,
    stars: value,
    regularPrice: prices[index],
    currentPrice: prices[index],
    salePrice: prices[index],
    enabled: true,
    onSale: false,
  }));
  return {
    economyVersion: 2,
    revision: 1n,
    playerInitialized: true,
    starsBalance: 25n,
    dailyEntryStars: 10n,
    zoneUnlockStars: 40n,
    protocolPaused: false,
    paymentMint: PublicKey.default,
    paymentTokenProgram: PublicKey.default,
    teamDestination: PublicKey.default,
    rewardVault: PublicKey.default,
    treasuryDestination: PublicKey.default,
    saleEnabled: false,
    saleStartsAt: 0n,
    saleEndsAt: 0n,
    saleLive: false,
    packs,
  };
}
