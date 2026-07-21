// @vitest-environment node
import { Keypair, TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  SECONDS_PER_DAY,
  ZKUBE_PROGRAM_ID,
  rulesCatalogPda,
} from "../src/arcadeChain";
import { runKeeperPass } from "../src/keeper";

describe("keeper read-only planning", () => {
  it("materializes current activation and successor preparation without signing", async () => {
    const log = vi.fn();
    const keeper = Keypair.generate();
    const connection = {
      getBalance: vi.fn().mockResolvedValue(0),
      getProgramAccounts: vi.fn().mockResolvedValue([]),
      getMultipleAccountsInfo: vi.fn().mockResolvedValue([]),
    } as never;
    const dayId = 20_651;
    const result = await runKeeperPass({
      connection,
      keeper,
      writeEnabled: false,
      now: () => (dayId * SECONDS_PER_DAY + 10) * 1_000,
      protocolSnapshot: {
        paused: false,
        launchDayId: dayId,
        rulesCatalog: rulesCatalogPda(1),
        dailies: [{
          dayId,
          status: "funding",
          runsCloseAt: dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
          recoveryDeadlineAt:
            dayId * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
          entriesPaid: 0n,
          entriesScored: 0n,
          entriesExpired: 0n,
          potLamports: 0n,
          predecessorRolloverRequired: false,
          predecessorRolloverApplied: false,
          seasonEligiblePlayers: 0,
          seasonRollups: 0,
          seasonRollupSealed: false,
        }],
        weeklies: [],
        seasons: [],
        runs: [],
        dailySeasonPlayers: [],
      },
      protocolMaterializer: {
        materialize: async () => [new TransactionInstruction({
          programId: ZKUBE_PROGRAM_ID,
          keys: [{ pubkey: keeper.publicKey, isSigner: true, isWritable: false }],
          data: Buffer.alloc(8),
        })],
      },
      log,
    });
    expect(result).toMatchObject({
      writes: 0,
      plannedWrites: 2,
      reserveLow: true,
      operationFailures: 0,
    });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      event: "keeper_plan",
      operation: "activate_arena_daily",
    }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      event: "keeper_plan",
      operation: "prepare_arena_daily",
    }));
  });
});
