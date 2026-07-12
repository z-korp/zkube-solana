// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { deriveRunAddresses } from "./pdas";
import { deriveSessionTokenV2Pda } from "./sessionV2";
import {
  RUN_SESSION_STORAGE_KEY,
  clearRunSession,
  isRunSessionFresh,
  loadRunSession,
  saveRunSession,
} from "./runSessionStore";

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
    const restored = loadRunSession(owner, { storage });
    expect(restored?.runId).toBe(17n);
    expect(restored?.session.publicKey.equals(session.publicKey)).toBe(true);
    expect(
      restored?.addresses.activeRun.equals(marker.addresses.activeRun),
    ).toBe(true);

    expect(isRunSessionFresh(marker, 1_939)).toBe(true);
    expect(isRunSessionFresh(marker, 1_940)).toBe(false);
    expect(isRunSessionFresh(marker, 2_100)).toBe(false);
    expect(loadRunSession(owner, { storage })?.runId).toBe(17n);
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
    expect(loadRunSession(other, { storage })).toBeNull();

    const parsed = JSON.parse(
      storage.getItem(RUN_SESSION_STORAGE_KEY)!,
    ) as Record<string, { activeRun: string }>;
    parsed[owner.toBase58()].activeRun =
      Keypair.generate().publicKey.toBase58();
    storage.setItem(RUN_SESSION_STORAGE_KEY, JSON.stringify(parsed));
    expect(loadRunSession(owner, { storage })).toBeNull();
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
    clearRunSession(first.publicKey, storage);
    expect(loadRunSession(first.publicKey, { storage })).toBeNull();
    expect(loadRunSession(second.publicKey, { storage })).not.toBeNull();
  });
});

class MemoryStorage {
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
