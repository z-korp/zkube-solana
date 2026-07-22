// @vitest-environment node
import { Keypair, TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  SECONDS_PER_DAY,
  ZKUBE_PROGRAM_ID,
  playerFundingPda,
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
          profileSyncMask: 0,
        }],
        weeklies: [],
        seasons: [],
        runs: [],
        dailySeasonPlayers: [],
        playerStateOwners: [],
        arenaPlayerClosures: [],
        seasonPlayerClosures: [],
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

  it("keeps finalized profile-sync backlog inside the eight-write pass bound", async () => {
    const log = vi.fn();
    const keeper = Keypair.generate();
    const connection = {
      getBalance: vi.fn().mockResolvedValue(0),
      getProgramAccounts: vi.fn().mockResolvedValue([]),
      getMultipleAccountsInfo: vi.fn().mockResolvedValue([]),
    } as never;
    const dayId = 20_651;
    const launchDayId = dayId - 8;
    const owners = Array.from({ length: 9 }, () => Keypair.generate().publicKey);
    const dailies = owners.map((owner, index) => {
      const cadence = launchDayId + index;
      return {
        dayId: cadence,
        status: "finalized" as const,
        runsCloseAt: cadence * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
        recoveryDeadlineAt:
          cadence * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
        entriesPaid: 1n,
        entriesScored: 1n,
        entriesExpired: 0n,
        potLamports: 10_000_000n,
        predecessorRolloverRequired: cadence !== launchDayId,
        predecessorRolloverApplied: cadence !== launchDayId,
        seasonEligiblePlayers: 0,
        seasonRollups: 0,
        seasonRollupSealed: true,
        profileSyncMask: 0,
        settlement: {
          winners: [{
            owner,
            payoutLamports: 10_000_000n,
            rank: 1,
            destinationValid: true,
          }],
          rolloverLamports: 0n,
        },
      };
    });
    const result = await runKeeperPass({
      connection,
      keeper,
      writeEnabled: false,
      now: () => (dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET) * 1_000,
      protocolSnapshot: {
        paused: false,
        launchDayId,
        rulesCatalog: rulesCatalogPda(1),
        dailies,
        weeklies: [],
        seasons: [],
        runs: [],
        dailySeasonPlayers: [],
        playerStateOwners: owners,
        arenaPlayerClosures: [],
        seasonPlayerClosures: [],
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
      plannedWrites: 8,
      maxWrites: 8,
      backlog: 2,
    });
    expect(log.mock.calls.filter(([event]) =>
      event.event === "keeper_plan" && event.operation === "sync_daily_profile"
    )).toHaveLength(7);
  });

  it("closes at most two finalized participant accounts per pass", async () => {
    const log = vi.fn();
    const keeper = Keypair.generate();
    const connection = {
      getBalance: vi.fn().mockResolvedValue(0),
      getProgramAccounts: vi.fn().mockResolvedValue([]),
      getMultipleAccountsInfo: vi.fn().mockResolvedValue([]),
    } as never;
    const dayId = 20_651;
    const launchDayId = dayId - 2;
    const owners = Array.from({ length: 3 }, () => Keypair.generate().publicKey);
    const dailies = owners.map((_, index) => {
      const cadence = launchDayId + index;
      return {
        dayId: cadence,
        status: "finalized" as const,
        runsCloseAt: cadence * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
        recoveryDeadlineAt:
          cadence * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
        entriesPaid: 0n,
        entriesScored: 0n,
        entriesExpired: 0n,
        potLamports: 0n,
        predecessorRolloverRequired: cadence !== launchDayId,
        predecessorRolloverApplied: cadence !== launchDayId,
        seasonEligiblePlayers: 0,
        seasonRollups: 0,
        seasonRollupSealed: true,
        profileSyncMask: 0,
      };
    });
    const result = await runKeeperPass({
      connection,
      keeper,
      writeEnabled: false,
      now: () => (dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET) * 1_000,
      protocolSnapshot: {
        paused: false,
        launchDayId,
        rulesCatalog: rulesCatalogPda(1),
        dailies,
        weeklies: [],
        seasons: [],
        runs: [],
        dailySeasonPlayers: [],
        playerStateOwners: [],
        arenaPlayerClosures: owners.map((owner, index) => ({
          dayId: launchDayId + index,
          owner,
          rentRecipient: playerFundingPda(owner),
        })),
        seasonPlayerClosures: [],
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
    expect(result).toMatchObject({ plannedWrites: 3, backlog: 1 });
    expect(log.mock.calls.filter(([event]) =>
      event.event === "keeper_plan" && event.operation === "close_arena_player"
    )).toHaveLength(2);
  });
});
