// @vitest-environment node

import {
  Keypair,
  SystemInstruction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  buildDeviceSessionRefillInstructions,
  buildDeviceSignerReclaimInstruction,
  deviceSessionExpiryDelayMs,
  DeviceSessionExpiredError,
  DEVICE_SESSION_EXPIRED_MESSAGE,
  withSigningDeadline,
} from "./deviceSessionLifecycle";

describe("device session balance lifecycle", () => {
  it("uses one fail-closed expiry boundary for startup and foreground checks", () => {
    expect(deviceSessionExpiryDelayMs(2_000, 1_939_000)).toBe(1_000);
    expect(deviceSessionExpiryDelayMs(2_000, 1_940_000)).toBe(0);
    expect(deviceSessionExpiryDelayMs(2_000, 1_950_000)).toBe(-10_000);
    const error = new DeviceSessionExpiredError();
    expect(error).toMatchObject({
      name: "DeviceSessionExpiredError",
      code: "session-expired",
      message: DEVICE_SESSION_EXPIRED_MESSAGE,
    });
  });

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

describe("withSigningDeadline", () => {
  it("passes a timely signature through and clears its timer", async () => {
    vi.useFakeTimers();
    try {
      const signed = await withSigningDeadline(
        Promise.resolve("signed"),
        "Enable zKube device session",
      );
      expect(signed).toBe("signed");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a signing request the wallet never answers", async () => {
    vi.useFakeTimers();
    try {
      const pending = withSigningDeadline(
        new Promise<never>(() => undefined),
        "Enable zKube device session",
      );
      const assertion = expect(pending).rejects.toThrow(
        /did not return the signed transaction within 1 minute/i,
      );
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

function transferLamports(instruction: TransactionInstruction): number {
  return Number(SystemInstruction.decodeTransfer(instruction).lamports);
}
