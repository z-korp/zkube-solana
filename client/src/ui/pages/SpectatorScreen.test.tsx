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
    spectateTarget: { pda: "legacy-run-pda" },
  },
  useSpectatedRun: vi.fn(() => ({ run: null, error: null, loading: false })),
}));

vi.mock("@/backend/client", () => ({
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
      screen.getByText("A player address is required to spectate."),
    ).toBeInTheDocument();
    expect(fixtures.useSpectatedRun).toHaveBeenCalledWith("", "arcade");
  });
});
