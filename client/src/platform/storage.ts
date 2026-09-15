import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  setItemDurable?(key: string, value: string): Promise<void>;
  removeItem(key: string): void;
}

const nativeValues = new Map<string, string>();
let nativeInitialized = false;
let nativeWriteQueue = Promise.resolve();

const nativeStorage: StorageLike = {
  getItem: (key) => nativeValues.get(key) ?? null,
  setItemDurable: (key, value) => {
    const written = nativeWriteQueue.then(async () => {
      await Preferences.set({ key, value });
      nativeValues.set(key, value);
    });
    nativeWriteQueue = written.catch(reportPersistenceFailure);
    return written;
  },
  setItem: (key, value) => {
    nativeValues.set(key, value);
    nativeWriteQueue = nativeWriteQueue
      .then(() => Preferences.set({ key, value }))
      .catch(reportPersistenceFailure);
  },
  removeItem: (key) => {
    nativeValues.delete(key);
    nativeWriteQueue = nativeWriteQueue
      .then(() => Preferences.remove({ key }))
      .catch(reportPersistenceFailure);
  },
};

/** Hydrates the synchronous app cache before any UI module is evaluated. */
export async function initializeStorage(): Promise<void> {
  if (!Capacitor.isNativePlatform() || nativeInitialized) return;
  const { keys } = await Preferences.keys();
  const values = await Promise.all(
    keys.map(async (key) => [key, (await Preferences.get({ key })).value] as const),
  );
  nativeValues.clear();
  for (const [key, value] of values) {
    if (value !== null) nativeValues.set(key, value);
  }
  nativeInitialized = true;
}

/** One storage boundary: native Preferences, with browser storage as fallback. */
export function appStorage(): StorageLike | null {
  if (Capacitor.isNativePlatform()) return nativeStorage;
  try {
    if (typeof window === "undefined") return null;
    const probe = "__zkube_storage_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function reportPersistenceFailure(cause: unknown): void {
  console.error("zKube storage persistence failed", cause);
}
