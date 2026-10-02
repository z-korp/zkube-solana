import { ComputeBudgetInstruction, ComputeBudgetProgram, Keypair, TransactionInstruction, TransactionMessage,
  VersionedTransaction, type Connection } from "@solana/web3.js";
import { afterEach, expect, it, vi } from "vitest";
import { KEEPER_LIMITS, MAX_TRANSACTION_COMPUTE_UNITS, keeperComputeUnitLimit, runKeeperPass } from "../src/keeper.js";
import { ZKUBE_PROGRAM_ID, cadenceFundingPda, type KeeperOperation } from "../src/arcadeChain.js";
import type { DailySnapshot } from "../src/arcadeReconciliation.js";
import { CADENCE_FUNDING_TWO_DAY_LAMPORTS } from "../src/protocolVersions.generated.js";
import { dailyWindow } from "../src/zkubeCore.js";
// The instant a day opens; the core owns the boundary (07:00 UTC).
const opens = (day: number) => dailyWindow(day).opensAt;

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
      return { value: { err: null, unitsConsumed: 40_000, accounts: [{ lamports: 999_995_000 }] } };
    }),
    sendRawTransaction: vi.fn(async () => { calls.push("send"); return "signature"; }),
    getSignatureStatuses: vi.fn(async () => {
      calls.push("confirm");
      return { value: [{ err: null, confirmationStatus: "confirmed" }] };
    }),
  };
  const input = {
    connection: connection as unknown as Connection, keeper, writeEnabled: true,
    now: () => opens(20_700) * 1_000,
    protocolSnapshot: { paused: true, launchDayId: 20_700, suspendedUntilDay: 0, lastPreparedDay: 20_701, dailies: [], runs: [],
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
  expect(calls).toEqual(Array.from({ length: KEEPER_LIMITS.writes }, () => ["simulate", "simulate", "send", "confirm"]).flat());
  expect(connection.getBalance).toHaveBeenCalledTimes(2 + KEEPER_LIMITS.writes);
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
      connection.simulateTransaction.mockResolvedValue({
        value: { err: null, unitsConsumed: 40_000, accounts: [{ lamports: 99_000_000 }] },
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
    value: { err: null, unitsConsumed: 40_000, accounts: [{ lamports: 920_000_000 }] },
  }));
  connection.getSignatureStatuses.mockRejectedValueOnce(new Error("timeout"));
  const result = await runKeeperPass(input);
  expect(result.writes).toBe(0);
  expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
  expect(result.spentLamports).toBe(80_005_000);
  expect(result.backlog).toBe(1);
});

it("keeper_reports_cadence_funding_against_two_overlapping_days_and_counts_its_rent_as_spend", async () => {
  for (const [cadence, low] of [[CADENCE_FUNDING_TWO_DAY_LAMPORTS - 1, true], [CADENCE_FUNDING_TWO_DAY_LAMPORTS, false]] as const) {
    const { input, connection } = pass(0);
    connection.getBalance.mockImplementation(async (address) => address.equals(cadenceFundingPda()) ? cadence : 1_000_000_000);
    // Preparing a Daily takes its rent and its two empty boards' from cadence funding.
    connection.simulateTransaction.mockImplementation(async () => ({
      value: { err: null, unitsConsumed: 60_000, accounts: [{ lamports: 999_995_000 }, { lamports: cadence - 5_200_000 }] },
    }));
    const log = vi.fn();
    const result = await runKeeperPass({ ...input, log,
      protocolSnapshot: { ...input.protocolSnapshot, paused: false, lastPreparedDay: 20_700, dailies: [{
        dayId: 20_700, status: "open", finalizedAt: 0, runsCloseAt: opens(20_700) + 86_340,
        recoveryDeadlineAt: opens(20_700) + 107_940, entriesPaid: 0n, entriesScored: 0n, entriesExpired: 0n,
        predecessorDayId: 20_699, predecessorRolloverRequired: false, predecessorRolloverApplied: true, claimsExpired: false,
      } satisfies DailySnapshot] },
      protocolMaterializer: { materialize: async ({ operation }: { operation: KeeperOperation }) => {
        expect(operation).toBe("prepare_arena_daily");
        return [new TransactionInstruction({ programId: ZKUBE_PROGRAM_ID, data: Buffer.alloc(8),
          keys: [{ pubkey: cadenceFundingPda(), isWritable: true, isSigner: false }] })];
      } },
    });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "keeper_readiness",
      cadenceFundingLamports: cadence, cadenceFundingTargetLamports: CADENCE_FUNDING_TWO_DAY_LAMPORTS, cadenceFundingLow: low }));
    expect(result.writes).toBe(1);
    expect(result.spentLamports).toBe(5_000 + 5_000 + 5_200_000);
  }
});

it("keeper_messages_carry_a_compute_budget_sized_from_simulation", async () => {
  // Full-board finalization measured 958,510 units; the 200,000 default cannot run it.
  for (const [consumed, expected] of [[958_510, 1_203_138], [6_398, 12_998], [1_390_000, MAX_TRANSACTION_COMPUTE_UNITS]] as const) {
    const { input, connection } = pass(1);
    const simulated: VersionedTransaction[] = [];
    connection.simulateTransaction.mockImplementation((async (transaction: VersionedTransaction) => {
      simulated.push(transaction);
      return { value: { err: null, unitsConsumed: consumed, accounts: [{ lamports: 999_995_000 }] } };
    }) as never);
    expect((await runKeeperPass(input)).writes).toBe(1);
    const limits = simulated.map(transaction => {
      const instructions = TransactionMessage.decompile(transaction.message).instructions;
      expect(instructions).toHaveLength(2);
      expect(instructions[0]!.programId.equals(ComputeBudgetProgram.programId)).toBe(true);
      return ComputeBudgetInstruction.decodeSetComputeUnitLimit(instructions[0]!).units;
    });
    expect(limits).toEqual([MAX_TRANSACTION_COMPUTE_UNITS, expected]);
    expect(expected).toBeGreaterThan(consumed);
    // The relayed bytes are the simulated message with the sized limit.
    expect(Buffer.from((connection.sendRawTransaction.mock.calls as unknown as [Uint8Array][])[0]![0]))
      .toEqual(Buffer.from(simulated[1]!.serialize()));
  }
  expect(() => keeperComputeUnitLimit(0)).toThrow("compute consumption");
  expect(() => keeperComputeUnitLimit(MAX_TRANSACTION_COMPUTE_UNITS + 1)).toThrow("compute consumption");
});
