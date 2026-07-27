// @vitest-environment node

import { Keypair, type PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  clearDeviceSession,
  loadDeviceSession,
  requireCurrentDeviceSession,
  saveDeviceSession,
  type DeviceSession,
} from "./deviceSessionStore";
import { deriveRunAddresses } from "./pdas";
import {
  RUN_SESSION_STORAGE_KEY,
  clearRunSession,
  isRunSessionFresh,
  loadRunSession,
  saveRunSession,
} from "./runSessionStore";
import { deriveSessionTokenV2Pda } from "./sessionV2";
import type { StorageLike } from "@/platform/browserStorage";

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

function deviceFixture(owner: PublicKey, validUntil: number): DeviceSession {
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

describe("device session storage", () => {
  it("scopes persisted session keys to the exact connected owner", () => {
    const storage = new MemoryStorage();
    const owner = Keypair.generate().publicKey;
    const other = Keypair.generate().publicKey;
    const session = deviceFixture(owner, 2_000);
    saveDeviceSession(session, storage);

    expect(
      loadDeviceSession(owner, storage)?.signer.publicKey.equals(
        session.signer.publicKey,
      ),
    ).toBe(true);
    expect(loadDeviceSession(other, storage)).toBeNull();
    clearDeviceSession(owner, storage);
    expect(loadDeviceSession(owner, storage)).toBeNull();
  });

  it("rejects account changes and stale sessions before signing", () => {
    const owner = Keypair.generate().publicKey;
    const session = deviceFixture(owner, 2_000);
    expect(requireCurrentDeviceSession(session, owner, 1_000)).toBe(session);
    expect(() =>
      requireCurrentDeviceSession(session, Keypair.generate().publicKey, 1_000),
    ).toThrow("account changed");
    expect(() => requireCurrentDeviceSession(session, owner, 1_950)).toThrow(
      "expired",
    );
    try {
      requireCurrentDeviceSession(session, owner, 1_950);
    } catch (cause) {
      expect(cause).toMatchObject({ code: "session-expired" });
    }
    expect(() => saveDeviceSession(session, null)).toThrow(
      "Browser storage is unavailable",
    );
  });
});

describe("run session persistence", () => {
  it("keeps a PDA-bound marker after authorization becomes stale", () => {
    const storage = new MemoryStorage();
    const owner = Keypair.generate().publicKey;
    const session = Keypair.generate();
    const marker = {
      owner,
      runId: 17n,
      mode: "campaign" as const,
      session,
      sessionToken: deriveSessionTokenV2Pda({
        authority: owner,
        sessionSigner: session.publicKey,
      }).sessionToken,
      addresses: deriveRunAddresses(owner, 17n),
      validUntil: 2_000,
      createdAt: 1_000,
    };
    saveRunSession(marker, storage);
    const restored = loadRunSession(owner, "campaign", { storage });
    expect(restored?.runId).toBe(17n);
    expect(restored?.session.publicKey.equals(session.publicKey)).toBe(true);
    expect(
      restored?.addresses.activeRun.equals(marker.addresses.activeRun),
    ).toBe(true);

    expect(isRunSessionFresh(marker, 1_939)).toBe(true);
    expect(isRunSessionFresh(marker, 1_940)).toBe(false);
    expect(isRunSessionFresh(marker, 2_100)).toBe(false);
    expect(loadRunSession(owner, "campaign", { storage })?.runId).toBe(17n);
    expect(storage.getItem(RUN_SESSION_STORAGE_KEY)).not.toBeNull();
  });

  it("drops tampered addresses or secret keys and isolates wallet owners", () => {
    const storage = new MemoryStorage();
    const owner = Keypair.generate().publicKey;
    const other = Keypair.generate().publicKey;
    const session = Keypair.generate();
    saveRunSession(
      {
        owner,
        runId: 3n,
        mode: "daily",
        session,
        sessionToken: deriveSessionTokenV2Pda({
          authority: owner,
          sessionSigner: session.publicKey,
        }).sessionToken,
        addresses: deriveRunAddresses(owner, 3n),
        validUntil: 5_000,
        createdAt: 1_000,
      },
      storage,
    );
    expect(loadRunSession(other, "arcade", { storage })).toBeNull();

    const parsed = JSON.parse(
      storage.getItem(RUN_SESSION_STORAGE_KEY)!,
    ) as Record<string, { activeRun: string }>;
    parsed[`${owner.toBase58()}:arcade`]!.activeRun =
      Keypair.generate().publicKey.toBase58();
    storage.setItem(RUN_SESSION_STORAGE_KEY, JSON.stringify(parsed));
    expect(loadRunSession(owner, "arcade", { storage })).toBeNull();
    expect(storage.getItem(RUN_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("clears only the selected owner's marker", () => {
    const storage = new MemoryStorage();
    const first = Keypair.generate();
    const second = Keypair.generate();
    for (const owner of [first.publicKey, second.publicKey]) {
      const session = Keypair.generate();
      saveRunSession(
        {
          owner,
          runId: 1n,
          mode: "campaign",
          session,
          sessionToken: deriveSessionTokenV2Pda({
            authority: owner,
            sessionSigner: session.publicKey,
          }).sessionToken,
          addresses: deriveRunAddresses(owner, 1n),
          validUntil: 5_000,
          createdAt: 1_000,
        },
        storage,
      );
    }
    clearRunSession(first.publicKey, undefined, storage);
    expect(loadRunSession(first.publicKey, "campaign", { storage })).toBeNull();
    expect(
      loadRunSession(second.publicKey, "campaign", { storage }),
    ).not.toBeNull();
  });

  it("round-trips the free Practice run mode", () => {
    const storage = new MemoryStorage();
    const owner = Keypair.generate().publicKey;
    const session = Keypair.generate();
    saveRunSession(
      {
        owner,
        runId: 22n,
        mode: "practice",
        session,
        sessionToken: deriveSessionTokenV2Pda({
          authority: owner,
          sessionSigner: session.publicKey,
        }).sessionToken,
        addresses: deriveRunAddresses(owner, 22n),
        validUntil: 5_000,
        createdAt: 1_000,
      },
      storage,
    );
    expect(loadRunSession(owner, "arcade", { storage })?.mode).toBe("practice");
  });

  it("keeps one Campaign marker and one Arcade marker for the same owner", () => {
    const storage = new MemoryStorage();
    const owner = Keypair.generate().publicKey;
    for (const [runId, mode] of [
      [31n, "campaign"],
      [32n, "daily"],
    ] as const) {
      const session = Keypair.generate();
      saveRunSession(
        {
          owner,
          runId,
          mode,
          session,
          sessionToken: deriveSessionTokenV2Pda({
            authority: owner,
            sessionSigner: session.publicKey,
          }).sessionToken,
          addresses: deriveRunAddresses(owner, runId),
          validUntil: 5_000,
          createdAt: 1_000,
        },
        storage,
      );
    }
    expect(loadRunSession(owner, "campaign", { storage })?.runId).toBe(31n);
    expect(loadRunSession(owner, "arcade", { storage })?.runId).toBe(32n);
    clearRunSession(owner, "campaign", storage);
    expect(loadRunSession(owner, "campaign", { storage })).toBeNull();
    expect(loadRunSession(owner, "arcade", { storage })?.runId).toBe(32n);
  });
});
