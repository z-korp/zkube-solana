import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { getClosestValidator, getDelegationStatus, waitForDelegation } from "../../src/backend/solana/runs/router";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "../../src/backend/solana/constants";
import { WALLET_SEND_OPTIONS, WALLET_SIMULATION_OPTIONS } from "../../src/backend/solana/runs/runPlan";
import { ER_SEND_OPTIONS } from "../../src/backend/solana/runs/erTransport";
import { canonicalJson, repositoryRoot } from "./solana-fixtures";

export const rpcFixturePath = resolve(repositoryRoot, "fixtures/unity-rpc-v1.json");

export async function generateRpcFixtures() {
  const solana = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/unity-solana-v1.json"), "utf8"));
  const transaction = VersionedTransaction.deserialize(Buffer.from(solana.walletCases.find((row: { id: string }) => row.id === "valid").output, "base64"));
  const signature = bs58.encode(transaction.signatures[0]);
  const base = "https://base.zkube.invalid/", router = "https://router.zkube.invalid/", er = "https://er.zkube.invalid/";
  const owner = new PublicKey(solana.inputs.owner), address = owner.toBase58();
  const account = { executable: false, owner: ZKUBE_PROGRAM_ID.toBase58(), lamports: 9007199254740993n.toString(), rentEpoch: 0,
    data: [Buffer.from([1, 2, 3]).toString("base64"), "base64"] };
  // web3.js uses JS numbers at this boundary; exact integer preservation above
  // its safe range is a separate managed adversarial test, not an oracle claim.
  const safeAccount = { ...account, lamports: 5000000 };
  const context = { slot: 123 };
  const cases: object[] = [];
  type Request = { method: string; params: unknown[] };
  let requests: Array<Request & { endpoint: string }> = [];
  let responseResult: unknown;
  const fetcher: typeof fetch = async (input, init) => {
    const request = JSON.parse(String(init?.body)) as { id: number | string } & Request;
    requests.push({ endpoint: String(input), method: request.method, params: request.params });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: responseResult }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const connection = (endpoint: string) => new Connection(endpoint, { commitment: "confirmed", fetch: fetcher, disableRetryOnRateLimit: true });
  const baseConnection = connection(base), erConnection = connection(er);
  async function capture(id: string, input: object, result: unknown, run: () => Promise<unknown>) {
    requests = []; responseResult = result;
    const output = await run();
    cases.push({ id, input, result, requests, output });
  }
  await capture("genesis", { operation: "genesis" }, SOLANA_DEVNET_GENESIS_HASH, () => baseConnection.getGenesisHash());
  for (const [route, conn] of [["base", baseConnection], ["er", erConnection]] as const) {
    await capture(`${route}-blockhash`, { operation: "blockhash", route }, { context, value: { blockhash: transaction.message.recentBlockhash, lastValidBlockHeight: 987 } }, () => conn.getLatestBlockhash("confirmed"));
    await capture(`${route}-fee`, { operation: "fee", route }, { context, value: 5000 }, async () => (await conn.getFeeForMessage(transaction.message, "confirmed")).value);
    await capture(`${route}-balance`, { operation: "balance", route, address }, { context, value: 5000000 }, () => conn.getBalance(owner, "confirmed"));
    await capture(`${route}-rent`, { operation: "rent", route, bytes: 0 }, 890880, () => conn.getMinimumBalanceForRentExemption(0, "confirmed"));
    await capture(`${route}-height`, { operation: "height", route }, 900, () => conn.getBlockHeight("confirmed"));
  }
  await capture("account", { operation: "account", route: "base", address }, { context, value: safeAccount }, async () => {
    const result = await baseConnection.getAccountInfoAndContext(owner, "confirmed");
    return { slot: result.context.slot, owner: result.value!.owner.toBase58(), data: result.value!.data.toString("base64"), lamports: result.value!.lamports, executable: result.value!.executable };
  });
  await capture("account-missing", { operation: "account", route: "base", address }, { context, value: null }, async () => (await baseConnection.getAccountInfoAndContext(owner, "confirmed")).value);
  await capture("account-missing-fresh", { operation: "account", route: "base", address, minContextSlot: 123 }, { context, value: null },
    async () => (await baseConnection.getAccountInfoAndContext(owner, { commitment: "confirmed", minContextSlot: 123 })).value);
  await capture("accounts", { operation: "accounts", route: "base", addresses: [address, ZKUBE_PROGRAM_ID.toBase58()] }, { context, value: [safeAccount, null] }, async () => {
    const result = await baseConnection.getMultipleAccountsInfoAndContext([owner, ZKUBE_PROGRAM_ID], "confirmed");
    return result.value.map(value => value == null ? null : { slot: result.context.slot, owner: value.owner.toBase58(), data: value.data.toString("base64"), lamports: value.lamports, executable: value.executable });
  });
  for (const historical of [false, true]) {
    await capture(historical ? "accounts-historical-fresh" : "accounts-fresh", { operation: "accounts", route: historical ? "er" : "base",
      addresses: [address, ZKUBE_PROGRAM_ID.toBase58()], minContextSlot: 124, historical }, { context: { slot: 124 }, value: [null, null] }, async () =>
      (await (historical ? erConnection : baseConnection).getMultipleAccountsInfoAndContext([owner, ZKUBE_PROGRAM_ID], { commitment: "confirmed", minContextSlot: 124 })).value);
  }
  for (const err of [null, { InstructionError: [0, { Custom: 6001 }] }]) {
    await capture(err ? "simulation-failed" : "simulation-ok", { operation: "simulate", route: "base" },
      { context, value: { err, logs: ["Program log: fixture"], unitsConsumed: 42 } }, async () => {
        const result = (await baseConnection.simulateTransaction(transaction, { ...WALLET_SIMULATION_OPTIONS })).value;
        return { err: result.err, logs: result.logs, unitsConsumed: result.unitsConsumed };
      });
  }
  for (const [route, conn, policy] of [["base", baseConnection, "wallet"], ["er", erConnection, "erSession"], ["er", erConnection, "wallet"]] as const) {
    await capture(`${route}-send-${policy}`, { operation: "send", route, policy }, signature,
      () => conn.sendRawTransaction(transaction.serialize(), policy === "erSession" ? ER_SEND_OPTIONS : WALLET_SEND_OPTIONS));
  }
  for (const status of [null, "unknown", "processed", "confirmed", "finalized", "unknown-error", "processed-error", "confirmed-error", "finalized-error"]) {
    const confirmation = status?.replace("-error", "");
    const value = status == null ? null : { slot: 123, confirmations: confirmation === "finalized" ? null : 1,
      ...(confirmation === "unknown" ? {} : { confirmationStatus: confirmation }), err: status?.endsWith("-error") ? { InstructionError: [0, { Custom: 6001 }] } : null };
    await capture(`status-${status ?? "missing"}`, { operation: "status", route: "er", signature }, { context, value: [value] },
      async () => (await erConnection.getSignatureStatuses([signature])).value[0]);
  }
  await capture("historical-status", { operation: "status", route: "er", signature, historical: true }, { context, value: [null] },
    async () => (await erConnection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]);
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = fetcher;
    await capture("validator", { operation: "validator" }, { identity: address, fqdn: er }, async () => {
      const result = await getClosestValidator(router); return { identity: result.identity.toBase58(), fqdn: result.fqdn };
    });
    for (const isDelegated of [false, true]) {
      const status = isDelegated ? { isDelegated, fqdn: er, delegationRecord: { authority: address, owner: ZKUBE_PROGRAM_ID.toBase58(), delegationSlot: 77, lamports: 1 } } : { isDelegated };
      await capture(`placement-${isDelegated}`, { operation: "placement", address }, status, () => getDelegationStatus(owner, router, fetcher));
    }
    const routing = [];
    for (const [id, recordOwner, erOwner] of [["ready", ZKUBE_PROGRAM_ID, ZKUBE_PROGRAM_ID], ["wrong-record-owner", owner, ZKUBE_PROGRAM_ID], ["wrong-er-owner", ZKUBE_PROGRAM_ID, owner]] as const) {
      requests = [];
      const status = { isDelegated: true, fqdn: er, delegationRecord: { authority: address, owner: recordOwner.toBase58(), delegationSlot: 77, lamports: 1 } };
      responseResult = status;
      let accepted = false;
      try {
        await waitForDelegation(owner, { endpoint: router, attempts: 1, fetcher,
          erConnectionFactory: () => ({ getAccountInfo: async () => ({ owner: erOwner, executable: false, data: Buffer.alloc(0), lamports: 1 }) }) });
        accepted = true;
      } catch { /* Record real adapter decision, not error copy. */ }
      routing.push({ id, status, erAccount: { ...safeAccount, owner: erOwner.toBase58() }, accepted, requests });
    }
    const paths = ["client/tools/unity/rpc-fixtures.ts", "client/src/backend/solana/runs/router.ts", "client/src/backend/solana/runs/erTransport.ts",
      "client/src/backend/solana/runs/runPlan.ts", "client/pnpm-lock.yaml"];
    return { schemaVersion: 1, provenance: Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(resolve(repositoryRoot, path))).digest("hex")])),
      inputs: { base, router, er, expectedGenesis: SOLANA_DEVNET_GENESIS_HASH, program: ZKUBE_PROGRAM_ID.toBase58(), address,
        transaction: Buffer.from(transaction.serialize()).toString("base64"), message: Buffer.from(transaction.message.serialize()).toString("base64"), signature,
        blockhash: transaction.message.recentBlockhash }, cases, routing };
  } finally { globalThis.fetch = previousFetch; }
}
export { canonicalJson };
