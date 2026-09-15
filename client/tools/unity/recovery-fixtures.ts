import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { resolvePersistedRun } from "../../src/backend/solana/runs/resumeRun";
import { saveRunSession } from "../../src/backend/solana/runs/runSessionStore";
import { deriveRunAddresses } from "../../src/backend/solana/pdas";
import { DELEGATION_PROGRAM_ID, ZKUBE_PROGRAM_ID } from "../../src/backend/solana/constants";
import { deriveSessionTokenV2Pda, SESSION_KEYS_PROGRAM_ID, SESSION_TOKEN_V2_DISCRIMINATOR } from "../../src/backend/solana/session/sessionV2";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import type { ActiveRunView } from "../../src/backend/solana/runs/runPlan";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

// Fixed transport snapshots exercise the reference resolver rather than copying
// its decision table into the fixture. Only the public, synthetic keys enter it.
export async function generateRecoveryFixtures(nowUnix: number, ownerKey: Keypair, deviceKey: Keypair) {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const priorNow = Date.now;
  const owner = ownerKey.publicKey, device = deviceKey.publicKey;
  const sessionToken = deriveSessionTokenV2Pda({ authority: owner, sessionSigner: device }).sessionToken;
  const runId = 9007199254740993n;
  const sessionData = Buffer.concat([Buffer.from(SESSION_TOKEN_V2_DISCRIMINATOR), owner.toBuffer(),
    ZKUBE_PROGRAM_ID.toBuffer(), device.toBuffer(), owner.toBuffer(), Buffer.alloc(8)]);
  sessionData.writeBigInt64LE(BigInt(nowUnix + 3600), 136);
  const sessionInfo = { owner: SESSION_KEYS_PROGRAM_ID, executable: false, data: sessionData, lamports: 1000000, rentEpoch: 0 };
  const rows: object[] = [];
  const cases = [
    { id: "no-marker", marker: false },
    { id: "delegated-playing", delegated: true, er: "program", run: "playing" },
    { id: "delegated-vrf", delegated: true, er: "program", run: "awaitingVrf" },
    { id: "er-cloner-lag", delegated: true },
    { id: "router-stale", base: "delegation" },
    { id: "missing-run" },
    { id: "base-prepared", base: "program", run: "prepared" },
    { id: "terminal-copyback", base: "program", run: "finished" },
    { id: "expired-session-keeps-run", delegated: true, er: "program", run: "playing", expired: true },
    { id: "session-skew-59", delegated: true, er: "program", run: "playing", expirySeconds: 59 },
    { id: "session-skew-60", delegated: true, er: "program", run: "playing", expirySeconds: 60 },
    { id: "session-skew-61", delegated: true, er: "program", run: "playing", expirySeconds: 61 },
    { id: "wrong-session-owner-keeps-run", delegated: true, er: "program", run: "playing", invalidSession: true },
    { id: "wrong-er-owner", delegated: true, er: "other" },
    { id: "wrong-base-owner", base: "other" },
    { id: "wrong-run-id", delegated: true, er: "program", run: "playing", wrongRun: true },
    { id: "arcade-slot", delegated: true, er: "program", run: "playing", daily: true },
  ] as const;
  try {
    Date.now = () => nowUnix * 1000;
    for (const definition of cases) {
      const spec: { id: string; marker?: boolean; delegated?: boolean; er?: string; base?: string; run?: string;
        expired?: boolean; expirySeconds?: number; invalidSession?: boolean; wrongRun?: boolean; daily?: boolean } = definition;
      Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: new MemoryStorage() } });
      const mode = "daily";
      const validUntil = nowUnix + (spec.expirySeconds ?? (spec.expired ? 60 : 3600));
      if (spec.marker !== false) saveRunSession({ owner, runId, mode, session: deviceKey, sessionToken,
        addresses: deriveRunAddresses(owner, runId), validUntil, createdAt: nowUnix });
      const info = (kind?: string) => kind == null ? null : { owner: kind === "delegation" ? DELEGATION_PROGRAM_ID
        : kind === "other" ? owner : ZKUBE_PROGRAM_ID, executable: false, data: Buffer.alloc(0), lamports: 1, rentEpoch: 0 };
      const base = { rpcEndpoint: "https://base.invalid/", getAccountInfo: async (address: PublicKey) => address.equals(sessionToken)
        ? { ...sessionInfo, owner: spec.invalidSession ? owner : SESSION_KEYS_PROGRAM_ID } : info(spec.base) } as unknown as Connection;
      const er = { rpcEndpoint: "https://er.invalid/", getAccountInfo: async () => info(spec.er) } as unknown as Connection;
      // Nonterminal projection is supplied only when this case concerns routing;
      // malformed-owner and missing cases invoke the real default account decoder.
      const run = spec.run ? { owner, runId: runId + (spec.wrongRun ? 1n : 0n), mode, lifecycle: spec.run } as ActiveRunView : null;
      let output: object;
      try {
        const result = await resolvePersistedRun({ owner, slot: "arcade",
          wallet: new SessionWallet(ownerKey), baseConnection: base,
          dependencies: { getStatus: async () => ({ isDelegated: spec.delegated ?? false,
            ...(spec.delegated ? { fqdn: er.rpcEndpoint } : {}) }), makeErConnection: () => er,
          ...(run ? { fetchRun: async () => run } : {}) },
        });
        output = { phase: result.phase, sessionAuthorized: "sessionAuthorized" in result ? result.sessionAuthorized : false,
          connection: "connection" in result ? result.connection.rpcEndpoint : null, error: null };
      } catch (cause) { output = { phase: null, error: (cause as Error).message }; }
      rows.push({ ...spec, mode, validUntil, runId: runId.toString(), output });
    }
  } finally {
    Date.now = priorNow;
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
  return rows;
}
