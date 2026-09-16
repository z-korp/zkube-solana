// @vitest-environment node
import {
  Keypair,
  SystemProgram,
  TransactionInstruction,
  type AccountInfo,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  ZKUBE_PROGRAM_ID,
  activeRunPda,
  arenaBoardPda,
  arenaDailyPda,
  cadenceFundingPda,
  type KeeperInstructionPlan,
} from "../src/arcadeChain.js";
import {
  DEFAULT_MAX_KEEPER_SPEND_LAMPORTS,
  DEFAULT_MIN_KEEPER_LAMPORTS,
  keeperKeypairFromEnv,
  keeperPublicKeyFromEnv,
  keeperSpendWithinLimit,
  predictedKeeperSpendLamports,
  predictedAccountSpendLamports,
  verifyConfirmedWrite,
} from "../src/keeper.js";

describe("keeper bounds", () => {
  it("pins reserve and spend limits", () => {
    expect(DEFAULT_MIN_KEEPER_LAMPORTS).toBe(100_000_000);
    expect(DEFAULT_MAX_KEEPER_SPEND_LAMPORTS).toBe(100_000_000);
    expect(keeperSpendWithinLimit(100_000_000, 100_000_000)).toBe(true);
    expect(keeperSpendWithinLimit(100_000_001, 100_000_000)).toBe(false);
  });

  it("accounts conservatively for fee and rent spend", () => {
    expect(predictedKeeperSpendLamports(100_000_000, 75_000_000, 5_000)).toBe(25_005_000);
    expect(predictedAccountSpendLamports(500_000_000, 447_424_160))
      .toBe(52_575_840);
    expect(() => predictedAccountSpendLamports(1, undefined))
      .toThrow("omitted");
    expect(() => predictedKeeperSpendLamports(1, -1, 5_000)).toThrow("invalid lamports");
  });

  it("pins loaded secret material to the configured public key", () => {
    const keeper = Keypair.generate();
    const encoded = JSON.stringify([...keeper.secretKey]);
    expect(keeperKeypairFromEnv({ KEEPER_SECRET_KEY: encoded, ZKUBE_KEEPER_PUBLIC_KEY: keeper.publicKey.toBase58() }).publicKey.equals(keeper.publicKey)).toBe(true);
    expect(() => keeperKeypairFromEnv({ KEEPER_SECRET_KEY: encoded, ZKUBE_KEEPER_PUBLIC_KEY: Keypair.generate().publicKey.toBase58() })).toThrow("does not match");
    expect(keeperPublicKeyFromEnv({
      ZKUBE_KEEPER_PUBLIC_KEY: keeper.publicKey.toBase58(),
    }).equals(keeper.publicKey)).toBe(true);
  });

  it("re-verifies the expected ActiveRun closure instead of rejecting it", async () => {
    const owner = Keypair.generate().publicKey;
    const runId = 9n;
    const activeRun = activeRunPda(owner, runId);
    const rentRecipient = Keypair.generate().publicKey;
    const instruction = new TransactionInstruction({
      programId: ZKUBE_PROGRAM_ID,
      keys: [
        { pubkey: activeRun, isSigner: false, isWritable: true },
        { pubkey: rentRecipient, isSigner: false, isWritable: true },
      ],
      data: Buffer.alloc(8),
    });
    const plan: KeeperInstructionPlan = {
      operation: "consume_arena_run",
      execution: "instruction",
      connection: "base",
      context: {
        owner,
        runId,
        runLocation: "base",
        includeArenaPlayer: true,
      },
      instruction,
      instructions: [instruction],
    };
    const connection = {
      getSignatureStatus: vi.fn().mockResolvedValue({
        value: { err: null, confirmationStatus: "confirmed" },
      }),
      getMultipleAccountsInfo: vi.fn().mockResolvedValue([
        null,
        systemAccount(),
      ]),
    };
    await expect(verifyConfirmedWrite(plan, connection as never, "signature")).resolves.toBeUndefined();

    connection.getMultipleAccountsInfo.mockResolvedValueOnce([
      systemAccount(),
      systemAccount(),
    ]);
    await expect(verifyConfirmedWrite(plan, connection as never, "signature"))
      .rejects.toThrow("does not match");
  });

  it("re-verifies every account closed by Daily cadence cleanup", async () => {
    const dayId = 20_651;
    const daily = arenaDailyPda(dayId);
    const score = arenaBoardPda(daily, "score");
    const theme = arenaBoardPda(daily, "theme");
    const instruction = new TransactionInstruction({
      programId: ZKUBE_PROGRAM_ID,
      keys: [daily, score, theme, cadenceFundingPda()].map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: true,
      })),
      data: Buffer.alloc(8),
    });
    const plan: KeeperInstructionPlan = {
      operation: "close_arena_daily",
      execution: "instruction",
      connection: "base",
      context: { dayId },
      instruction,
      instructions: [instruction],
    };
    const connection = {
      getSignatureStatus: vi.fn().mockResolvedValue({
        value: { err: null, confirmationStatus: "confirmed" },
      }),
      getMultipleAccountsInfo: vi.fn().mockResolvedValue([
        null,
        null,
        null,
        systemAccount(),
      ]),
    };
    await expect(verifyConfirmedWrite(plan, connection as never, "signature"))
      .resolves.toBeUndefined();

    connection.getMultipleAccountsInfo.mockResolvedValueOnce([
      null,
      systemAccount(),
      null,
      systemAccount(),
    ]);
    await expect(verifyConfirmedWrite(plan, connection as never, "signature"))
      .rejects.toThrow("does not match");
  });

});

function systemAccount(): AccountInfo<Buffer> {
  return {
    executable: false,
    owner: SystemProgram.programId,
    lamports: 1,
    rentEpoch: 0,
    data: Buffer.alloc(0),
  };
}
