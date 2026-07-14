import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import DailyChallengePage from "./DailyChallengePage";

const fixtures = vi.hoisted(() => ({
  accountAddress: "ABCD12345678WXYZ",
  activeAttempt: null as null | {
    gameId: bigint;
    level: number;
    isReplay: boolean;
    settled: boolean;
  },
  controller: {
    action: null as string | null,
    daily: {
      economyVersion: 2 as const,
      status: "open",
      opensAt: 1_234_000,
      entriesCloseAt: 1_235_000,
      playerEligible: true,
      playerStars: 12n,
      starEntryCost: 3n,
      player: null,
    },
    enter: vi.fn(),
    refresh: vi.fn(),
    error: null as string | null,
    loading: false,
    run: { phase: "none" },
  },
  navigation: {
    goBack: vi.fn(),
    navigate: vi.fn(),
  },
}));

const campaignFixture = vi.hoisted(() => ({
  buyStars: vi.fn(),
  campaign: {
    economyVersion: 2 as const,
    starPacks: [{ stars: 10n, price: 1_000_000n, enabled: true }],
  },
  error: null as string | null,
  unlocking: false,
}));

vi.mock("@/contexts/daily", () => ({
  useDaily: () => fixtures.controller,
}));

vi.mock("@/contexts/campaign", () => ({
  useCampaign: () => campaignFixture,
}));

vi.mock("@/hooks/useAccount", () => ({
  default: () => ({ address: fixtures.accountAddress }),
}));

vi.mock("@/hooks/useActiveDailyAttempt", () => ({
  useActiveDailyAttempt: () => fixtures.activeAttempt,
}));

vi.mock("@/hooks/useCurrentChallenge", () => ({
  useCurrentChallenge: () => ({
    challenge: {
      challenge_id: 14,
      start_time: 1_234_000,
      end_time: 1_236_000,
      settled: false,
      cancelled: false,
      zone_id: 2,
      total_attempts: 2n,
      active_mutator_id: 0,
      passive_mutator_id: 0,
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useDailyLeaderboard", () => ({
  useDailyLeaderboard: () => ({
    entries: [
      {
        rank: 1,
        player: fixtures.accountAddress,
        playerName: "ABCD…WXYZ",
        receipt: "receipt",
        runId: 8n,
        score: 123,
        submittedAt: 1_234_100,
      },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/stores/navigationStore", () => ({
  useNavigationStore: (
    selector: (state: typeof fixtures.navigation) => unknown,
  ) => selector(fixtures.navigation),
}));

vi.mock("@/ui/elements/theme-provider/hooks", () => ({
  useTheme: () => ({ themeTemplate: "theme-1" }),
}));

vi.mock("@/ui/components/rewards/TierContext", () => ({
  default: (props: {
    myRank: number;
    myScore: number;
    scoreLabel?: string;
  }) => (
    <div data-testid="tier-context">
      #{props.myRank} · {props.myScore}
      {props.scoreLabel}
    </div>
  ),
}));

beforeAll(() => {
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("DailyChallengePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.activeAttempt = null;
    fixtures.controller.daily.playerStars = 12n;
  });

  it("shows the live Star entry without executing a transaction", () => {
    render(<DailyChallengePage />);

    expect(screen.getByRole("button", { name: "3 Stars" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "2.5 USDC" })).toBeNull();
    expect(screen.getByText(/2 attempts/)).toBeInTheDocument();
    expect(screen.getByTestId("tier-context")).toHaveTextContent(
      "#1 · 123 featured",
    );
    expect(fixtures.controller.enter).not.toHaveBeenCalled();
  });

  it("routes a settled previous-day attempt to rent cleanup", () => {
    fixtures.activeAttempt = {
      gameId: 41n,
      level: 7,
      isReplay: false,
      settled: true,
    };

    render(<DailyChallengePage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Finish previous Daily" }),
    );

    expect(fixtures.navigation.navigate).toHaveBeenCalledWith("play", 41n);
    expect(screen.queryByRole("button", { name: "3 Stars" })).toBeNull();
  });

  it("shows unlimited retries and the once-daily XP reward", () => {
    render(<DailyChallengePage />);

    expect(screen.getByRole("button", { name: "3 Stars" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "2.5 USDC" })).toBeNull();
    expect(screen.getByText(/Unlimited retries/)).toHaveTextContent(
      "+100 XP once today",
    );
    expect(screen.getByRole("button", { name: /Top up/ })).toBeEnabled();
  });

  it("offers an on-page Star pack when the player cannot afford an entry", () => {
    fixtures.controller.daily.playerStars = 1n;
    render(<DailyChallengePage />);

    expect(screen.getByRole("button", { name: "3 Stars" })).toBeDisabled();
    expect(screen.getByText(/Need 2 more Stars/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /10★/ })).toHaveTextContent(
      "1 USDC",
    );
    expect(campaignFixture.buyStars).not.toHaveBeenCalled();
  });
});
