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

import type { CubePackQuote, CubeShopView } from "@/chain/shopClient";
import ShopPage from "./ShopPage";

const fixtures = vi.hoisted(() => ({
  identity: {
    publicKey: null as PublicKey | null,
    balanceLamports: 2_000_000_000 as number | null,
    refreshBalance: vi.fn(),
  },
  campaignRefresh: vi.fn(),
  progressRefresh: vi.fn(),
  dailyRefresh: vi.fn(),
  navigation: {
    shopOrigin: "ranks" as "ranks" | "home" | null,
    navigate: vi.fn(),
    goBack: vi.fn(),
    openWalletSettings: vi.fn(),
  },
  controller: {
    shop: null as CubeShopView | null,
    loading: false,
    purchasingPack: null as number | null,
    error: null as string | null,
    refresh: vi.fn(),
    purchase: vi.fn(),
  },
}));

vi.mock("@/chain/connectedPlayerContext", async () =>
  (await import("@/test/mocks/contexts")).connectedPlayerMock(
    fixtures.identity,
  ),
);

vi.mock("@/chain/useShopController", () => ({
  CubeShopQuoteChangedError: class CubeShopQuoteChangedError extends Error {},
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

vi.mock("@/stores/navigationStore", async () =>
  (await import("@/test/mocks/navigation")).navigationStoreMock(
    fixtures.navigation,
  ),
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
  vi.clearAllMocks();
  fixtures.identity.balanceLamports = 2_000_000_000;
  fixtures.identity.publicKey = PublicKey.default;
  fixtures.identity.refreshBalance.mockResolvedValue(0);
  fixtures.campaignRefresh.mockResolvedValue(null);
  fixtures.progressRefresh.mockResolvedValue(null);
  fixtures.dailyRefresh.mockResolvedValue(null);
  fixtures.navigation.shopOrigin = "ranks";
  fixtures.controller.shop = shopView();
  fixtures.controller.loading = false;
  fixtures.controller.purchasingPack = null;
  fixtures.controller.error = null;
  fixtures.controller.purchase.mockResolvedValue("devnet-signature-1234");
  fixtures.controller.refresh.mockResolvedValue(fixtures.controller.shop);
});

describe("ShopPage", () => {
  it("renders every purchasable pack", () => {
    render(<ShopPage />);

    expect(screen.getAllByRole("button", { name: /Cubes for/ })).toHaveLength(
      4,
    );
  });

  it("shows the exact confirmation and refreshes all balances after purchase", async () => {
    render(<ShopPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "200 Cubes for 0.3 SOL" }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("+200 Cubes")).toBeInTheDocument();
    expect(screen.getByText("▣ 225")).toBeInTheDocument();
    expect(screen.getByText(/Daily Arena retries/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Buy 200 Cubes for 0.3 SOL" }),
    );
    await waitFor(() =>
      expect(fixtures.controller.purchase).toHaveBeenCalledWith(
        expect.objectContaining({ index: 2, cubes: 200n }),
      ),
    );
    await waitFor(() => {
      expect(fixtures.campaignRefresh).toHaveBeenCalledOnce();
      expect(fixtures.progressRefresh).toHaveBeenCalledOnce();
      expect(fixtures.dailyRefresh).toHaveBeenCalledOnce();
      expect(fixtures.identity.refreshBalance).toHaveBeenCalledOnce();
    });
    expect(
      screen.getByRole("button", { name: "Return to Arena" }),
    ).toBeEnabled();
  });

  it("routes an underfunded pack directly to wallet settings", () => {
    fixtures.identity.balanceLamports = 0;
    render(<ShopPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "10 Cubes for 0.02 SOL" }),
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
      currentPrice: 18_000_000n,
      salePrice: 18_000_000n,
      onSale: true,
    };
    fixtures.controller.shop = sale;
    render(<ShopPage />);

    expect(
      screen.getByRole("button", { name: "10 Cubes for 0.018 SOL" }),
    ).toHaveTextContent("0.02");
    expect(screen.getByText("\u221210%")).toBeInTheDocument();
  });
});

function shopView(): CubeShopView {
  const prices = [
    20_000_000n,
    90_000_000n,
    300_000_000n,
    700_000_000n,
  ];
  const cubes = [10n, 50n, 200n, 500n];
  const packs = cubes.map(
    (value, index): CubePackQuote => ({
      index,
      cubes: value,
      regularPrice: prices[index],
      currentPrice: prices[index],
      salePrice: prices[index],
      enabled: true,
      onSale: false,
    }),
  );
  return {
    economyVersion: 2,
    revision: 1n,
    playerInitialized: true,
    cubesBalance: 25n,
    dailyRetryCubes: 10n,
    maxPaidDailyRetries: 5,
    protocolPaused: false,
    teamDestination: PublicKey.default,
    rewardVault: PublicKey.default,
    treasuryDestination: PublicKey.default,
    saleEnabled: false,
    saleStartsAt: 0n,
    saleEndsAt: 0n,
    saleLive: false,
    weeklyChallenge: null,
    packs,
  };
}
