// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  deleteEmbeddedIdentity,
  exportRecoveryCode,
  importRecoveryCode,
  loadOrCreateEmbeddedIdentity,
} from "./embeddedIdentity";
import { SessionWallet } from "./sessionWallet";

describe("embedded zKube identity", () => {
  beforeEach(() => deleteEmbeddedIdentity());

  it("creates one stable identity without a browser wallet", () => {
    const first = loadOrCreateEmbeddedIdentity();
    const second = loadOrCreateEmbeddedIdentity();
    expect(second.publicKey.toBase58()).toBe(first.publicKey.toBase58());
  });

  it("exports and restores the complete Recovery Code", () => {
    const original = loadOrCreateEmbeddedIdentity();
    const code = exportRecoveryCode(original);
    expect(code).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){31}$/);
    deleteEmbeddedIdentity();
    const restored = importRecoveryCode(` ${code.toUpperCase()} `);
    expect(restored.publicKey.toBase58()).toBe(original.publicKey.toBase58());
    expect(loadOrCreateEmbeddedIdentity().publicKey.toBase58()).toBe(
      original.publicKey.toBase58(),
    );
  });

  it("rejects incomplete Recovery Codes", () => {
    expect(() => importRecoveryCode("dead-beef")).toThrow(/32 groups/);
  });

  it("signs locally through the common wallet seam", async () => {
    const keypair = loadOrCreateEmbeddedIdentity();
    const wallet = new SessionWallet(keypair);
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: keypair.publicKey,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: [
          SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: Keypair.generate().publicKey,
            lamports: 1,
          }),
        ],
      }).compileToV0Message(),
    );
    const signed = await wallet.signTransaction(transaction);
    expect(signed.signatures[0].some((byte) => byte !== 0)).toBe(true);
  });
});
