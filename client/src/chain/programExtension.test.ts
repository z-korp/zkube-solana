// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  legacyExtendProgramData,
  legacyExtendProgramInstruction,
} from "./programExtension";

const LOADER_ID = "BPFLoaderUpgradeab1e11111111111111111111111";

describe("legacy ProgramData extension", () => {
  it("uses the official bincode variant and exact account positions", () => {
    const programId = new PublicKey(
      "5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA",
    );
    const programDataAddress = new PublicKey(
      "ALpqN17vyyQr3vuqaHiCAdawtiMniVxK6PzEgPw7P9sB",
    );
    const payer = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;
    const instruction = legacyExtendProgramInstruction({
      programId,
      programDataAddress,
      payer,
      additionalBytes: 1_096,
    });

    expect(instruction.programId.toBase58()).toBe(LOADER_ID);
    expect(instruction.data.toString("hex")).toBe("0600000048040000");
    expect(
      instruction.keys.map(({ pubkey, isWritable, isSigner }) => ({
        publicKey: pubkey.toBase58(),
        writable: isWritable,
        signer: isSigner,
      })),
    ).toEqual([
      {
        publicKey: programDataAddress.toBase58(),
        writable: true,
        signer: false,
      },
      { publicKey: programId.toBase58(), writable: true, signer: false },
      {
        publicKey: SystemProgram.programId.toBase58(),
        writable: false,
        signer: false,
      },
      { publicKey: payer.toBase58(), writable: true, signer: true },
    ]);
  });

  it("retains a deterministic real payer signature through v0 serialization", () => {
    const payer = Keypair.fromSeed(new Uint8Array(32).fill(9));
    const instruction = legacyExtendProgramInstruction({
      programId: new PublicKey("5NfTo5ML4UTa6ep4x9d616fyWQYM3CTcpcE5V9P7YUbA"),
      programDataAddress: new PublicKey(
        "ALpqN17vyyQr3vuqaHiCAdawtiMniVxK6PzEgPw7P9sB",
      ),
      payer: payer.publicKey,
      additionalBytes: 1_096,
    });
    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: new PublicKey(new Uint8Array(32).fill(11)).toBase58(),
      instructions: [instruction],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    transaction.sign([payer]);

    const serialized = transaction.serialize();
    const decoded = VersionedTransaction.deserialize(serialized);
    expect(decoded.message.header.numRequiredSignatures).toBe(1);
    expect(decoded.message.staticAccountKeys[0]?.equals(payer.publicKey)).toBe(
      true,
    );
    expect(
      Buffer.from(decoded.signatures[0] ?? []).equals(Buffer.alloc(64)),
    ).toBe(false);
    expect(Buffer.from(decoded.serialize())).toEqual(Buffer.from(serialized));
  });

  it("rejects non-positive and non-u32 allocation sizes", () => {
    expect(() => legacyExtendProgramData(0)).toThrow(/positive u32/);
    expect(() => legacyExtendProgramData(0x1_0000_0000)).toThrow(
      /positive u32/,
    );
  });
});
