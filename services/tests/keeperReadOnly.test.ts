// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

const { compileWalletTransactionPlan } = vi.hoisted(() => ({
  compileWalletTransactionPlan: vi.fn(),
}));

vi.mock("../../client/src/chain/dailyClient", () => ({
  buildCloseDailyChallengePlan: vi.fn(),
  buildCloseDailyPlayerPlan: vi.fn(),
  buildFinalizeDailyChallengePlan: vi.fn(),
  buildOpenDailyChallengePlan: vi.fn().mockResolvedValue({}),
  currentDailyDayId: vi.fn().mockReturnValue(1),
  fetchDailyChallengeIds: vi.fn().mockResolvedValue([]),
  fetchDailyPlayerRecords: vi.fn().mockResolvedValue([]),
  fetchDailyView: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../client/src/chain/economyClient", () => ({
  fetchEconomyRuntime: vi.fn().mockResolvedValue({ active: true }),
}));

vi.mock("../../client/src/chain/runPlan", () => ({
  buildConsumeRunRecoveryPlan: vi.fn(),
  compileWalletTransactionPlan,
}));

vi.mock("../../client/src/chain/settlementRecovery", () => ({
  fetchOrphanedRunCandidates: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../client/src/chain/sessionCleanup", () => ({
  buildRevokeExpiredSessionPlan: vi.fn(),
  fetchExpiredZkubeSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../client/src/chain/weeklyClient", () => ({
  buildCloseWeeklyChallengePlan: vi.fn(),
  buildCloseWeeklyPlayerPlan: vi.fn(),
  buildFinalizeWeeklyPlan: vi.fn(),
  buildForfeitWeeklySolPlan: vi.fn(),
  buildOpenWeeklyPlan: vi.fn().mockResolvedValue({}),
  buildRollupDailyPlan: vi.fn(),
  currentWeeklyId: vi.fn().mockReturnValue(1),
  fetchPendingDailyRollupOwners: vi.fn().mockResolvedValue([]),
  fetchWeeklyChallengeIds: vi.fn().mockResolvedValue([]),
  fetchWeeklyPlayerRecords: vi.fn().mockResolvedValue([]),
  fetchWeeklyView: vi.fn().mockResolvedValue(null),
}));

import { runKeeperPass } from "../src/keeper";

describe("keeper read-only planning", () => {
  it("discovers bounded work without requiring funds or submitting", async () => {
    const log = vi.fn();
    const connection = {
      getBalance: vi.fn().mockResolvedValue(0),
    } as never;

    const result = await runKeeperPass({
      connection,
      keeper: Keypair.generate(),
      writeEnabled: false,
      minimumBalanceLamports: 10_000_000,
      maxWrites: 8,
      log,
    });

    expect(result).toMatchObject({
      writes: 0,
      plannedWrites: 2,
      writeEnabled: false,
      reserveLow: true,
      operationFailures: 0,
    });
    expect(compileWalletTransactionPlan).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "keeper_plan",
        operation: "open_weekly_challenge",
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "keeper_plan",
        operation: "open_daily_challenge",
      }),
    );
  });
});
