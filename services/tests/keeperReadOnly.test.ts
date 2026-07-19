// @vitest-environment node
import { Keypair } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { runKeeperPass } from "../src/keeper";

describe("keeper read-only planning", () => {
  it("discovers current openings without signing or requiring reserve", async () => {
    const log = vi.fn();
    const connection = {
      getBalance: vi.fn().mockResolvedValue(0),
      getMultipleAccountsInfo: vi.fn().mockResolvedValue([null, null]),
    } as never;
    const result = await runKeeperPass({ connection, keeper: Keypair.generate(), writeEnabled: false, now: () => (20_651 * 86_400 + 10) * 1_000, log });
    expect(result).toMatchObject({ writes: 0, plannedWrites: 2, reserveLow: true, operationFailures: 0 });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "keeper_plan", operation: "open_weekly_jackpot" }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "keeper_plan", operation: "open_arena_daily" }));
  });
});
