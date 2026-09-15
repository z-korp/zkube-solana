import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Keypair, Transaction, PublicKey, VersionedTransaction, VersionedMessage, type Connection } from "@solana/web3.js";
import { BorshAccountsCoder } from "@anchor-lang/core";
import BN from "bn.js";
import { generateAccountFixtures } from "./account-fixtures";
import { hasAcceptedRunAction, isAcceptedRunActionReady, hasResolvedRunVrf } from "../../src/backend/solana/runs/runObservation";
import { decodeActiveRunAccount, buildRequestRerollPlan, buildRequestRowPlan, buildFinishRunPlan, buildCommitRunPlan, buildConsumeRunRecoveryPlan } from "../../src/backend/solana/runs/runPlan";
import { ZKUBE_PROGRAM_ID } from "../../src/backend/solana/constants";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import { deriveSessionTokenV2Pda } from "../../src/backend/solana/session/sessionV2";
import { deriveRunAddresses } from "../../src/backend/solana/pdas";
import { generatePlannerFixtures } from "./planner-fixtures";
import { IDL } from "../../src/backend/solana/idl";
import { resolvePersistedRun } from "../../src/backend/solana/runs/resumeRun";
import { saveRunSession } from "../../src/backend/solana/runs/runSessionStore";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const runReconciliationFixturePath = resolve(repositoryRoot, "fixtures/unity-run-reconciliation-v1.json");

interface AccountFixture {
  id: string; kind: string; address: string; owner: string; executable: boolean; data: string;
  expectedAuthority?: string; nativeError?: string;
}

