// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { StorageLike } from "@/platform/browserStorage";
import {
  LAST_WALLET_STORAGE_KEY,
  clearLastWallet,
  loadLastWallet,
  saveLastWallet,
} from "./lastWalletStore";

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe("lastWalletStore", () => {
  it("round-trips the last connected wallet", () => {
    const storage = memoryStorage();
    saveLastWallet({ connectorId: "phantom", address: "Addr111" }, storage);
    expect(loadLastWallet(storage)).toEqual({
      connectorId: "phantom",
      address: "Addr111",
    });

    clearLastWallet(storage);
    expect(loadLastWallet(storage)).toBeNull();
  });

  it("rejects malformed or foreign records instead of throwing", () => {
    const storage = memoryStorage();
    storage.setItem(LAST_WALLET_STORAGE_KEY, "not json");
    expect(loadLastWallet(storage)).toBeNull();

    storage.setItem(
      LAST_WALLET_STORAGE_KEY,
      JSON.stringify({ version: 2, connectorId: "x", address: "y" }),
    );
    expect(loadLastWallet(storage)).toBeNull();

    storage.setItem(
      LAST_WALLET_STORAGE_KEY,
      JSON.stringify({ version: 1, connectorId: 5, address: "y" }),
    );
    expect(loadLastWallet(storage)).toBeNull();
  });

  it("is a no-op without browser storage", () => {
    expect(() => saveLastWallet({ connectorId: "a", address: "b" }, null)).not.toThrow();
    expect(loadLastWallet(null)).toBeNull();
    expect(() => clearLastWallet(null)).not.toThrow();
  });
});
