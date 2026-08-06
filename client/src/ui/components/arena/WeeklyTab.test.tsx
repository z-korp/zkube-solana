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
      weekly: {
        address: key("Week11111111111111111111111111111111111111"),
        weeklyId: 1,
        status: "open",
        opensAt: 1,
        closesAt: 2,
        finalizesAt: 2,
        finalizedAt: 0,
        activePotLamports: 0n,
        followingWeeklyLamports: null,
        participants: 2,
        rulesHash: new Uint8Array(32),
        metricLabels: ["Highest combo", "Highest action score", "Total score"],
        rentRecipient: key("Rent11111111111111111111111111111111111111"),
        player: {
          score: 20,
          resultCount: 1,
        },
        leaderboard: [
          { player: owner, playerName: "Wave_Rider7", score: 20, value: 20n, runId: 1n },
          { player: other, playerName: null, score: 10, value: 10n, runId: 2n },
        ],
        boards: [[
          { player: owner, playerName: "Wave_Rider7", score: 20, value: 20n, runId: 1n },
          { player: other, playerName: null, score: 10, value: 10n, runId: 2n },
        ], [], []],
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
  it("keeps the full label + wallet on the row title while showing the short name", () => {
    render(<WeeklyTab />);

    const owner = fixtures.weekly.weekly.leaderboard[0]!.player.toBase58();
    const other = fixtures.weekly.weekly.leaderboard[1]!.player.toBase58();
    expect(
      screen.getByTitle(
        `You · Wave_Rider7 · ${owner.slice(0, 4)}…${owner.slice(-4)}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(
      screen.getByTitle(`${other.slice(0, 4)}…${other.slice(-4)}`),
    ).toBeInTheDocument();
  });
});