export async function generateRunReconciliationFixtures() {
    const ownerKey = Keypair.fromSeed(new Uint8Array(32).fill(1)), deviceKey = Keypair.fromSeed(new Uint8Array(32).fill(2));
    const accounts = await generateAccountFixtures(ownerKey, deviceKey, 1789257600, true) as AccountFixture[];
    const cases = accounts.filter((value) => value.kind === "ActiveRun" && !value.nativeError).map((value) => {
      const run = decodeActiveRunAccount(Buffer.from(value.data, "base64"), ZKUBE_PROGRAM_ID);
      return { ...value, action: [0, 1, 2].map(expected => ({ expected,
        accepted: hasAcceptedRunAction(run, expected), ready: isAcceptedRunActionReady(run, expected) })),
      vrf: [0, 1, 2, 3].map(counter => ({ counter, resolved: hasResolvedRunVrf(run, counter) })) };
    });
    const owner = ownerKey.publicKey, device = deviceKey.publicKey, runId = 9007199254740993n;
    const addresses = deriveRunAddresses(owner, runId), wallet = new SessionWallet(deviceKey);
    const sessionToken = deriveSessionTokenV2Pda({ authority: owner, sessionSigner: device }).sessionToken;
    const blockhash = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
    const transactions = [];
    for (const mode of ["daily"] as const) {
      const finished = cases.find((value) => value.id === `active-${mode}-finished`)!;
      const connection = { rpcEndpoint: "https://er.invalid/", getAccountInfoAndContext: async () => ({ context: { slot: 100 }, value: {
        owner: ZKUBE_PROGRAM_ID, executable: false, lamports: 1, data: Buffer.from(finished.data, "base64"), rentEpoch: 0 } }) } as unknown as Connection;
      const context = { owner, sessionWallet: wallet, sessionToken, activeRun: addresses.activeRun, erConnection: connection, clientSeed: new Uint8Array(32).fill(7) };
      const plans = [
        ["reroll", await buildRequestRerollPlan({ ...context, expectedAction: 0 })],
        ["vrf", await buildRequestRowPlan(context)],
        ["finish", await buildFinishRunPlan({ ...context, signerWallet: wallet })],
        ["commit", await buildCommitRunPlan({ owner, payerWallet: wallet, addresses, erConnection: connection })],
        ["consume", await buildConsumeRunRecoveryPlan({ wallet, owner, runId, addresses, mode, dailyChallenge: PublicKey.default, connection })],
      ] as const;
      for (const [action, plan] of plans) {
        const tx = new Transaction({ feePayer: device, recentBlockhash: blockhash }).add(...plan.transaction.instructions);
        tx.sign(deviceKey);
        transactions.push({ id: `${mode}-${action}`, mode, action, owner: owner.toBase58(), blockhash,
          bytes: tx.serialize().toString("base64") });
      }
    }
    const planner = await generatePlannerFixtures();
    const plannerPlans = planner.plans as Array<{ id: string; expected: { message: string } }>;
    for (const id of ["daily-no-claims", "daily-prepare-delegate", "delegate"]) {
      const plan = plannerPlans.find(value => value.id === id)!;
      const tx = new VersionedTransaction(VersionedMessage.deserialize(Buffer.from(plan.expected.message, "base64")));
      tx.sign([ownerKey, deviceKey].filter(key => tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).some(address => address.equals(key.publicKey))));
      transactions.push({ id, mode: "daily", action: id.replace(/^daily-/, ""), owner: owner.toBase58(),
        blockhash: tx.message.recentBlockhash, bytes: Buffer.from(tx.serialize()).toString("base64") });
    }
    const player = accounts.find((value) => value.kind === "PlayerState" && value.id.endsWith("valid"))!;
    const coder = new BorshAccountsCoder(IDL);
    const preparedPlayers: Record<string, object> = {};
    for (const mode of ["daily"] as const) {
      const fields = coder.decode("PlayerState", Buffer.from(player.data, "base64"));
      fields["active_run_id"] = new BN(runId.toString());
      const bytes = Buffer.alloc(coder.size("PlayerState")); (await coder.encode("PlayerState", fields)).copy(bytes);
      preparedPlayers[mode] = { ...player, data: bytes.toString("base64") };
    }
    const consumedFields = coder.decode("PlayerState", Buffer.from(player.data, "base64"));
    consumedFields.active_run_id = new BN(0);
    const consumedBytes = Buffer.alloc(coder.size("PlayerState")); (await coder.encode("PlayerState", consumedFields)).copy(consumedBytes);
    const consumedPlayer = { ...player, data: consumedBytes.toString("base64") };
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const previousNow = Date.now;
    const routing = [];
    try {
      Date.now = () => 1789257600000;
      for (const row of cases) {
        for (const delegated of [false, true]) {
          const storage = new Map<string, string>();
          Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
            getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key) } } });
          const mode = "daily";
          saveRunSession({ owner, runId, mode, session: deviceKey, sessionToken, addresses, validUntil: 1789261200, createdAt: 1789257600 });
          const info = { owner: ZKUBE_PROGRAM_ID, executable: false, data: Buffer.from(row.data, "base64"), lamports: 1, rentEpoch: 0 };
          const er = { rpcEndpoint: "https://new-er.invalid/", getAccountInfo: async () => info } as unknown as Connection;
          const base = { rpcEndpoint: "https://base.invalid/", getAccountInfo: async (address: PublicKey) => address.equals(sessionToken) ? null : info } as unknown as Connection;
          const resolution = await resolvePersistedRun({ owner, slot: "arcade", wallet: new SessionWallet(ownerKey), baseConnection: base,
            dependencies: { getStatus: async () => ({ isDelegated: delegated, ...(delegated ? { fqdn: er.rpcEndpoint } : {}) }), makeErConnection: () => er } });
          routing.push({ id: row.id, delegated, phase: resolution.phase, endpoint: "connection" in resolution ? resolution.connection.rpcEndpoint : null });
        }
      }
    } finally {
      Date.now = previousNow;
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
    }
    const paths = ["client/tools/unity/run-reconciliation-fixtures.ts", "client/tools/unity/account-fixtures.ts",
      "client/tools/unity/planner-fixtures.ts", "client/src/backend/solana/runs/runObservation.ts",
      "client/src/backend/solana/runs/SolanaRunsLive.ts", "client/src/backend/solana/runs/resumeRun.ts",
      "client/src/backend/solana/runs/runPlan.ts", "client/src/backend/solana/idl/solana.json"];
    return { schemaVersion: 1, provenance: Object.fromEntries(paths.map(path => [path,
      createHash("sha256").update(readFileSync(resolve(repositoryRoot, path))).digest("hex")])),
      cases, transactions, player, preparedPlayers, consumedPlayer, routing };
}
