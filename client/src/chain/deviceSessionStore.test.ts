// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  clearDeviceSession,
  loadDeviceSession,
  requireCurrentDeviceSession,
  saveDeviceSession,
  type DeviceSession,
} from "./deviceSessionStore";
import { deriveSessionTokenV2Pda } from "./sessionV2";
import type { StorageLike } from "@/platform/browserStorage";

describe("device session storage", () => {
  it("scopes persisted session keys to the exact connected owner", () => {
    const storage = new MemoryStorage();
    const owner = Keypair.generate().publicKey;
    const other = Keypair.generate().publicKey;
    const session = fixture(owner, 2_000);
    saveDeviceSession(session, storage);

    expect(loadDeviceSession(owner, storage)?.signer.publicKey.equals(session.signer.publicKey)).toBe(true);
    expect(loadDeviceSession(other, storage)).toBeNull();
    clearDeviceSession(owner, storage);
    expect(loadDeviceSession(owner, storage)).toBeNull();
  });

  it("rejects account changes and stale sessions before signing", () => {
    const owner = Keypair.generate().publicKey;
    const session = fixture(owner, 2_000);
    expect(requireCurrentDeviceSession(session, owner, 1_000)).toBe(session);
    expect(() =>
      requireCurrentDeviceSession(session, Keypair.generate().publicKey, 1_000),
    ).toThrow("account changed");
    expect(() => requireCurrentDeviceSession(session, owner, 1_950)).toThrow(
      "expired",
    );
    expect(() => saveDeviceSession(session, null)).toThrow(
      "Browser storage is unavailable",
    );
  });
});

function fixture(owner: import("@solana/web3.js").PublicKey, validUntil: number): DeviceSession {
  const signer = Keypair.generate();
  return {
    owner,
    signer,
    sessionToken: deriveSessionTokenV2Pda({
      authority: owner,
      sessionSigner: signer.publicKey,
    }).sessionToken,
    validUntil,
    createdAt: 1_000,
  };
}

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
