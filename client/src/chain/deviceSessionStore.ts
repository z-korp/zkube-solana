import { Keypair, PublicKey } from "@solana/web3.js";

import { browserLocalStorage, type StorageLike } from "@/platform/browserStorage";
import { deriveSessionTokenV2Pda } from "./sessionV2";

const DEVICE_SESSION_STORAGE_KEY = "zkube:device-sessions:v1";

interface StoredDeviceSession {
  version: 1;
  owner: string;
  secretKey: number[];
  sessionToken: string;
  validUntil: number;
  createdAt: number;
}

export interface DeviceSession {
  owner: PublicKey;
  signer: Keypair;
  sessionToken: PublicKey;
  validUntil: number;
  createdAt: number;
}

export function assertDeviceSessionStorageAvailable(): void {
  if (!browserLocalStorage()) {
    throw new Error(
      "Browser storage is unavailable; zKube cannot persist a device session.",
    );
  }
}

export function requireCurrentDeviceSession(
  session: DeviceSession,
  connectedOwner: PublicKey,
  nowUnix = Math.floor(Date.now() / 1_000),
  readySkewSeconds = 60,
): DeviceSession {
  if (!session.owner.equals(connectedOwner)) {
    throw new Error("The connected wallet account changed");
  }
  if (session.validUntil - nowUnix <= readySkewSeconds) {
    throw new Error("The zKube device session expired. Renew it before continuing.");
  }
  return session;
}

export function saveDeviceSession(
  session: DeviceSession,
  storage = browserLocalStorage(),
): void {
  if (!storage) {
    throw new Error(
      "Browser storage is unavailable; zKube cannot persist a device session.",
    );
  }
  const all = loadAll(storage);
  all[session.owner.toBase58()] = {
    version: 1,
    owner: session.owner.toBase58(),
    secretKey: Array.from(session.signer.secretKey),
    sessionToken: session.sessionToken.toBase58(),
    validUntil: session.validUntil,
    createdAt: session.createdAt,
  };
  storage.setItem(DEVICE_SESSION_STORAGE_KEY, JSON.stringify(all));
}

export function loadDeviceSession(
  owner: PublicKey,
  storage = browserLocalStorage(),
): DeviceSession | null {
  if (!storage) return null;
  const stored = loadAll(storage)[owner.toBase58()];
  if (!stored || !isStoredDeviceSession(stored)) return null;
  try {
    const signer = Keypair.fromSecretKey(Uint8Array.from(stored.secretKey));
    const expected = deriveSessionTokenV2Pda({
      authority: owner,
      sessionSigner: signer.publicKey,
    }).sessionToken;
    if (
      stored.owner !== owner.toBase58() ||
      stored.sessionToken !== expected.toBase58()
    ) {
      return null;
    }
    return {
      owner,
      signer,
      sessionToken: expected,
      validUntil: stored.validUntil,
      createdAt: stored.createdAt,
    };
  } catch {
    return null;
  }
}

export function clearDeviceSession(
  owner: PublicKey,
  storage = browserLocalStorage(),
): void {
  if (!storage) return;
  const all = loadAll(storage);
  delete all[owner.toBase58()];
  try {
    if (Object.keys(all).length === 0) {
      storage.removeItem(DEVICE_SESSION_STORAGE_KEY);
    } else {
      storage.setItem(DEVICE_SESSION_STORAGE_KEY, JSON.stringify(all));
    }
  } catch {
    // Connection state still fails closed when browser storage is unavailable.
  }
}

function loadAll(storage: StorageLike): Record<string, StoredDeviceSession> {
  try {
    const raw = storage.getItem(DEVICE_SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, StoredDeviceSession>)
      : {};
  } catch {
    return {};
  }
}

function isStoredDeviceSession(value: unknown): value is StoredDeviceSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<StoredDeviceSession>;
  return (
    record.version === 1 &&
    typeof record.owner === "string" &&
    typeof record.sessionToken === "string" &&
    Array.isArray(record.secretKey) &&
    record.secretKey.length === 64 &&
    record.secretKey.every(
      (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
    ) &&
    Number.isInteger(record.validUntil) &&
    Number.isInteger(record.createdAt)
  );
}
