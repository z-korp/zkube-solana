import { PublicKey } from "@solana/web3.js";

import {
  browserLocalStorage,
  type StorageLike,
} from "@/platform/browserStorage";

export const LAST_WALLET_STORAGE_KEY = "zkube:last-wallet:v1";
const MAX_CONNECTOR_ID_LENGTH = 512;

interface StoredLastWallet {
  version: 1;
  connectorId: string;
  address: string;
}

export interface LastWallet {
  connectorId: string;
  address: string;
}

/**
 * Best-effort memory of the last connected wallet so a page refresh can
 * silently reconnect. Never throws — losing this record only costs one tap.
 */
export function saveLastWallet(
  entry: LastWallet,
  storage: StorageLike | null = browserLocalStorage(),
): void {
  if (!storage || !isLastWallet(entry)) return;
  try {
    const record: StoredLastWallet = { version: 1, ...entry };
    storage.setItem(LAST_WALLET_STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* best effort */
  }
}

export function loadLastWallet(
  storage: StorageLike | null = browserLocalStorage(),
): LastWallet | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAST_WALLET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLastWallet> | null;
    if (parsed?.version !== 1 || !isLastWallet(parsed)) {
      removeStoredWallet(storage);
      return null;
    }
    return { connectorId: parsed.connectorId, address: parsed.address };
  } catch {
    removeStoredWallet(storage);
    return null;
  }
}

export function clearLastWallet(
  storage: StorageLike | null = browserLocalStorage(),
): void {
  if (!storage) return;
  removeStoredWallet(storage);
}

function isLastWallet(value: Partial<LastWallet>): value is LastWallet {
  if (
    typeof value.connectorId !== "string" ||
    value.connectorId.length === 0 ||
    value.connectorId.length > MAX_CONNECTOR_ID_LENGTH ||
    typeof value.address !== "string"
  ) {
    return false;
  }
  try {
    return new PublicKey(value.address).toBase58() === value.address;
  } catch {
    return false;
  }
}

function removeStoredWallet(storage: StorageLike): void {
  try {
    storage.removeItem(LAST_WALLET_STORAGE_KEY);
  } catch {
    /* best effort */
  }
}
