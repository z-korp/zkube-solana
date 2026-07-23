import { Keypair, PublicKey } from "@solana/web3.js";
import {
  browserLocalStorage,
  type StorageLike,
} from "../platform/browserStorage.js";
import { deriveRunAddresses, type RunAddresses } from "./pdas.js";
import { deriveSessionTokenV2Pda } from "./sessionV2.js";

export const RUN_SESSION_STORAGE_KEY = "zkube:run-sessions:v2";
const RUN_SESSION_REFRESH_SKEW_SECONDS = 60;

interface StoredRunSession {
  version: 2;
  owner: string;
  runId: string;
  mode: RunSessionMode;
  sessionSecretKey: number[];
  sessionToken: string;
  activeRun: string;
  validUntil: number;
  createdAt: number;
}

export interface RunSessionMarker {
  owner: PublicKey;
  runId: bigint;
  mode: RunSessionMode;
  session: Keypair;
  sessionToken: PublicKey;
  addresses: RunAddresses;
  validUntil: number;
  createdAt: number;
}

export type RunSessionMode = "campaign" | "daily" | "practice";
export type RunSlot = "campaign" | "arcade";

export function runSlotForMode(mode: RunSessionMode): RunSlot {
  return mode === "campaign" ? "campaign" : "arcade";
}

function sessionKey(owner: PublicKey, slot: RunSlot): string {
  return `${owner.toBase58()}:${slot}`;
}

export function saveRunSession(
  marker: RunSessionMarker,
  storage = browserLocalStorage(),
): void {
  if (!storage) return;
  const sessions = loadStoredSessions(storage);
  sessions[sessionKey(marker.owner, runSlotForMode(marker.mode))] = {
    version: 2,
    owner: marker.owner.toBase58(),
    runId: marker.runId.toString(),
    mode: marker.mode,
    sessionSecretKey: Array.from(marker.session.secretKey),
    sessionToken: marker.sessionToken.toBase58(),
    activeRun: marker.addresses.activeRun.toBase58(),
    validUntil: marker.validUntil,
    createdAt: marker.createdAt,
  };
  try {
    storage.setItem(RUN_SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Private-mode/quota failures only disable refresh recovery.
  }
}

export function loadRunSession(
  owner: PublicKey,
  slot: RunSlot,
  options: { storage?: StorageLike | null } = {},
): RunSessionMarker | null {
  const storage =
    options.storage === undefined ? browserLocalStorage() : options.storage;
  if (!storage) return null;
  const sessions = loadStoredSessions(storage);
  const key = sessionKey(owner, slot);
  const stored = sessions[key] ?? sessions[owner.toBase58()];
  if (!stored) return null;
  const marker = restoreStoredRunSession(stored, owner);
  if (!marker || runSlotForMode(marker.mode) !== slot) {
    clearRunSession(owner, slot, storage);
    return null;
  }
  // Move the legacy single-owner entry into its explicit slot on first read.
  if (!sessions[key]) {
    sessions[key] = stored;
    delete sessions[owner.toBase58()];
    try {
      storage.setItem(RUN_SESSION_STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      // Recovery still succeeds even if storage migration is unavailable.
    }
  }
  return marker;
}

export function isRunSessionFresh(
  marker: Pick<RunSessionMarker, "validUntil">,
  nowUnix = Math.floor(Date.now() / 1_000),
): boolean {
  return marker.validUntil - nowUnix > RUN_SESSION_REFRESH_SKEW_SECONDS;
}

export function clearRunSession(
  owner: PublicKey,
  slot?: RunSlot,
  storage = browserLocalStorage(),
): void {
  if (!storage) return;
  const sessions = loadStoredSessions(storage);
  delete sessions[owner.toBase58()];
  if (slot) delete sessions[sessionKey(owner, slot)];
  else {
    delete sessions[sessionKey(owner, "campaign")];
    delete sessions[sessionKey(owner, "arcade")];
  }
  try {
    if (Object.keys(sessions).length === 0)
      storage.removeItem(RUN_SESSION_STORAGE_KEY);
    else storage.setItem(RUN_SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // The marker is already unusable when storage itself is unavailable.
  }
}

function restoreStoredRunSession(
  stored: StoredRunSession,
  owner: PublicKey,
): RunSessionMarker | null {
  // Expiry invalidates the session authorization, not the marker. The marker
  // remains the durable run locator needed to attach a renewed device session
  // or finish cleanup after a long absence.
  if (stored.owner !== owner.toBase58()) return null;
  try {
    const runId = BigInt(stored.runId);
    if (runId <= 0n) return null;
    const session = Keypair.fromSecretKey(
      Uint8Array.from(stored.sessionSecretKey),
    );
    const expectedSessionToken = deriveSessionTokenV2Pda({
      authority: owner,
      sessionSigner: session.publicKey,
    }).sessionToken;
    const addresses = deriveRunAddresses(owner, runId);
    if (
      !expectedSessionToken.equals(new PublicKey(stored.sessionToken)) ||
      !addresses.activeRun.equals(new PublicKey(stored.activeRun))
    )
      return null;
    return {
      owner,
      runId,
      mode: stored.mode,
      session,
      sessionToken: expectedSessionToken,
      addresses,
      validUntil: stored.validUntil,
      createdAt: stored.createdAt,
    };
  } catch {
    return null;
  }
}

function loadStoredSessions(
  storage: StorageLike,
): Record<string, StoredRunSession> {
  try {
    const raw = storage.getItem(RUN_SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return {};
    const sessions: Record<string, StoredRunSession> = {};
    for (const [owner, value] of Object.entries(parsed)) {
      if (isStoredRunSession(value)) sessions[owner] = value;
    }
    return sessions;
  } catch {
    return {};
  }
}

function isStoredRunSession(value: unknown): value is StoredRunSession {
  return (
    isRecord(value) &&
    value.version === 2 &&
    typeof value.owner === "string" &&
    typeof value.runId === "string" &&
    (value.mode === "campaign" ||
      value.mode === "daily" ||
      value.mode === "practice") &&
    validSecretKey(value.sessionSecretKey) &&
    typeof value.sessionToken === "string" &&
    typeof value.activeRun === "string" &&
    Number.isInteger(value.validUntil) &&
    Number.isInteger(value.createdAt)
  );
}

function validSecretKey(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === 64 &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
