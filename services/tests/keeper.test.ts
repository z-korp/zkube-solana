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
  arenaDailyPda,
  arenaPlayerPda,
  playerFundingPda,
  type KeeperInstructionPlan,
} from "../src/arcadeChain";
import {
  DEFAULT_MAX_KEEPER_SPEND_LAMPORTS,
  DEFAULT_MIN_KEEPER_LAMPORTS,
  expiredSessionCleanupAllowance,
  keeperKeypairFromEnv,
  keeperPublicKeyFromEnv,
  keeperSpendWithinLimit,
  predictedKeeperSpendLamports,
  verifyConfirmedWrite,
} from "../src/keeper";

describe("v4 keeper bounds", () => {
  it("pins reserve, spend, and session cleanup limits", () => {
    expect(DEFAULT_MIN_KEEPER_LAMPORTS).toBe(100_000_000);
    expect(DEFAULT_MAX_KEEPER_SPEND_LAMPORTS).toBe(50_000_000);
    expect(keeperSpendWithinLimit(50_000_000, 50_000_000)).toBe(true);
    expect(keeperSpendWithinLimit(50_000_001, 50_000_000)).toBe(false);
    expect(expiredSessionCleanupAllowance(0, 8)).toBe(2);
    expect(expiredSessionCleanupAllowance(7, 8)).toBe(1);
    expect(expiredSessionCleanupAllowance(8, 8)).toBe(0);
  });

  it("accounts conservatively for fee and rent spend", () => {
    expect(predictedKeeperSpendLamports(100_000_000, 75_000_000, 5_000)).toBe(25_005_000);
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
    const rentRecipient = playerFundingPda(owner);
    const instruction = new TransactionInstruction({
      programId: ZKUBE_PROGRAM_ID,
      keys: [
        { pubkey: activeRun, isSigner: false, isWritable: true },
        { pubkey: rentRecipient, isSigner: false, isWritable: true },
      ],
      data: Buffer.alloc(8),
    });
    const plan: KeeperInstructionPlan = {
      operation: "consume_campaign_run",
      execution: "instruction",
      connection: "base",
      context: {
        owner,
        runId,
        runMode: "campaign",
        runLocation: "base",
        includeArenaPlayer: false,
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
    } as never;
    await expect(verifyConfirmedWrite(plan, connection, "signature")).resolves.toBeUndefined();

    connection.getMultipleAccountsInfo.mockResolvedValueOnce([
      systemAccount(),
      systemAccount(),
    ]);
    await expect(verifyConfirmedWrite(plan, connection, "signature"))
      .rejects.toThrow("does not match");
  });

  it("re-verifies a closed ArenaPlayer and its canonical funding recipient", async () => {
    const owner = Keypair.generate().publicKey;
    const dayId = 20_651;
    const daily = arenaDailyPda(dayId);
    const arenaPlayer = arenaPlayerPda(daily, owner);
    const rentRecipient = playerFundingPda(owner);
    const instruction = new TransactionInstruction({
      programId: ZKUBE_PROGRAM_ID,
      keys: [
        { pubkey: daily, isSigner: false, isWritable: false },
        { pubkey: arenaPlayer, isSigner: false, isWritable: true },
        { pubkey: rentRecipient, isSigner: false, isWritable: true },
      ],
      data: Buffer.alloc(8),
    });
    const plan: KeeperInstructionPlan = {
      operation: "close_arena_player",
      execution: "instruction",
      connection: "base",
      context: { dayId, owner, rentRecipient },
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
    } as never;
    await expect(verifyConfirmedWrite(plan, connection, "signature"))
      .resolves.toBeUndefined();
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
