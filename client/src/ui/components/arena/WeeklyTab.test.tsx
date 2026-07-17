import React from "react";
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import WeeklyTab from "./WeeklyTab";

const fixtures = vi.hoisted(() => {
  const key = (value: string) => ({
    toBase58: () => value,
    equals: (other: { toBase58(): string }) => other.toBase58() === value,
  });
  const owner = key("Owner1111111111111111111111111111111111111");
  const other = key("Other1111111111111111111111111111111111111");
  return {
    owner,
    weekly: {
      loading: false,
      action: null,
      error: null,
      claimStars: vi.fn(),
      claimSol: vi.fn(),
      weekly: {
        address: key("Week11111111111111111111111111111111111111"),
        weekId: 1,
        status: "open",
        opensAt: 1,
        closesAt: 2,
        finalizesAt: 2,
        finalizedAt: 0,
        claimsCloseAt: 3,
        committedSolPool: 0n,
        solClaimed: 0n,
        participants: 2,
        closedPlayers: 0,
        solWinnerCount: 0,
        starWinnerCount: 0,
        rentRecipient: key("Rent11111111111111111111111111111111111111"),
        player: {
          score: 20,
          resultCount: 1,
          solClaimed: false,
          starsClaimed: false,
        },
        leaderboard: [
          { player: owner, playerName: "Wave_Rider7", score: 20 },
          { player: other, playerName: null, score: 10 },
        ],
      },
    },
  };
});

vi.mock("@/contexts/weekly", () => ({
  useWeekly: () => fixtures.weekly,
}));

vi.mock("@/chain/connectedPlayerContext", async () =>
  (await import("@/test/mocks/contexts")).connectedPlayerMock(() => ({
    publicKey: fixtures.owner,
  })),
);

beforeAll(() => {
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("WeeklyTab", () => {
  it("shows cosmetic labels beside authoritative wallet addresses", () => {
    render(<WeeklyTab />);

    const owner = fixtures.weekly.weekly.leaderboard[0]!.player.toBase58();
    expect(
      screen.getByText(
        `You · Wave_Rider7 · ${owner.slice(0, 4)}…${owner.slice(-4)}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${fixtures.weekly.weekly.leaderboard[1]!.player.toBase58().slice(0, 4)}…${fixtures.weekly.weekly.leaderboard[1]!.player.toBase58().slice(-4)}`,
      ),
    ).toBeInTheDocument();
  });
});
