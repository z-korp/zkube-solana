// @vitest-environment node

import { createPublicKey, verify } from "node:crypto";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { verifyWalletSignedOutput } from "./walletStandard";

describe("Wallet Standard signing boundary", () => {
  it("preserves a deterministic v0 message and a real device partial signature", () => {
    const feePayer = Keypair.fromSeed(
      Uint8Array.from({ length: 32 }, (_, i) => i + 1),
    );
    const owner = Keypair.fromSeed(
      Uint8Array.from({ length: 32 }, (_, i) => i + 33),
    );
    const device = Keypair.fromSeed(
      Uint8Array.from({ length: 32 }, (_, i) => i + 65),
    );
    const original = signedTransaction(feePayer, owner, device);
    original.sign([device]);
    const deviceSignature = Uint8Array.from(original.signatures[2]!);

    const walletOutput = VersionedTransaction.deserialize(original.serialize());
    walletOutput.sign([owner]);
    const checked = verifyWalletSignedOutput(
      original,
      walletOutput.serialize(),
      owner.publicKey,
    ) as VersionedTransaction;

    expect(checked.message.serialize()).toEqual(original.message.serialize());
    expect(checked.signatures[2]).toEqual(deviceSignature);
    expect(
      verifyEd25519(
        checked.message.serialize(),
        checked.signatures[1]!,
        owner.publicKey.toBytes(),
      ),
    ).toBe(true);
    expect(
      verifyEd25519(
        checked.message.serialize(),
        checked.signatures[2]!,
        device.publicKey.toBytes(),
      ),
    ).toBe(true);
  });

  it("rejects message expansion and discarded partial signatures", () => {
    const feePayer = Keypair.generate();
    const owner = Keypair.generate();
    const device = Keypair.generate();
    const original = signedTransaction(feePayer, owner, device);
    original.sign([device]);

    const expanded = new VersionedTransaction(
      new TransactionMessage({
        payerKey: feePayer.publicKey,
        recentBlockhash: "11111111111111111111111111111111",
        instructions: [
          SystemProgram.transfer({
            fromPubkey: owner.publicKey,
            toPubkey: device.publicKey,
            lamports: 1,
          }),
        ],
      }).compileToV0Message(),
    );
    expanded.sign([owner]);
    expect(() =>
      verifyWalletSignedOutput(original, expanded.serialize(), owner.publicKey),
    ).toThrow("changed the transaction message");

    const discarded = VersionedTransaction.deserialize(original.serialize());
    discarded.signatures[2] = new Uint8Array(64);
    discarded.sign([owner]);
    expect(() =>
      verifyWalletSignedOutput(
        original,
        discarded.serialize(),
        owner.publicKey,
      ),
    ).toThrow("discarded an existing partial signature");
  });

  it("rejects wallet-added priority fees instead of weakening message integrity", () => {
    const owner = Keypair.generate();
    const recipient = Keypair.generate();
    const transfer = SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: recipient.publicKey,
      lamports: 1,
    });
    const original = new VersionedTransaction(
      new TransactionMessage({
        payerKey: owner.publicKey,
        recentBlockhash: "11111111111111111111111111111111",
        instructions: [transfer],
      }).compileToV0Message(),
    );
    const enhanced = new VersionedTransaction(
      new TransactionMessage({
        payerKey: owner.publicKey,
        recentBlockhash: "11111111111111111111111111111111",
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1n }),
          transfer,
        ],
      }).compileToV0Message(),
    );
    enhanced.sign([owner]);

    expect(() =>
      verifyWalletSignedOutput(original, enhanced.serialize(), owner.publicKey),
    ).toThrow("changed the transaction message");
  });
});

function signedTransaction(
  feePayer: Keypair,
  owner: Keypair,
  device: Keypair,
): VersionedTransaction {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: feePayer.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [
        {
          programId: SystemProgram.programId,
          keys: [
            { pubkey: owner.publicKey, isSigner: true, isWritable: false },
            { pubkey: device.publicKey, isSigner: true, isWritable: false },
          ],
          data: Buffer.alloc(0),
        },
      ],
    }).compileToV0Message(),
  );
}

function verifyEd25519(
  message: Uint8Array,
  signature: Uint8Array,
  rawPublicKey: Uint8Array,
): boolean {
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const key = createPublicKey({
    key: Buffer.concat([spkiPrefix, Buffer.from(rawPublicKey)]),
    format: "der",
    type: "spki",
  });
  return verify(null, Buffer.from(message), key, Buffer.from(signature));
}
