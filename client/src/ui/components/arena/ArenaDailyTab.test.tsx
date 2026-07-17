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

import ArenaDailyTab from "./ArenaDailyTab";

const fixtures = vi.hoisted(() => ({
  accountAddress: "ABCD12345678WXYZ",
  daily: {
    loading: false,
    action: null as string | null,
    error: null as string | null,
    enter: vi.fn(),
    refund: vi.fn(),
    run: { phase: "none" },
    daily: {
      status: "open",
      opensAt: 0,
      entriesCloseAt: 1234567 + 3_600,
      runsCloseAt: 1234567 + 3_600,
      playerEligible: true,
      playerStars: 10n,
      starEntryCost: 2n,
      scoringRule: null,
    },
  },
  previous: {
    daily: null,
    action: null as string | null,
    error: null as string | null,
    refund: vi.fn(),
  },
  navigation: {
    navigate: vi.fn(),
    openShop: vi.fn(),
    setSpectateTarget: vi.fn(),
  },
  entries: [
    {
      rank: 1,
      player: "abcd12345678WXYZ",
      playerName: "Wave_Rider7",
      runId: 4n,
      score: 900,
      submittedAt: 100,
    },
    {
      rank: 2,
      player: "ABCD12345678WXYZ",
      playerName: "ABCD…WXYZ",
      runId: 5n,
      score: 750,
      submittedAt: 101,
    },
  ],
}));

vi.mock("@/contexts/daily", () => ({
  useDaily: () => fixtures.daily,
}));

vi.mock("@/hooks/usePreviousChallenge", () => ({
  usePreviousChallenge: () => fixtures.previous,
}));

vi.mock("@/hooks/useActiveDailyAttempt", () => ({
  useActiveDailyAttempt: () => null,
}));

vi.mock("@/hooks/useAccount", () => ({
  default: () => ({ address: fixtures.accountAddress }),
}));

vi.mock("@/hooks/useCurrentChallenge", () => ({
  useCurrentChallenge: () => ({
    challenge: {
      challenge_id: 14,
      zone_id: 1,
      total_attempts: 2n,
      settled: false,
      cancelled: false,
      start_time: 0,
      end_time: 1234567 + 3_600,
      active_mutator_id: 0,
      passive_mutator_id: 0,
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useDailyLeaderboard", () => ({
  useDailyLeaderboard: () => ({
    entries: fixtures.entries,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/usePlayerEntry", () => ({
  usePlayerEntry: () => ({ entry: null }),
}));

vi.mock("@/stores/navigationStore", () => ({
  useNavigationStore: (
    selector: (state: typeof fixtures.navigation) => unknown,
  ) => selector(fixtures.navigation),
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

describe("ArenaDailyTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the board with exact identity matches and the entry CTA", () => {
    const { container } = render(<ArenaDailyTab />);

    expect(screen.getByText("Wave_Rider7 · abcd…WXYZ")).toBeInTheDocument();
    expect(screen.getByText("You · ABCD…WXYZ")).toBeInTheDocument();
    expect(screen.getByText("900 daily")).toBeInTheDocument();
    expect(screen.getByText("750 daily")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enter Daily · 2★" }),
    ).toBeEnabled();
    expect(container).not.toHaveTextContent(" XP to Level");
  });

  it("opens a tapped run in the read-only spectator", () => {
    render(<ArenaDailyTab />);

    fireEvent.click(screen.getByText("You · ABCD…WXYZ"));

    expect(fixtures.navigation.setSpectateTarget).toHaveBeenCalledWith({
      player: fixtures.accountAddress,
      runId: "5",
    });
    expect(fixtures.navigation.navigate).toHaveBeenCalledWith("spectate");
  });

  it("funnels an underfunded player to the shop with the Arena origin", () => {
    fixtures.daily.daily.playerStars = 1n;
    render(<ArenaDailyTab />);

    fireEvent.click(screen.getByText("Need 1 more ★ · Get Stars"));

    expect(fixtures.navigation.openShop).toHaveBeenCalledWith("ranks");
    fixtures.daily.daily.playerStars = 10n;
  });
});
