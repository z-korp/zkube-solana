import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PublicKey } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getThemeColors } from "@/config/themes";
import type { DailyView } from "@/chain/dailyClient";
import DailyTab from "./DailyTab";

const hooks = vi.hoisted(() => ({
  current: null as unknown,
  previous: null as unknown,
  identity: null as unknown,
  refund: vi.fn<() => Promise<string>>(),
}));

vi.mock("@/contexts/daily", () => ({
  useDaily: () => hooks.current,
}));

vi.mock("@/hooks/usePreviousChallenge", () => ({
  usePreviousChallenge: () => hooks.previous,
}));

vi.mock("@/chain/embeddedIdentityContext", () => ({
  useEmbeddedIdentity: () => hooks.identity,
}));

vi.mock("@/ui/components/rewards/TierContext", () => ({
  default: () => null,
}));

const PLAYER = new PublicKey("11111111111111111111111111111111");
const RECEIPT = new PublicKey("ComputeBudget111111111111111111111111111111");

describe("DailyTab", () => {
  beforeEach(() => {
    hooks.refund.mockReset();
    hooks.refund.mockResolvedValue("refund-signature");
    hooks.identity = { publicKey: PLAYER };
    hooks.previous = {
      daily: null,
      action: null,
      error: null,
      refund: vi.fn(),
    };
  });

  it("projects finalized Daily results into Weekly rewards", () => {
    hooks.current = controller(dailyFixture("claimable"));

    render(<DailyTab colors={getThemeColors("theme-1")} />);

    expect(screen.getByText("ROLLING UP")).toBeInTheDocument();
    expect(screen.getByText(/cash and Star rewards settle from the Weekly/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Claim USDC/i })).toBeNull();
  });

  it("offers a cancellation refund for an unrefunded paid entry", () => {
    hooks.current = controller(dailyFixture("cancelled"));

    render(<DailyTab colors={getThemeColors("theme-1")} />);
    fireEvent.click(screen.getByRole("button", { name: "Claim refund" }));

    expect(hooks.refund).toHaveBeenCalledOnce();
  });
});

function controller(daily: DailyView) {
  return {
    daily,
    loading: false,
    action: null,
    error: null,
    refund: hooks.refund,
  };
}

function dailyFixture(status: DailyView["status"]): DailyView {
  return {
    status,
    mapId: 1,
    opensAt: 1_700_000_000,
    runsCloseAt: 1_700_003_600,
    attemptsStarted: 1n,
    rules: { activeMutatorId: 0, passiveMutatorId: 0 },
    player: {
      attempts: 1,
      finalizedAttempts: 1,
      bestRunId: 1n,
      bestScore: 900,
      starRefunded: false,
      dailyXpAwarded: true,
      weeklyRolledUp: false,
    },
    leaderboard: [
      {
        player: PLAYER,
        receipt: RECEIPT,
        runId: 1n,
        score: 900,
        submittedAt: 1_700_003_000,
      },
    ],
  } as DailyView;
}
