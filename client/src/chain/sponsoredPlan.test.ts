// @vitest-environment node

import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { ZKUBE_PROGRAM_ID } from "./constants";
import {
  SPONSORED_GAME_DISCRIMINATORS,
  validatePaymasterTransaction,
} from "../server/paymaster";
import {
  buildFinalizeRunPlan,
  compileSponsoredTransactionPlan,
  type TransactionPlan,
} from "./runPlan";
import { deriveRunAddresses } from "./pdas";
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
    expect(
      validatePaymasterTransaction(transaction, paymaster.publicKey),
    ).toBeNull();
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
    await expect(
      compileSponsoredTransactionPlan({
        transactionPlan,
        wallet: new SessionWallet(owner),
        paymaster: paymaster.publicKey,
      }),
    ).rejects.toThrow("selected paymaster");
  });

  it("compiles the exact unconsumed campaign recovery envelope accepted by the paymaster", async () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const connection = sponsoredConnection();
    const transactionPlan = await buildFinalizeRunPlan({
      wallet: new SessionWallet(owner),
      owner: owner.publicKey,
      runId: 7n,
      addresses: deriveRunAddresses(owner.publicKey, 7n),
      mode: "campaign",
      receiptConsumed: false,
      connection,
      paymaster: paymaster.publicKey,
    });

    const transaction = await compileSponsoredTransactionPlan({
      transactionPlan,
      wallet: new SessionWallet(owner),
      paymaster: paymaster.publicKey,
    });

    expect(compiledDiscriminators(transaction)).toEqual([
      SPONSORED_GAME_DISCRIMINATORS.consumeSponsorshipV1,
      SPONSORED_GAME_DISCRIMINATORS.consumeRunReceiptV1,
      SPONSORED_GAME_DISCRIMINATORS.closeSettledActiveRunV1,
    ]);
    expect(
      validatePaymasterTransaction(transaction, paymaster.publicKey),
    ).toBeNull();
  });

  it("omits receipt consumption after an already-consumed campaign receipt", async () => {
    const paymaster = Keypair.generate();
    const owner = Keypair.generate();
    const connection = sponsoredConnection();
    const transactionPlan = await buildFinalizeRunPlan({
      wallet: new SessionWallet(owner),
      owner: owner.publicKey,
      runId: 7n,
      addresses: deriveRunAddresses(owner.publicKey, 7n),
      mode: "campaign",
      receiptConsumed: true,
      connection,
      paymaster: paymaster.publicKey,
    });

    const transaction = await compileSponsoredTransactionPlan({
      transactionPlan,
      wallet: new SessionWallet(owner),
      paymaster: paymaster.publicKey,
    });

    expect(compiledDiscriminators(transaction)).toEqual([
      SPONSORED_GAME_DISCRIMINATORS.consumeSponsorshipV1,
      SPONSORED_GAME_DISCRIMINATORS.closeSettledActiveRunV1,
    ]);
    expect(
      validatePaymasterTransaction(transaction, paymaster.publicKey),
    ).toBeNull();
  });
});

function sponsoredConnection(): Connection {
  return {
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: "11111111111111111111111111111111",
    }),
    simulateTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
  } as unknown as Connection;
}

function compiledDiscriminators(
  transaction: import("@solana/web3.js").VersionedTransaction,
) {
  return transaction.message.compiledInstructions.map((instruction) =>
    Array.from(instruction.data.slice(0, 8)),
  );
}

function initializePlayerInstruction(
  paymaster: Keypair,
  owner: Keypair,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ZKUBE_PROGRAM_ID,
    keys: [
      {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: paymaster.publicKey, isSigner: true, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(SPONSORED_GAME_DISCRIMINATORS.initializePlayerV1),
  });
}
