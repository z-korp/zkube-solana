// @vitest-environment node

import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { ZKUBE_PROGRAM_ID } from "../constants";
import {
  SPONSORED_GAME_DISCRIMINATORS,
  validatePaymasterTransaction,
} from "../../server/paymaster";
import {
  compileSponsoredTransactionPlan,
  type TransactionPlan,
} from "./runPlan";
import { SessionWallet } from "./sessionWallet";

describe("sponsored transaction plans", () => {
  it("compiles, player-signs, simulates, and passes the server policy", async () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const connection = {
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: "11111111111111111111111111111111",
      }),
      simulateTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
    } as unknown as Connection;
    const instruction = initializePlayerInstruction(paymaster, owner);
    const transactionPlan: TransactionPlan = {
      layer: "solana-base",
      label: "Initialize player",
      connection,
      transaction: new Transaction().add(instruction),
      feePayer: paymaster.publicKey,
      signers: [],
    };

    const transaction = await compileSponsoredTransactionPlan({
      transactionPlan,
      wallet: new SessionWallet(owner),
      paymaster: paymaster.publicKey,
    });

    expect(connection.getLatestBlockhash).toHaveBeenCalledOnce();
    expect(connection.simulateTransaction).toHaveBeenCalledOnce();
    expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBeNull();
  });

  it("refuses a plan built for a different fee payer", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const connection = {} as Connection;
    const transactionPlan: TransactionPlan = {
      layer: "solana-base",
      label: "Wrong payer",
      connection,
      transaction: new Transaction(),
      feePayer: owner.publicKey,
      signers: [],
    };
    await expect(compileSponsoredTransactionPlan({
      transactionPlan,
      wallet: new SessionWallet(owner),
      paymaster: paymaster.publicKey,
    })).rejects.toThrow("selected paymaster");
  });
});

function initializePlayerInstruction(paymaster: Keypair, owner: Keypair): TransactionInstruction {
  return new TransactionInstruction({
    programId: ZKUBE_PROGRAM_ID,
    keys: [
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: paymaster.publicKey, isSigner: true, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(SPONSORED_GAME_DISCRIMINATORS.initializePlayerV1),
  });
}
