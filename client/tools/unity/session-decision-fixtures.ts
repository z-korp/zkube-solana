import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { projectSolanaSessionState, SESSION_LIFETIME_SECONDS } from "../../src/backend/solana/SolanaIdentitySessionLive";
import { requiredDeviceSignerBalance, validateDeviceSignerFunding } from "../../src/backend/solana/session/deviceSessionFunding";
import { DEVICE_SESSION_READY_SKEW_SECONDS, deviceSessionExpiryDelayMs } from "../../src/backend/solana/session/deviceSessionLifecycle";
import { KREDIT_PACK_SIZES } from "../../src/config/kreditPacks";

export function sessionViewPolicy() {
  // Read the transition from the actual exported projection instead of keeping
  // a second hand-maintained copy of its private expiring threshold.
  let low = DEVICE_SESSION_READY_SKEW_SECONDS + 1, high = SESSION_LIFETIME_SECONDS;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const state = projectSolanaSessionState({ validUntil: middle, nowUnix: 0, floatLamports: 0 });
    if (state.status === "expiring") low = middle; else high = middle - 1;
  }
  return { readyReserveLamports: requiredDeviceSignerBalance(0), expiringSeconds: low, kreditPacks: KREDIT_PACK_SIZES };
}

export function generateSessionDecisionFixtures() {
  const now = 1788912000, rent = 890880;
  const policy = sessionViewPolicy();
  const durations = [-1, 0, 59, 60, 61, policy.expiringSeconds, policy.expiringSeconds + 1, SESSION_LIFETIME_SECONDS];
  const expiry = durations.map(remaining => {
    const validUntil = now + remaining;
    return { remaining, validUntil, now, status: projectSolanaSessionState({ validUntil, nowUnix: now, floatLamports: 0 }).status,
      current: deviceSessionExpiryDelayMs(validUntil, now * 1000) > 0, tokenMayClose: validUntil <= now };
  });
  const funding = [
    { id: "missing", present: false, lamports: 0 },
    { id: "drained", present: true, lamports: 0 },
    { id: "one-short", present: true, lamports: rent + policy.readyReserveLamports - 1 },
    { id: "exact", present: true, lamports: rent + policy.readyReserveLamports },
    { id: "wrong-owner", present: true, lamports: 5000000, owner: new PublicKey(new Uint8Array(32).fill(9)).toBase58() },
    { id: "executable", present: true, lamports: 5000000, executable: true },
    { id: "nonempty", present: true, lamports: 5000000, bytes: 1 },
  ].map(row => {
    const input = { ...row, owner: row.owner ?? SystemProgram.programId.toBase58(), executable: row.executable ?? false, bytes: row.bytes ?? 0, rent };
    try {
      return { ...input, outcome: validateDeviceSignerFunding({ rentFloorLamports: rent, info: row.present ? {
        owner: new PublicKey(input.owner), executable: input.executable, data: Buffer.alloc(input.bytes), lamports: input.lamports, rentEpoch: 0,
      } : null }) };
    } catch { return { ...input, outcome: "invalid" }; }
  });
  const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
  const sources = ["client/src/backend/solana/SolanaIdentitySessionLive.ts", "client/src/backend/solana/session/deviceSessionFunding.ts",
    "client/src/backend/solana/session/deviceSessionLifecycle.ts", "client/src/config/kreditPacks.ts"].map(path => ({ path,
      sha256: createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex") }));
  return { version: 1, sources, policy, expiry, funding };
}

export function generatedSessionViewPolicy() {
  const policy = sessionViewPolicy();
  return `// Generated from TypeScript session and shop policy. Do not edit.\nnamespace ZKube.Integration.Client\n{\n    public static class SessionViewPolicy\n    {\n        public const ulong ReadyReserveLamports = ${policy.readyReserveLamports}UL;\n        public const long ExpiringSeconds = ${policy.expiringSeconds}L;\n        public static System.Collections.Generic.IReadOnlyList<uint> KreditPacks { get; } = System.Array.AsReadOnly(new uint[] { ${policy.kreditPacks.map(value => value + "U").join(", ")} });\n    }\n}\n`;
}
