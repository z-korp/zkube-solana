/** Finite synthetic session evidence. No real wallet, RPC or account writes. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { repositoryRoot } from "./solana-fixtures";
import { buildDeviceSessionRenewalInstructions, inspectSession, projectSolanaSessionState, SESSION_LIFETIME_SECONDS } from "../../src/backend/solana/SolanaIdentitySessionLive";
import { buildDeviceSessionRefillInstructions, buildDeviceSignerReclaimInstruction } from "../../src/backend/solana/session/deviceSessionLifecycle";
import { DEVICE_FEE_ALLOWANCE_LAMPORTS } from "../../src/backend/solana/session/deviceSessionFunding";
import { saveDeviceSession } from "../../src/backend/solana/session/deviceSessionStore";
import { decodeSessionTokenV2Account } from "../../src/backend/solana/session/sessionV2";
import { withPinnedWalletComputeBudget } from "../../src/backend/solana/runs/runPlan";

export const moneySessionFixturePath = process.env.ZKUBE_MONEY_SESSION_FIXTURE_PATH ?? resolve(repositoryRoot, "fixtures/unity-money-session-v1.json");
export const moneySessionDataPath = process.env.ZKUBE_MONEY_SESSION_DATA_PATH ?? resolve(repositoryRoot, "unity/Assets/ZKube/Integration/App/Evidence/MoneySessionEvidenceData.g.cs");
interface Envelope { address: string; owner: string; executable: boolean; data: string; lamports?: number }
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const info = (row: Envelope) => ({ owner: new PublicKey(row.owner), executable: row.executable, data: Buffer.from(row.data, "base64"), lamports: row.lamports ?? 5000000, rentEpoch: 0 });

export async function generateMoneySessionFixtures() {
  const paths = ["fixtures/unity-money-overview-v1.json", "fixtures/unity-session-plans-v1.json", "fixtures/unity-money-readiness-v1.json", "fixtures/unity-rpc-v1.json"];
  const [overview, renewal, readiness, rpc] = paths.map(path => JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")));
  // These are the documented synthetic fixture keys used by the existing TS
  // planner oracles. Their bytes are never obtained from a native wallet.
  const seed = (value: number) => Buffer.alloc(32, value);
  const owner = Keypair.fromSeed(seed(1)), device = Keypair.fromSeed(seed(2)), candidate = Keypair.fromSeed(seed(3));
  const now = renewal.inputs.now as number, rent = readiness.inputs.rent as number;
  if (owner.publicKey.toBase58() !== overview.inputs.owner) throw new Error("Synthetic owner authority drift");
  const ownerCase = overview.scenarios.find((row: { id: string }) => row.id === "owner-overview");
  const ready = readiness.sessionCases.find((row: { variant: string }) => row.variant === "ready");
  const depleted = readiness.sessionCases.find((row: { variant: string }) => row.variant === "one-short");
  const expired = readiness.sessionCases.find((row: { variant: string }) => row.variant === "expired");
  const system = (address: string, lamports: number): Envelope => ({ address, owner: SystemProgram.programId.toBase58(), executable: false, data: "", lamports });
  const decodeToken = (row: Envelope) => decodeSessionTokenV2Account(new PublicKey(row.address), info(row));
  async function inspection(token: Envelope | null, signer: Keypair, balance: number) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window"), storage = new Map<string, string>();
    try {
      Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
        getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
      } } });
      if (token) saveDeviceSession({ owner: owner.publicKey, signer, sessionToken: new PublicKey(token.address), validUntil: decodeToken(token).validUntil, createdAt: now });
      const connection = { getMultipleAccountsInfo: async () => [token ? info(token) : null, info(system(signer.publicKey.toBase58(), balance))],
        getMinimumBalanceForRentExemption: async () => rent } as unknown as Connection;
      const inspected = await inspectSession(connection, owner.publicKey, now);
      if (!inspected) return null;
      const projected = projectSolanaSessionState({ validUntil: inspected.session.validUntil, floatLamports: inspected.balanceLamports, nowUnix: now });
      return { status: projected.status, funding: inspected.funding, balance: inspected.balanceLamports, validUntil: inspected.session.validUntil,
        action: inspected.needsAuthorization ? "renew" : inspected.funding === "ready" ? "ready" : "refill" };
    } finally { if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else Reflect.deleteProperty(globalThis, "window"); }
  }
  const scenarios = [];
  const definitions = [
    { id: "session-enable-success", operation: "enable", row: null, status: "confirmed", failure: false },
    { id: "session-enable-pending-failure", operation: "enable", row: null, status: "processed", failure: true },
    { id: "session-refill-success", operation: "refill", row: depleted, status: "confirmed", failure: false },
    { id: "session-current", operation: "ready", row: ready, status: "confirmed", failure: false },
    { id: "session-disable-pending-success", operation: "disable", row: ready, status: "processed", failure: false },
    { id: "session-disable-zero", operation: "disable", row: { ...ready, balance: 0 }, status: "confirmed", failure: false },
    { id: "session-owner-decline", operation: "enable", row: null, status: "confirmed", failure: false },
    { id: "session-fee-shortage", operation: "enable", row: null, status: "confirmed", failure: false },
    { id: "session-renew-expired", operation: "enable", row: expired, status: "confirmed", failure: false },
  ];
  for (const definition of definitions) {
    const token = definition.row?.token as Envelope | undefined, balance = definition.row?.balance ?? 0;
    const before: Envelope[] = [...ownerCase.baseAccounts, system(owner.publicKey.toBase58(), definition.id === "session-fee-shortage" ? 0 : 2000000000)];
    if (token) before.push(token, system(device.publicKey.toBase58(), balance));
    const connection = { getAccountInfo: async (address: PublicKey) => token && address.toBase58() === token.address ? info(token) : null } as unknown as Connection;
    let instructions: TransactionInstruction[] = [], localSigners: Keypair[] = [];
    if (definition.operation === "enable") {
      const built = await buildDeviceSessionRenewalInstructions({ connection, owner: owner.publicKey, signer: candidate.publicKey,
        validUntil: now + SESSION_LIFETIME_SECONDS, nowUnix: now, previous: token ? { sessionToken: new PublicKey(token.address), signer: device.publicKey, validUntil: decodeToken(token).validUntil, balanceLamports: balance } : null });
      instructions = built.instructions; localSigners = [candidate, ...(built.previousSignerRequired ? [device] : [])];
    } else if (definition.operation === "refill") {
      instructions = buildDeviceSessionRefillInstructions({ owner: owner.publicKey, signer: device.publicKey, balanceLamports: balance }).instructions;
      localSigners = [device];
    } else if (definition.operation === "disable") {
      const reclaim = buildDeviceSignerReclaimInstruction({ owner: owner.publicKey, signer: device.publicKey, balanceLamports: balance });
      instructions = reclaim ? [reclaim] : []; localSigners = reclaim ? [device] : [];
    }
    let transaction = null;
    if (instructions.length) {
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: renewal.inputs.blockhash,
        instructions: withPinnedWalletComputeBudget(instructions) }).compileToV0Message());
      tx.sign(localSigners); const partial = Buffer.from(tx.serialize()).toString("base64");
      tx.sign([owner]);
      transaction = { message: Buffer.from(tx.message.serialize()).toString("base64"), partial, signed: Buffer.from(tx.serialize()).toString("base64"),
        signatureBytes: Buffer.from(tx.signatures[0]!).toString("base64") };
    }
    const after = new Map(before.map(row => [row.address, row]));
    let afterToken = token ?? null, afterSigner = device, afterBalance = balance;
    if (definition.operation === "enable") {
      afterToken = renewal.candidateToken as Envelope; afterSigner = candidate; afterBalance = DEVICE_FEE_ALLOWANCE_LAMPORTS;
      after.set(afterToken.address, afterToken); after.set(candidate.publicKey.toBase58(), system(candidate.publicKey.toBase58(), afterBalance));
      if (token) { after.delete(device.publicKey.toBase58()); if (decodeToken(token).validUntil <= now) after.delete(token.address); }
    } else if (definition.operation === "refill") {
      afterBalance = DEVICE_FEE_ALLOWANCE_LAMPORTS; after.set(device.publicKey.toBase58(), system(device.publicKey.toBase58(), afterBalance));
    } else if (definition.operation === "disable") {
      after.delete(device.publicKey.toBase58()); afterToken = null; afterBalance = 0;
    }
    const allowed = definition.id !== "session-owner-decline" && definition.id !== "session-fee-shortage" && !definition.failure;
    const acceptedToken = allowed ? afterToken : token ?? null, acceptedSigner = allowed ? afterSigner : device;
    scenarios.push({ ...definition, row: undefined, label: "Offline synthetic session · " + definition.id,
      before, after: [...after.values()], erAccounts: ownerCase.erAccounts,
      active: token ? { signer: device.publicKey.toBase58(), token: token.address, validUntil: decodeToken(token).validUntil } : null,
      transaction, ownerDeclines: definition.id === "session-owner-decline",
      expectedActive: acceptedToken ? { signer: acceptedSigner.publicKey.toBase58(), token: acceptedToken.address, validUntil: decodeToken(acceptedToken).validUntil } : null,
      expectedBefore: await inspection(token ?? null, device, balance),
      expectedAfter: allowed ? await inspection(afterToken, afterSigner, afterBalance) : await inspection(token ?? null, device, balance) });
  }
  const references = [...paths, "client/src/backend/solana/SolanaIdentitySessionLive.ts", "client/src/backend/solana/session/deviceSessionLifecycle.ts",
    "client/src/backend/solana/session/deviceSessionFunding.ts", "client/src/backend/solana/runs/runPlan.ts"];
  const result = (id: string) => rpc.cases.find((row: { id: string }) => row.id === id).result;
  const body = { schemaVersion: 1, evidenceClass: "offline-synthetic-money-session", inputs: { ...overview.inputs,
    now, blockhash: result("base-blockhash"), fee: result("base-fee"), rent, ownerSeed: seed(1).toString("base64"),
    deviceSeed: seed(2).toString("base64"), candidateSeed: seed(3).toString("base64"), candidate: candidate.publicKey.toBase58(),
    simulation: result("simulation-ok") }, scenarios,
    provenance: [...references.map(path => ({ path, sha256: hash(readFileSync(resolve(repositoryRoot, path))) })),
      { path: "client/tools/unity/money-session-fixtures.ts", sha256: hash(readFileSync(new URL(import.meta.url))) }] };
  return { ...body, sourceSha256: hash(JSON.stringify(body)) };
}
export function generatedMoneySessionData(value: Awaited<ReturnType<typeof generateMoneySessionFixtures>>) {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64");
  return "// Generated synthetic evidence only. Never include in production or Store.\n#if (UNITY_EDITOR || ZKUBE_EVIDENCE) && !ZKUBE_STORE\nnamespace ZKube.Integration.App.Evidence\n{\n    internal static class MoneySessionEvidenceData\n    {\n        internal static string Json => System.Text.Encoding.UTF8.GetString(System.Convert.FromBase64String(\"" + encoded + "\"));\n    }\n}\n#endif\n";
}
