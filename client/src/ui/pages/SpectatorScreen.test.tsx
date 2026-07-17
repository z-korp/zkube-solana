import React from "react";
import { render, screen } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import SpectatorScreen from "./SpectatorScreen";

const fixtures = vi.hoisted(() => ({
  navigation: {
    navigate: vi.fn(),
    spectateTarget: { player: "not-a-public-key" },
  },
  useSpectatedRun: vi.fn(() => ({ run: null, status: null })),
}));

vi.mock("@/chain/useSpectatedRun", () => ({
  useSpectatedRun: fixtures.useSpectatedRun,
}));

vi.mock("@/stores/navigationStore", async () =>
  (await import("@/test/mocks/navigation")).navigationStoreMock(
    fixtures.navigation,
  ),
);

beforeAll(() => {
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("SpectatorScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an invalid target before starting the read-only watcher", () => {
    render(<SpectatorScreen />);

    expect(screen.getByText("Cannot spectate")).toBeInTheDocument();
    expect(
      screen.getByText("Invalid player or run address."),
    ).toBeInTheDocument();
    expect(fixtures.useSpectatedRun).toHaveBeenCalledWith(null);
  });
});
