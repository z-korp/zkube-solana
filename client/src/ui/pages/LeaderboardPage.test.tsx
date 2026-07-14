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

import LeaderboardPage from "./LeaderboardPage";

const fixtures = vi.hoisted(() => ({
  accountAddress: "ABCD12345678WXYZ",
  controller: {
    error: null as string | null,
    loading: false,
  },
  navigation: {
    navigate: vi.fn(),
    setSpectateTarget: vi.fn(),
  },
  entries: [
    {
      rank: 1,
      player: "abcd12345678WXYZ",
      playerName: "abcd…WXYZ",
      receipt: "receipt-one",
      runId: 4n,
      score: 900,
      submittedAt: 100,
    },
    {
      rank: 2,
      player: "ABCD12345678WXYZ",
      playerName: "ABCD…WXYZ",
      receipt: "receipt-two",
      runId: 5n,
      score: 750,
      submittedAt: 101,
    },
  ],
}));

vi.mock("@/contexts/daily", () => ({
  useDaily: () => fixtures.controller,
}));

vi.mock("@/hooks/useAccount", () => ({
  default: () => ({ address: fixtures.accountAddress }),
}));

vi.mock("@/hooks/useCurrentChallenge", () => ({
  useCurrentChallenge: () => ({ challenge: { challenge_id: 14 } }),
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

vi.mock("@/ui/elements/theme-provider/hooks", () => ({
  useTheme: () => ({ themeTemplate: "theme-1" }),
}));

beforeAll(() => {
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("LeaderboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses exact base58 identity matches, score labels, and four-character truncation", () => {
    const { container } = render(<LeaderboardPage />);

    expect(screen.getByText("abcd…WXYZ")).toBeInTheDocument();
    expect(screen.getByText("You · ABCD…WXYZ")).toBeInTheDocument();
    expect(screen.getByText("900 daily")).toBeInTheDocument();
    expect(screen.getByText("750 daily")).toBeInTheDocument();
    expect(screen.queryByText("Player")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(" XP");
    expect(container).not.toHaveTextContent("★");
  });

  it("opens the selected finalized run in the read-only spectator", () => {
    render(<LeaderboardPage />);

    fireEvent.click(screen.getByText("You · ABCD…WXYZ"));

    expect(fixtures.navigation.setSpectateTarget).toHaveBeenCalledWith({
      player: fixtures.accountAddress,
      runId: "5",
    });
    expect(fixtures.navigation.navigate).toHaveBeenCalledWith("spectate");
  });
});
