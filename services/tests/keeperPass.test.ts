import { Keypair, TransactionInstruction, VersionedTransaction, type Connection } from "@solana/web3.js";
import { afterEach, expect, it, vi } from "vitest";
import { KEEPER_LIMITS, runKeeperPass } from "../src/keeper.js";
import { ZKUBE_PROGRAM_ID, cadenceFundingPda, type KeeperOperation } from "../src/arcadeChain.js";
import type { DailySnapshot } from "../src/arcadeReconciliation.js";

afterEach(() => vi.restoreAllMocks());

function pass(count = 7) {
  const keeper = Keypair.generate();
  const signing = vi.spyOn(VersionedTransaction.prototype, "sign").mockImplementation(() => undefined);
  const calls: string[] = [];
  const connection = {
    getBalance: vi.fn().mockResolvedValue(1_000_000_000),
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: keeper.publicKey.toBase58(), lastValidBlockHeight: 500 }),
    getFeeForMessage: vi.fn().mockResolvedValue({ value: 5_000 }),
    simulateTransaction: vi.fn(async () => {
      calls.push("simulate");
      return { value: { err: null, accounts: [{ lamports: 999_995_000 }] } };
    }),
    sendRawTransaction: vi.fn(async () => { calls.push("send"); return "signature"; }),
    confirmTransaction: vi.fn(async () => { calls.push("confirm"); return { value: { err: null } }; }),
  };
  const input = {
    connection: connection as unknown as Connection, keeper, writeEnabled: true,
    now: () => 20_700 * 86_400_000,
    protocolSnapshot: { paused: true, launchDayId: 20_700, suspendedUntilDay: 0, dailies: [], runs: [],
      closedArenaPlayers: Array.from({ length: count }, () => ({ dayId: 20_699,
        owner: Keypair.generate().publicKey, rentPayer: keeper.publicKey })) },
    protocolMaterializer: { materialize: async () => [new TransactionInstruction({
      programId: ZKUBE_PROGRAM_ID, keys: [], data: Buffer.alloc(8),
    })] },
  };
  return { input, connection, signing, calls };
}

it("keeper_pass_reserves_write_slots_and_simulates_before_every_send", async () => {
  const { input, calls, connection } = pass();
  const result = await runKeeperPass(input);
  expect(result.writes).toBe(KEEPER_LIMITS.writes);
  expect(result.backlog).toBe(1);
  expect(calls).toEqual(Array.from({ length: KEEPER_LIMITS.writes }, () => ["simulate", "send", "confirm"]).flat());
  expect(connection.getBalance).toHaveBeenCalledTimes(1 + KEEPER_LIMITS.writes);
});

it("keeper_dry_run_never_loads_a_signer_or_simulates_or_sends", async () => {
  const { input, connection, signing } = pass(1);
  const result = await runKeeperPass({ ...input, keeper: { publicKey: input.keeper.publicKey }, writeEnabled: false });
  expect(result.plannedWrites).toBe(1);
  expect(signing).not.toHaveBeenCalled();
  expect(connection.simulateTransaction).not.toHaveBeenCalled();
  expect(connection.sendRawTransaction).not.toHaveBeenCalled();
});

it("keeper_simulation_failure_and_reserve_floor_prevent_relay", async () => {
  for (const mode of ["simulation", "reserve"] as const) {
    const { input, connection } = pass(1);
    if (mode === "simulation") connection.simulateTransaction.mockResolvedValueOnce({
      value: { err: { InstructionError: [0, "InvalidArgument"] }, accounts: [] },
    } as never);
    else {
      connection.getBalance.mockResolvedValue(180_000_000);
      connection.simulateTransaction.mockResolvedValueOnce({
        value: { err: null, accounts: [{ lamports: 99_000_000 }] },
      });
    }
    const log = vi.fn();
    expect((await runKeeperPass({ ...input, log })).operationFailures).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining(mode === "simulation" ? "simulation failed" : "reserve floor"),
    }));
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
  }
});

