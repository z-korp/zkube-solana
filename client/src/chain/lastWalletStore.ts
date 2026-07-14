import { browserLocalStorage, type StorageLike } from "@/platform/browserStorage";

export const LAST_WALLET_STORAGE_KEY = "zkube:last-wallet:v1";

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
  if (!storage) return;
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
    if (
      parsed?.version !== 1 ||
      typeof parsed.connectorId !== "string" ||
      typeof parsed.address !== "string"
    ) {
      return null;
    }
    return { connectorId: parsed.connectorId, address: parsed.address };
  } catch {
    return null;
  }
}

export function clearLastWallet(
  storage: StorageLike | null = browserLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(LAST_WALLET_STORAGE_KEY);
  } catch {
    /* best effort */
  }
}
