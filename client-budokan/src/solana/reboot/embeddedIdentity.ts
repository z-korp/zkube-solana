import { Keypair } from "@solana/web3.js";

export const IDENTITY_STORAGE_KEY = "zkube:embedded-identity:v1";

interface IdentityRecord {
  version: 1;
  secretKey: number[];
  createdAt: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memoryFallback = new Map<string, string>();

function identityStorage(): StorageLike {
  try {
    const probe = "__zkube_identity_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return {
      getItem: (key) => memoryFallback.get(key) ?? null,
      setItem: (key, value) => void memoryFallback.set(key, value),
      removeItem: (key) => void memoryFallback.delete(key),
    };
  }
}

function loadIdentityRecord(): IdentityRecord | null {
  try {
    const raw = identityStorage().getItem(IDENTITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IdentityRecord;
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.secretKey) ||
      parsed.secretKey.length !== 64 ||
      parsed.secretKey.some(
        (byte) => !Number.isInteger(byte) || byte < 0 || byte > 255,
      )
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveIdentity(keypair: Keypair): void {
  identityStorage().setItem(
    IDENTITY_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      secretKey: Array.from(keypair.secretKey),
      createdAt: Date.now(),
    } satisfies IdentityRecord),
  );
}

export function loadOrCreateEmbeddedIdentity(): Keypair {
  const record = loadIdentityRecord();
  if (record) return Keypair.fromSecretKey(Uint8Array.from(record.secretKey));
  const keypair = Keypair.generate();
  saveIdentity(keypair);
  return keypair;
}

export function exportRecoveryCode(keypair: Keypair): string {
  const hex = Array.from(keypair.secretKey)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hex.match(/.{1,4}/g)?.join("-") ?? hex;
}

export function importRecoveryCode(code: string): Keypair {
  const hex = code.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 128) {
    throw new Error("The recovery code must contain all 32 groups");
  }
  const pairs = hex.match(/.{2}/g);
  if (!pairs) throw new Error("The recovery code is invalid");
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16))),
  );
  saveIdentity(keypair);
  return keypair;
}

export function deleteEmbeddedIdentity(): void {
  identityStorage().removeItem(IDENTITY_STORAGE_KEY);
}