it("keeper_spend_is_reserved_even_when_confirmation_is_uncertain", async () => {
  const { input, connection } = pass();
  connection.simulateTransaction.mockImplementation(async () => ({
    value: { err: null, accounts: [{ lamports: 920_000_000 }] },
  }));
  connection.confirmTransaction.mockRejectedValueOnce(new Error("timeout"));
  const result = await runKeeperPass(input);
  expect(result.writes).toBe(0);
  expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  expect(result.spentLamports).toBe(80_005_000);
  expect(result.backlog).toBe(1);
});

it("keeper_board_rent_ceiling_bounds_the_sum_of_finalizations_in_one_pass", async () => {
  const { input, connection } = pass(0);
  connection.getBalance.mockImplementation(async (address) => address.equals(cadenceFundingPda()) ? 5_000_000_000 : 1_000_000_000);
  connection.simulateTransaction.mockImplementation(async () => ({
    value: { err: null, accounts: [{ lamports: 999_995_000 }, { lamports: 4_000_000_000 }] },
  }));
  const dailies: DailySnapshot[] = [20_698, 20_699, 20_700, 20_701].map(dayId => ({
    dayId, status: dayId < 20_700 ? "open" : "funding", finalizedAt: 0,
    runsCloseAt: dayId * 86_400 + 86_340, recoveryDeadlineAt: dayId * 86_400 + 107_940,
    entriesPaid: 0n, entriesScored: 0n, entriesExpired: 0n,
    predecessorRolloverRequired: true, predecessorRolloverApplied: true, claimsExpired: false,
  }));
  const log = vi.fn();
  const result = await runKeeperPass({ ...input, log,
    protocolSnapshot: { ...input.protocolSnapshot, launchDayId: 20_698, dailies },
    protocolMaterializer: { materialize: async ({ operation }: { operation: KeeperOperation }) => [new TransactionInstruction({
      programId: ZKUBE_PROGRAM_ID, data: Buffer.alloc(8),
      keys: operation === "finalize_arena_daily" ? [{ pubkey: cadenceFundingPda(), isWritable: true, isSigner: false }] : [],
    })] },
  });
  expect(result.writes).toBe(1);
  expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ error: "recyclable board-rent allocation ceiling reached" }));
});

it("keeper_board_writes_stop_at_the_separate_pass_limit", async () => {
  const { input, connection } = pass(0);
  const dailies: DailySnapshot[] = Array.from({ length: 35 }, (_, index) => {
    const dayId = 20_667 + index;
    const finalized = dayId < 20_700;
    const closes = dayId * 86_400 + 86_340;
    return {
      dayId, status: finalized ? "finalized" : "funding", finalizedAt: finalized ? closes : 0,
      runsCloseAt: closes, recoveryDeadlineAt: closes + 21_600,
      entriesPaid: finalized ? 1n : 0n, entriesScored: finalized ? 1n : 0n, entriesExpired: 0n,
      predecessorRolloverRequired: index !== 0, predecessorRolloverApplied: index !== 0 && dayId <= 20_700,
      claimsExpired: false,
      ...(finalized ? {
        scoreBoard: { kind: "score" as const, cursor: 0, payoutCount: 1, sealed: false, sealedAt: 0 },
        themeBoard: { kind: "theme" as const, cursor: 0, payoutCount: 0, sealed: true, sealedAt: closes },
        scoreSources: [{ source: input.keeper.publicKey, owner: input.keeper.publicKey,
          score: 1, objectiveTotal: 0n, finalizedAt: closes - 1, replayHash: new Uint8Array(32) }],
      } : {}),
    };
  });
  const result = await runKeeperPass({ ...input,
    protocolSnapshot: { ...input.protocolSnapshot, launchDayId: 20_667, dailies },
  });
  expect(result.writes).toBe(KEEPER_LIMITS.boardWrites);
  expect(result.backlog).toBe(1);
  expect(connection.sendRawTransaction).toHaveBeenCalledTimes(32);
});
