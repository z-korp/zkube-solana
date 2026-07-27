// @vitest-environment node

import { createPublicKey, verify } from "node:crypto";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemInstruction,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type PublicKey,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  WALLET_TRANSACTION_COMPUTE_UNIT_LIMIT,
  WALLET_TRANSACTION_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  withPinnedWalletComputeBudget,
} from "@/chain/runPlan";
import { ARENA_ENTRY_LAMPORTS } from "@/chain/protocolVersions.generated";
import {
  createFakeWalletStandard,
  signTransactionInputs,
} from "@/test/mocks/walletStandard";
import { classifyWalletError } from "@/utils/errors";
import {
  connectWalletStandard,
  createWalletStandardWallet,
} from "./walletStandard";

const BLOCKHASH = "11111111111111111111111111111111";

describe("Wallet Standard owner-signing capability boundary", () => {
  it("rejects a sign-and-send-only wallet with typed sign-only recovery", async () => {
    const fake = createFakeWalletStandard({
      name: "Send Only Wallet",
      signTransactionVersions: null,
      signAndSendTransactionVersions: [0],
    });

    const rejection = connectWalletStandard(fake.connector);

    await expect(rejection).rejects.toThrow(
      "Send Only Wallet cannot sign versioned transactions without submitting them.",
    );
    const cause = await rejection.catch((error: unknown) => error);
    expect(classifyWalletError(cause)).toMatchObject({
      kind: "unsupported-sign-only-v0",
    });
    expect(fake.connect).not.toHaveBeenCalled();
    expect(fake.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("accepts v0 only when the wallet and account declare signTransaction support", async () => {
    const owner = Keypair.generate();
    const device = Keypair.generate();
    const fake = createFakeWalletStandard({ keypair: owner });
    const original = entryTransaction(owner.publicKey, device);
    const deviceSignature = Uint8Array.from(original.signatures[0]!);
    const connected = await connectWalletStandard(fake.connector);

    const signed = (await connected.wallet.signTransaction(
      original,
    )) as VersionedTransaction;
    const request = fake.signTransaction.mock.calls[0]?.[0];
    const decompiled = TransactionMessage.decompile(signed.message);
    const entry = SystemInstruction.decodeTransfer(
      decompiled.instructions.at(-1)!,
    );

    expect(fake.connector.supportsV0Signing).toBe(true);
    expect(request).toMatchObject({
      account: fake.account,
      chain: "solana:devnet",
      options: { preflightCommitment: "confirmed" },
    });
    expect(
      VersionedTransaction.deserialize(request!.transaction).message.version,
    ).toBe(0);
    expect(entry.fromPubkey.equals(owner.publicKey)).toBe(true);
    expect(entry.lamports).toBe(ARENA_ENTRY_LAMPORTS);
    expect(signed.message.serialize()).toEqual(original.message.serialize());
    expect(signed.signatures[0]).toEqual(deviceSignature);
    expectSignature(
      signed.message.serialize(),
      signed.signatures[0]!,
      device.publicKey,
    );
    expectSignature(
      signed.message.serialize(),
      signed.signatures[1]!,
      owner.publicKey,
    );
    expect(fake.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("does not treat legacy-only signing metadata as v0 support", async () => {
    const fake = createFakeWalletStandard({
      signTransactionVersions: ["legacy"],
    });
    const transaction = entryTransaction(
      fake.keypair.publicKey,
      Keypair.generate(),
    );
    const wallet = createWalletStandardWallet(fake.wallet, fake.account);

    expect(fake.connector.supportsV0Signing).toBe(false);
    await expect(wallet.signTransaction(transaction)).rejects.toThrow(
      "Fake Wallet does not support unsigned v0 transaction signing.",
    );
    expect(fake.signTransaction).not.toHaveBeenCalled();
  });

  it("rejects a mainnet-only account before exposing an owner wallet", async () => {
    const fake = createFakeWalletStandard({
      chains: ["solana:devnet", "solana:mainnet"],
      accountChains: ["solana:mainnet"],
    });

    await expect(connectWalletStandard(fake.connector)).rejects.toThrow(
      "Wallet account is not authorized for Solana Devnet",
    );
    expect(fake.connect).toHaveBeenCalledOnce();
    expect(fake.signTransaction).not.toHaveBeenCalled();
  });
});

describe("Wallet Standard v0 transaction-integrity boundary", () => {
  it.each([
    [
      "compute-unit limit",
      (message: TransactionMessage) => {
        message.instructions[0] = ComputeBudgetProgram.setComputeUnitLimit({
          units: WALLET_TRANSACTION_COMPUTE_UNIT_LIMIT + 1,
        });
      },
    ],
    [
      "priority price",
      (message: TransactionMessage) => {
        message.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({
          microLamports:
            WALLET_TRANSACTION_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS + 1,
        });
      },
    ],
    [
      "recent blockhash",
      (message: TransactionMessage) => {
        message.recentBlockhash = Keypair.generate().publicKey.toBase58();
      },
    ],
    [
      "instruction account order",
      (message: TransactionMessage) => {
        const instruction = message.instructions.at(-1)!;
        message.instructions[message.instructions.length - 1] =
          new TransactionInstruction({
            programId: instruction.programId,
            keys: [...instruction.keys].reverse(),
            data: instruction.data,
          });
      },
    ],
    [
      "instruction signer roles",
      (message: TransactionMessage) => {
        const instruction = message.instructions.at(-1)!;
        message.instructions[message.instructions.length - 1] =
          new TransactionInstruction({
            programId: instruction.programId,
            keys: instruction.keys.map((key, index) => ({
              ...key,
              isSigner: index !== 0,
            })),
            data: instruction.data,
          });
      },
    ],
  ] as const)("rejects wallet-mutated %s", async (_label, mutateMessage) => {
    const owner = Keypair.generate();
    const device = Keypair.generate();
    const fake = createFakeWalletStandard({
      keypair: owner,
      signTransactionOutputs: (inputs) =>
        inputs.map(({ transaction }) => {
          const input = VersionedTransaction.deserialize(transaction);
          const message = TransactionMessage.decompile(input.message);
          mutateMessage(message);
          const mutated = new VersionedTransaction(
            message.compileToV0Message(),
          );
          return { signedTransaction: mutated.serialize() };
        }),
    });
    const wallet = createWalletStandardWallet(fake.wallet, fake.account);

    await expect(
      wallet.signTransaction(entryTransaction(owner.publicKey, device)),
    ).rejects.toThrow("Wallet changed the transaction message");
  });

  it.each(["dropped", "replaced", "corrupted"] as const)(
    "rejects a %s pre-existing device partial signature",
    async (mutation) => {
      const owner = Keypair.generate();
      const device = Keypair.generate();
      const fake = createFakeWalletStandard({
        keypair: owner,
        signTransactionOutputs: (inputs) =>
          inputs.map(({ transaction }) => {
            const output = VersionedTransaction.deserialize(transaction);
            if (mutation === "dropped") {
              output.signatures[0] = new Uint8Array(64);
            } else if (mutation === "replaced") {
              output.signatures[0] = new Uint8Array(64).fill(7);
            } else {
              output.signatures[0] = Uint8Array.from(output.signatures[0]!);
              output.signatures[0]![0] ^= 0xff;
            }
            output.sign([owner]);
            return { signedTransaction: output.serialize() };
          }),
      });
      const wallet = createWalletStandardWallet(fake.wallet, fake.account);

      await expect(
        wallet.signTransaction(entryTransaction(owner.publicKey, device)),
      ).rejects.toThrow("Wallet discarded an existing partial signature");
    },
  );

  it("rejects a missing owner signature", async () => {
    const owner = Keypair.generate();
    const fake = createFakeWalletStandard({
      keypair: owner,
      signTransactionOutputs: (inputs) =>
        inputs.map(({ transaction }) => ({
          signedTransaction: transaction,
        })),
    });
    const wallet = createWalletStandardWallet(fake.wallet, fake.account);

    await expect(
      wallet.signTransaction(
        entryTransaction(owner.publicKey, Keypair.generate()),
      ),
    ).rejects.toThrow("Wallet did not sign with the connected account");
  });

  it("rejects the wrong output count for a batch request", async () => {
    const owner = Keypair.generate();
    const fake = createFakeWalletStandard({
      keypair: owner,
      signTransactionOutputs: (inputs) =>
        signTransactionInputs(inputs.slice(0, 1), owner),
    });
    const wallet = createWalletStandardWallet(fake.wallet, fake.account);

    await expect(
      wallet.signAllTransactions([
        entryTransaction(owner.publicKey, Keypair.generate()),
        entryTransaction(owner.publicKey, Keypair.generate()),
      ]),
    ).rejects.toThrow("Wallet returned an unexpected transaction count");
  });

  it("rejects a malformed signed-transaction output", async () => {
    const owner = Keypair.generate();
    const fake = createFakeWalletStandard({
      keypair: owner,
      signTransactionOutputs: () => [
        { signedTransaction: new Uint8Array([1, 2, 3]) },
      ],
    });
    const wallet = createWalletStandardWallet(fake.wallet, fake.account);

    await expect(
      wallet.signTransaction(
        entryTransaction(owner.publicKey, Keypair.generate()),
      ),
    ).rejects.toThrow();
  });
});

function entryTransaction(
  owner: PublicKey,
  device: Keypair,
): VersionedTransaction {
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: device.publicKey,
      recentBlockhash: BLOCKHASH,
      instructions: withPinnedWalletComputeBudget([
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: Keypair.generate().publicKey,
          lamports: Number(ARENA_ENTRY_LAMPORTS),
        }),
      ]),
    }).compileToV0Message(),
  );
  transaction.sign([device]);
  return transaction;
}

function expectSignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: PublicKey,
): void {
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const key = createPublicKey({
    key: Buffer.concat([spkiPrefix, Buffer.from(publicKey.toBytes())]),
    format: "der",
    type: "spki",
  });
  expect(verify(null, Buffer.from(message), key, Buffer.from(signature))).toBe(
    true,
  );
}
