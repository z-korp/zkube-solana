// @vitest-environment node

import {
  Keypair,
  SystemInstruction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  buildDeviceSessionRefillInstructions,
  buildDeviceSignerReclaimInstruction,
} from "./deviceSessionLifecycle";

describe("device session balance lifecycle", () => {
  it("refills a live signer to exactly 0.005 SOL without rotating it", () => {
    const owner = Keypair.generate().publicKey;
    const signer = Keypair.generate().publicKey;
    const balanceLamports = 890_880;
    const refill = buildDeviceSessionRefillInstructions({
      owner,
      signer,
      balanceLamports,
    });

    expect(refill.topUpLamports).toBe(4_109_120);
    expect(transferLamports(refill.instructions[0]!)).toBe(4_109_120);
    expect(transferLamports(refill.instructions[1]!)).toBe(0);
    expect(balanceLamports + refill.topUpLamports).toBe(5_000_000);
  });

  it("recreates and refills a signer whose zero balance removed its account", () => {
    const owner = Keypair.generate().publicKey;
    const signer = Keypair.generate().publicKey;
    const refill = buildDeviceSessionRefillInstructions({
      owner,
      signer,
      balanceLamports: 0,
    });

    expect(refill.topUpLamports).toBe(5_000_000);
    expect(transferLamports(refill.instructions[0]!)).toBe(5_000_000);
    expect(transferLamports(refill.instructions[1]!)).toBe(0);
  });

  it("reclaims every remaining lamport when a local signer rotates", () => {
    const owner = Keypair.generate().publicKey;
    const signer = Keypair.generate().publicKey;
    const instruction = buildDeviceSignerReclaimInstruction({
      owner,
      signer,
      balanceLamports: 977_000,
    });

    expect(instruction).not.toBeNull();
    expect(transferLamports(instruction!)).toBe(977_000);
    expect(
      buildDeviceSignerReclaimInstruction({
        owner,
        signer,
        balanceLamports: 0,
      }),
    ).toBeNull();
  });
});

function transferLamports(instruction: TransactionInstruction): number {
  return Number(SystemInstruction.decodeTransfer(instruction).lamports);
}
