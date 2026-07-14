import { Keypair, PublicKey } from "@solana/web3.js";
import { deriveRunAddresses, type RunAddresses } from "./pdas.js";
import { deriveSessionTokenV2Pda } from "./sessionV2.js";

export const RUN_SESSION_STORAGE_KEY = "zkube:run-sessions:v1";
export const RUN_SESSION_REFRESH_SKEW_SECONDS = 60;
export const REUSABLE_SESSION_STORAGE_KEY = "zkube:session:v1";
/** Reuse a session only when a whole run comfortably fits inside its
 *  remaining validity; below this, mint a fresh one at run start. */
export const REUSABLE_SESSION_MIN_REMAINING_SECONDS = 60 * 60;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredRunSession {
  version: 1;
  owner: string;
  runId: string;
  mode: "campaign" | "daily";
  dailyVersion?: 1 | 2;
  sessionSecretKey: number[];
  sessionToken: string;
  activeRun: string;
  runShell: string;
  runReceipt: string;
  validUntil: number;
  createdAt: number;
}

export interface RunSessionMarker {
  owner: PublicKey;
  runId: bigint;
  mode: "campaign" | "daily";
  dailyVersion?: 1 | 2;
  session: Keypair;
  sessionToken: PublicKey;
  addresses: RunAddresses;
  validUntil: number;
  createdAt: number;
}

export function saveRunSession(
  marker: RunSessionMarker,
  storage = browserStorage(),
): void {
  if (!storage) return;
  const sessions = loadStoredSessions(storage);
  sessions[marker.owner.toBase58()] = {
    version: 1,
    owner: marker.owner.toBase58(),
    runId: marker.runId.toString(),
    mode: marker.mode,
    dailyVersion: marker.dailyVersion,
    sessionSecretKey: Array.from(marker.session.secretKey),
    sessionToken: marker.sessionToken.toBase58(),
    activeRun: marker.addresses.activeRun.toBase58(),
    runShell: marker.addresses.runShell.toBase58(),
    runReceipt: marker.addresses.runReceipt.toBase58(),
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
  options: { storage?: StorageLike | null } = {},
): RunSessionMarker | null {
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  if (!storage) return null;
  const sessions = loadStoredSessions(storage);
  const stored = sessions[owner.toBase58()];
  if (!stored) return null;
  const marker = restoreStoredRunSession(stored, owner);
  if (!marker) clearRunSession(owner, storage);
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
  storage = browserStorage(),
): void {
  if (!storage) return;
  const sessions = loadStoredSessions(storage);
  delete sessions[owner.toBase58()];
  try {
    if (Object.keys(sessions).length === 0)
      storage.removeItem(RUN_SESSION_STORAGE_KEY);
    else storage.setItem(RUN_SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // The marker is already unusable when storage itself is unavailable.
  }
}

interface StoredReusableSession {
  version: 1;
  owner: string;
  sessionSecretKey: number[];
  validUntil: number;
  createdAt: number;
}

export interface ReusableSession {
  session: Keypair;
  validUntil: number;
}

/**
 * The session identity outlives individual runs (run markers are cleared at
 * settlement): one SessionTokenV2 serves every run inside its validity, so a
 * new run costs no session-token rent. Keyed per owner, separate from the
 * per-run marker store.
 */
export function saveReusableSession(
  owner: PublicKey,
  session: Keypair,
  validUntil: number,
  storage = browserStorage(),
): void {
  if (!storage) return;
  const sessions = loadStoredReusableSessions(storage);
  sessions[owner.toBase58()] = {
    version: 1,
    owner: owner.toBase58(),
    sessionSecretKey: Array.from(session.secretKey),
    validUntil,
    createdAt: Math.floor(Date.now() / 1_000),
  };
  try {
    storage.setItem(REUSABLE_SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Losing reuse only costs one session-token rent on the next run.
  }
}

export function loadReusableSession(
  owner: PublicKey,
  options: {
    storage?: StorageLike | null;
    nowUnix?: number;
    minRemainingSeconds?: number;
  } = {},
): ReusableSession | null {
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  if (!storage) return null;
  const stored = loadStoredReusableSessions(storage)[owner.toBase58()];
  if (!stored || stored.owner !== owner.toBase58()) return null;
  if (
    !Array.isArray(stored.sessionSecretKey) ||
    stored.sessionSecretKey.length !== 64 ||
    !Number.isFinite(stored.validUntil)
  ) {
    return null;
  }
  const nowUnix = options.nowUnix ?? Math.floor(Date.now() / 1_000);
  const minRemaining =
    options.minRemainingSeconds ?? REUSABLE_SESSION_MIN_REMAINING_SECONDS;
  if (stored.validUntil - nowUnix <= minRemaining) return null;
  try {
    return {
      session: Keypair.fromSecretKey(Uint8Array.from(stored.sessionSecretKey)),
      validUntil: stored.validUntil,
    };
  } catch {
    return null;
  }
}

function loadStoredReusableSessions(
  storage: StorageLike,
): Record<string, StoredReusableSession> {
  try {
    const raw = storage.getItem(REUSABLE_SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, StoredReusableSession>;
  } catch {
    return {};
  }
}

function restoreStoredRunSession(
  stored: StoredRunSession,
  owner: PublicKey,
): RunSessionMarker | null {
  // Expiry invalidates the session authorization, not the marker. The marker
  // remains the durable run locator needed to rotate an expired token or
  // finish cleanup after a long absence.
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
      !addresses.activeRun.equals(new PublicKey(stored.activeRun)) ||
      !addresses.runShell.equals(new PublicKey(stored.runShell)) ||
      !addresses.runReceipt.equals(new PublicKey(stored.runReceipt))
    )
      return null;
    return {
      owner,
      runId,
      mode: stored.mode,
      dailyVersion: stored.dailyVersion === 2 ? 2 : 1,
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
    value.version === 1 &&
    typeof value.owner === "string" &&
    typeof value.runId === "string" &&
    (value.mode === "campaign" || value.mode === "daily") &&
    (value.dailyVersion === undefined || value.dailyVersion === 1 || value.dailyVersion === 2) &&
    validSecretKey(value.sessionSecretKey) &&
    typeof value.sessionToken === "string" &&
    typeof value.activeRun === "string" &&
    typeof value.runShell === "string" &&
    typeof value.runReceipt === "string" &&
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

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
