import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { PublicKey, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import { IDL } from "../../src/backend/solana/idl/index";
import { repositoryRoot } from "./solana-fixtures";
import { projectToday } from "../../src/backend/solana/content/SolanaContentBoardsLive";
import { createReadOnlyWallet } from "../../src/backend/solana/identity/readOnlyWallet";
import { ZKUBE_PROGRAM_ID } from "../../src/backend/solana/constants";
import { fetchDailyView } from "../../src/backend/solana/content/dailyClient";
import { computeArcadeLifecycle } from "../../src/ui/components/arcade/arcadeLifecycle";
import { currentDailyDayId, dailyContentFromPairIndex } from "../../src/core/dailyRules";
import { coreDailyPairIndex, initializeZkubeCoreSync } from "../../src/core/zkubeCore";

export const publicDailyFixturePath = resolve(repositoryRoot, "fixtures/unity-public-daily-v1.json");
export async function generatePublicDailyFixtures() {
  initializeZkubeCoreSync(readFileSync(resolve(repositoryRoot, "client/src/core/generated/zkube_core_bg.wasm")));
  const products = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/unity-product-reads-v1.json"), "utf8"));
  const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
  const day = products.inputs.day, now = products.inputs.now;
  const fields = coder.decode("arenaDaily", Buffer.from(products.accounts.daily.data, "base64"));
  async function daily(change: Record<string, unknown>) {
    const bytes = Buffer.alloc(coder.size("arenaDaily"));
    (await coder.encode("arenaDaily", {...fields, ...change})).copy(bytes);
    return {...products.accounts.daily, data: bytes.toString("base64")};
  }
  const cases = [];
  for (const variant of ["open", "opens-at", "before-open", "freeze-minus-one", "freeze-at", "finalized", "suspended", "suspended-missing", "missing-daily", "missing-config", "paused"]) {
    const rows = {protocol: products.accounts.protocol, arcade: products.accounts.arcade, daily: products.accounts.daily};
    let timestamp = now;
    if (variant === "opens-at") timestamp = Number(fields.opensAt.toString());
    if (variant === "before-open") rows.daily = await daily({opensAt: new BN(now + 1)});
    if (variant === "freeze-minus-one") timestamp = Number(fields.runsCloseAt.toString()) - 1;
    if (variant === "freeze-at") timestamp = Number(fields.runsCloseAt.toString());
    if (variant === "finalized") rows.daily = await daily({status: {finalized: {}}});
    if (variant.startsWith("suspended")) rows.arcade = products.suspendedArcade;
    if (variant === "paused") rows.protocol = products.pausedProtocol;
    if (variant === "suspended-missing" || variant === "missing-daily") rows.daily = null;
    if (variant === "missing-config") rows.arcade = null;
    const map = new Map<string, { owner: string; executable: boolean; data: string }>(
      Object.values(rows).filter(Boolean).map(row => [row.address, row]));
    const requests: string[] = [];
    const info = (address: PublicKey) => {
      requests.push(address.toBase58());
      const row = map.get(address.toBase58());
      return row ? {owner: new PublicKey(row.owner), executable: row.executable, data: Buffer.from(row.data, "base64"), lamports: 1, rentEpoch: 0} : null;
    };
    const connection = {rpcEndpoint: "https://base.invalid/", getAccountInfo: async(address: PublicKey) => info(address),
      getAccountInfoAndContext: async(address: PublicKey) => ({context: {slot: 100}, value: info(address)}),
      getMultipleAccountsInfo: async(addresses: PublicKey[]) => addresses.map(info)} as unknown as Connection;
    const wallet = createReadOnlyWallet(ZKUBE_PROGRAM_ID);
    let content = null, unavailable = null, view = null;
    try { content = await projectToday({connection, wallet, nowUnix: timestamp}); }
    catch (error) { unavailable = error instanceof Error ? error.message : String(error); }
    if (!unavailable && rows.daily) view = await fetchDailyView({connection, wallet, dayId: day});
    cases.push({variant, now: timestamp, rows, content, unavailable,
      pool: view?.dailyPotLamports.toString() ?? null,
      lifecycle: computeArcadeLifecycle({view, hasActiveRun: false, nowUnix: timestamp}), requests});
  }
  const clocks = [];
  for (const timestamp of [0, day * 86400 - 1, day * 86400, (day + 1) * 86400 - 1, (day + 1) * 86400, 4294967295 * 86400 + 86399]) {
    const dayId = currentDailyDayId(timestamp);
    clocks.push({now: timestamp, day: dayId, pair: dailyContentFromPairIndex(dayId, await coreDailyPairIndex(dayId))});
  }
  const sourcePaths = ["client/src/backend/solana/content/SolanaContentBoardsLive.ts", "client/src/backend/solana/content/dailyClient.ts",
    "client/src/backend/solana/identity/readOnlyWallet.ts", "client/src/core/dailyRules.ts",
    "client/src/ui/components/arcade/arcadeLifecycle.ts", "client/src/core/generated/zkube_core_bg.wasm", "fixtures/unity-product-reads-v1.json"];
  return {schemaVersion: 1, cases, clocks,
    provenance: {...Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(resolve(repositoryRoot, path))).digest("hex")])),
      "client/tools/unity/public-daily-fixtures.ts": createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex")}};
}
