// @vitest-environment node

import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearErBlockhashCacheForTests,
  submitErTransactionPlan,
} from "./erTransport";
import type { TransactionPlan } from "./runPlan";
import { SessionWallet } from "./sessionWallet";

const blockhash = "11111111111111111111111111111111";

beforeEach(() => clearErBlockhashCacheForTests());

describe("fast ER transport", () => {
  it("caches endpoint blockhashes, skips simulation/preflight, and inspects confirmation", async () => {
    const getLatestBlockhash = vi
      .fn()
      .mockResolvedValue({ blockhash, lastValidBlockHeight: 500 });
    const sendRawTransaction = vi.fn().mockResolvedValue("er-signature");
    const confirmTransaction = vi
      .fn()
      .mockResolvedValue({ context: { slot: 1 }, value: { err: null } });
    const simulateTransaction = vi.fn();
    const connection = {
      rpcEndpoint: "https://devnet-eu.magicblock.app",
      getLatestBlockhash,
      sendRawTransaction,
      confirmTransaction,
      simulateTransaction,
    } as unknown as Connection;
    const wallet = new SessionWallet(Keypair.generate());
    const plan = transactionPlan(connection, wallet.publicKey);

    const first = await submitErTransactionPlan({
      transactionPlan: plan,
      wallet,
    });
    const second = await submitErTransactionPlan({
      transactionPlan: plan,
      wallet,
    });

    expect(first.signature).toBe("er-signature");
    expect(second.timing.blockhashCacheHit).toBe(true);
    expect(getLatestBlockhash).toHaveBeenCalledOnce();
    expect(simulateTransaction).not.toHaveBeenCalled();
    expect(sendRawTransaction).toHaveBeenCalledTimes(2);
    expect(sendRawTransaction.mock.calls[0]?.[1]).toEqual({
      maxRetries: 0,
      skipPreflight: true,
    });
    const sent = Transaction.from(
      sendRawTransaction.mock.calls[0]?.[0] as Buffer,
    );
    expect(sent.verifySignatures(true)).toBe(true);
    expect(sent.signatures[0]?.publicKey.equals(wallet.publicKey)).toBe(true);
    expect(confirmTransaction).toHaveBeenCalledWith(
      { signature: "er-signature", blockhash, lastValidBlockHeight: 500 },
      "confirmed",
    );
  });

  it("refreshes and re-signs once after a definite pre-execution blockhash rejection", async () => {
    const getLatestBlockhash = vi
      .fn()
      .mockResolvedValueOnce({ blockhash, lastValidBlockHeight: 500 })
      .mockResolvedValueOnce({
        blockhash: PublicKey.unique().toBase58(),
        lastValidBlockHeight: 600,
      });
    const sendRawTransaction = vi
      .fn()
      .mockRejectedValueOnce(new Error("Blockhash not found"))
      .mockResolvedValueOnce("retry-signature");
    const connection = {
      rpcEndpoint: "https://devnet-us.magicblock.app",
      getLatestBlockhash,
      sendRawTransaction,
      confirmTransaction: vi
        .fn()
        .mockResolvedValue({ context: { slot: 2 }, value: { err: null } }),
    } as unknown as Connection;
    const wallet = new SessionWallet(Keypair.generate());

    const result = await submitErTransactionPlan({
      transactionPlan: transactionPlan(connection, wallet.publicKey),
      wallet,
    });

    expect(result.signature).toBe("retry-signature");
    expect(result.timing.blockhashRefreshes).toBe(1);
    expect(getLatestBlockhash).toHaveBeenCalledTimes(2);
    expect(sendRawTransaction).toHaveBeenCalledTimes(2);
  });

  it("does not replay a submitted transaction whose outcome is unknown", async () => {
    const sendRawTransaction = vi.fn().mockResolvedValue("uncertain-signature");
    const connection = {
      rpcEndpoint: "https://devnet-as.magicblock.app",
      getLatestBlockhash: vi
        .fn()
        .mockResolvedValue({ blockhash, lastValidBlockHeight: 500 }),
      sendRawTransaction,
      confirmTransaction: vi
        .fn()
        .mockRejectedValue(new Error("confirmation timed out")),
      getSignatureStatuses: vi.fn().mockResolvedValue({
        context: { slot: 3 },
        value: [null],
      }),
    } as unknown as Connection;
    const wallet = new SessionWallet(Keypair.generate());

    await expect(
      submitErTransactionPlan({
        transactionPlan: transactionPlan(connection, wallet.publicKey),
        wallet,
      }),
    ).rejects.toThrow("outcome is not yet known");
    expect(sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("reconciles a submitted transaction after blockheight confirmation expiry", async () => {
    const sendRawTransaction = vi.fn().mockResolvedValue("late-signature");
    const connection = {
      rpcEndpoint: "https://devnet-eu.magicblock.app",
      getLatestBlockhash: vi
        .fn()
        .mockResolvedValue({ blockhash, lastValidBlockHeight: 500 }),
      sendRawTransaction,
      confirmTransaction: vi
        .fn()
        .mockRejectedValue(new Error("block height exceeded")),
      getSignatureStatuses: vi.fn().mockResolvedValue({
        context: { slot: 4 },
        value: [{ err: null, confirmationStatus: "confirmed" }],
      }),
    } as unknown as Connection;
    const wallet = new SessionWallet(Keypair.generate());

    const result = await submitErTransactionPlan({
      transactionPlan: transactionPlan(connection, wallet.publicKey),
      wallet,
    });

    expect(result.signature).toBe("late-signature");
    expect(sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("rejects base-layer plans at the transport boundary", async () => {
    const connection = {
      rpcEndpoint: "https://api.devnet.solana.com",
    } as Connection;
    const wallet = new SessionWallet(Keypair.generate());
    const plan = transactionPlan(connection, wallet.publicKey);
    plan.layer = "solana-base";

    await expect(
      submitErTransactionPlan({ transactionPlan: plan, wallet }),
    ).rejects.toThrow("cannot send a base-layer transaction");
  });
});

function transactionPlan(
  connection: Connection,
  feePayer: PublicKey,
): TransactionPlan {
  const instruction = new TransactionInstruction({
    programId: PublicKey.unique(),
    keys: [{ pubkey: feePayer, isSigner: true, isWritable: true }],
    data: Buffer.from([1, 2, 3]),
  });
  return {
    layer: "magicblock-er",
    label: "test ER action",
    connection,
    transaction: new Transaction().add(instruction),
    feePayer,
    signers: [],
  };
}
