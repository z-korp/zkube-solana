// @vitest-environment node
import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { deriveArenaDailyPda, deriveWeeklyJackpotPda } from "./pdas";
import { SessionWallet } from "./sessionWallet";
import {
  buildFinalizeWeeklyPlan,
  currentWeeklyId,
  weekStartDay,
  type WeeklyView,
} from "./weeklyClient";

describe("Weekly period projection", () => {
  it("matches zkube-core's zero-based Monday-aligned weeks", () => {
    expect(currentWeeklyId(4 * 86_400)).toBe(0);
    expect(currentWeeklyId(10 * 86_400 + 86_399)).toBe(0);
    expect(currentWeeklyId(11 * 86_400)).toBe(1);
    expect(weekStartDay(0)).toBe(4);
    expect(weekStartDay(1)).toBe(11);
  });

  it("places every partial-period Daily before payout recipients", async () => {
    const wallet = new SessionWallet(Keypair.generate());
    const weekly = view({ qualificationStartDay: 9 });
    const plan = await buildFinalizeWeeklyPlan({
      connection: {} as Connection,
      wallet,
      weekly,
    });
    const instruction = plan.transaction.instructions[0]!;
    const qualificationAccounts = instruction.keys.slice(-2);

    expect(qualificationAccounts.map(({ pubkey }) => pubkey)).toEqual([
      deriveArenaDailyPda(9),
      deriveArenaDailyPda(10),
    ]);
    expect(qualificationAccounts.every(({ isWritable }) => !isWritable)).toBe(
      true,
    );
  });

  it("rejects a qualification start outside the Weekly calendar", async () => {
    await expect(
      buildFinalizeWeeklyPlan({
        connection: {} as Connection,
        wallet: new SessionWallet(Keypair.generate()),
        weekly: view({ qualificationStartDay: 11 }),
      }),
    ).rejects.toThrow("outside its calendar period");
  });
});

function view(
  overrides: Partial<WeeklyView> = {},
): WeeklyView {
  return {
    address: deriveWeeklyJackpotPda(0),
    weeklyId: 0,
    qualificationStartDay: 4,
    status: "open",
    opensAt: 4 * 86_400,
    closesAt: 11 * 86_400,
    finalizedAt: 0,
    activePotLamports: 0n,
    followingWeeklyLamports: 0n,
    participants: 0,
    rulesHash: new Uint8Array(32),
    metricLabels: ["combo", "action", "run"],
    boards: [[], [], []],
    leaderboard: [],
    ...overrides,
  };
}
