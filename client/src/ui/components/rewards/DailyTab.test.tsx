import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PublicKey } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getThemeColors } from "@/config/themes";
import type { DailyView } from "@/solana/reboot/dailyClient";
import DailyTab from "./DailyTab";

const hooks = vi.hoisted(() => ({
  current: null as unknown,
  previous: null as unknown,
  identity: null as unknown,
  claim: vi.fn<() => Promise<string>>(),
  refund: vi.fn<() => Promise<string>>(),
}));

vi.mock("@/contexts/daily", () => ({
  useDailyController: () => hooks.current,
}));

vi.mock("@/hooks/usePreviousChallenge", () => ({
  usePreviousChallenge: () => hooks.previous,
}));

vi.mock("@/solana/reboot/embeddedIdentityContext", () => ({
  useEmbeddedIdentity: () => hooks.identity,
}));

vi.mock("@/ui/components/rewards/TierContext", () => ({
  default: () => null,
}));

const PLAYER = new PublicKey("11111111111111111111111111111111");
const RECEIPT = new PublicKey("ComputeBudget111111111111111111111111111111");

describe("DailyTab", () => {
  beforeEach(() => {
    hooks.claim.mockReset();
    hooks.refund.mockReset();
    hooks.claim.mockResolvedValue("claim-signature");
    hooks.refund.mockResolvedValue("refund-signature");
    hooks.identity = { publicKey: PLAYER };
    hooks.previous = {
      daily: null,
      action: null,
      error: null,
      claim: vi.fn(),
      refund: vi.fn(),
    };
  });

  it("offers the program-backed USDC claim without manual settlement", () => {
    hooks.current = controller(dailyFixture("claimable"));

    render(<DailyTab colors={getThemeColors("theme-1")} />);
    fireEvent.click(screen.getByRole("button", { name: "Claim USDC" }));

    expect(hooks.claim).toHaveBeenCalledOnce();
    expect(screen.queryByText(/settle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/projected|\+\d+★/i)).not.toBeInTheDocument();
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
    claim: hooks.claim,
    refund: hooks.refund,
  };
}

function dailyFixture(status: DailyView["status"]): DailyView {
  return {
    status,
    mapId: 1,
    opensAt: 1_700_000_000,
    runsCloseAt: 1_700_003_600,
    claimsCloseAt: 2_000_000_000,
    runsStarted: 1n,
    entryPrice: 1_000_000n,
    rules: { activeMutatorId: 0, passiveMutatorId: 0 },
    player: {
      freeAttemptUsed: false,
      paidAttempts: 1,
      finalizedAttempts: 1,
      bestRunId: 1n,
      bestScore: 900,
      rank: 0,
      prizeAmount: 0n,
      claimed: false,
      refundedAmount: 0n,
      starRefunded: false,
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
