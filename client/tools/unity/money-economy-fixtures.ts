/** Finite owner purchase evidence. Synthetic keys only; no network or real wallet. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import BN from "bn.js";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import { repositoryRoot } from "./solana-fixtures";
import { IDL } from "../../src/backend/solana/idl";
import { KREDIT_PACK_SIZES, type KreditPackSize } from "../../src/config/kreditPacks";
import { ARENA_ENTRY_LAMPORTS, ENTRY_DAILY_LAMPORTS, ENTRY_OPERATOR_LAMPORTS } from "../../src/core/protocolVersions.generated";
import { buildPurchaseKreditsPlan } from "../../src/backend/solana/content/dailyClient";
import { fetchPlayerStateView } from "../../src/backend/solana/economy/playerStateClient";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import { withPinnedWalletComputeBudget } from "../../src/backend/solana/runs/runPlan";

export const moneyEconomyFixturePath = process.env.ZKUBE_MONEY_ECONOMY_FIXTURE_PATH ?? resolve(repositoryRoot, "fixtures/unity-money-economy-v1.json");
export const moneyEconomyDataPath = process.env.ZKUBE_MONEY_ECONOMY_DATA_PATH ?? resolve(repositoryRoot, "unity/Assets/ZKube/Integration/App/Evidence/MoneyEconomyEvidenceData.g.cs");
interface Envelope { address: string; owner: string; executable: boolean; data: string; lamports?: number }
interface Definition { id: string; pack: KreditPackSize; status: "confirmed" | "processed"; failure: boolean; ownerDeclines: boolean; ownerBalance: number }
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export async function generateMoneyEconomyFixtures() {
  const references = ["fixtures/unity-money-overview-v1.json", "fixtures/unity-plans-v1.json", "fixtures/unity-economy-v1.json", "fixtures/unity-rpc-v1.json"];
  const [overview, plans, economy, rpc] = references.map(path => JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")));
  const owner = Keypair.fromSeed(Buffer.alloc(32, 1)), wallet = new SessionWallet(owner);
  if (owner.publicKey.toBase58() !== overview.inputs.owner) throw new Error("Synthetic purchase owner disagrees");
  const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
  const encode = async (name: string, fields: object, original: Envelope): Promise<Envelope> => {
    const bytes = Buffer.alloc(coder.size(name)); (await coder.encode(name, fields)).copy(bytes);
    return { ...original, data: bytes.toString("base64") };
  };
  const profile = async (row: Envelope) => {
    const connection = { rpcEndpoint: overview.inputs.base, getAccountInfo: async (address: PublicKey) => {
      if (address.toBase58() !== row.address) throw new Error("Unexpected profile address");
      return { data: Buffer.from(row.data, "base64"), owner: new PublicKey(row.owner), executable: row.executable,
        lamports: row.lamports ?? overview.inputs.accountLamports, rentEpoch: 0 };
    } } as unknown as Connection;
    const result = await fetchPlayerStateView({ connection, wallet, owner: owner.publicKey });
    if (!result) throw new Error("Actual TypeScript player read rejected purchase fixture");
    return { kredits: result.kreditBalance.toString(), ladderPoints: result.ladderPoints.toString(),
      paidEntries: result.lifetimePaidEntries.toString(), streak: result.entryStreakDays, stars: result.campaignStars };
  };
  const definitions: Definition[] = KREDIT_PACK_SIZES.map(pack => ({ id: "kredit-buy-" + pack, pack, status: "confirmed", failure: false, ownerDeclines: false, ownerBalance: 2000000000 }));
  definitions.push(
    { id: "kredit-owner-decline", pack: 1, status: "confirmed", failure: false, ownerDeclines: true, ownerBalance: 2000000000 },
    { id: "kredit-fee-shortage", pack: 1, status: "confirmed", failure: false, ownerDeclines: false, ownerBalance: 0 },
    { id: "kredit-pending-success", pack: 10, status: "processed", failure: false, ownerDeclines: false, ownerBalance: 2000000000 },
    { id: "kredit-pending-failure", pack: 10, status: "processed", failure: true, ownerDeclines: false, ownerBalance: 2000000000 },
  );
  const scenarios = [];
  const result = (id: string) => rpc.cases.find((row: { id: string }) => row.id === id).result;
  for (const definition of definitions) {
    const connection = { rpcEndpoint: overview.inputs.base } as Connection;
    const plan = await buildPurchaseKreditsPlan({ connection, ownerWallet: wallet, kreditCount: definition.pack });
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: plans.inputs.blockhash,
      instructions: withPinnedWalletComputeBudget(plan.transaction.instructions) }).compileToV0Message());
    const partial = Buffer.from(tx.serialize()).toString("base64"); tx.sign([owner]);
    const message = Buffer.from(tx.message.serialize()).toString("base64");
    const agreed = plans.plans.find((row: { id: string }) => row.id === "purchase-" + definition.pack);
    if (message !== agreed.expected.message) throw new Error("Actual purchase message differs from the planner agreement");
    const playerBefore = plans.accounts.player as Envelope, creditBefore = plans.accounts.credit as Envelope, revenueBefore = economy.revenue as Envelope;
    const rows = new Map<string, Envelope>((overview.scenarios.find((row: { id: string }) => row.id === "owner-overview").baseAccounts as Envelope[])
      .map(row => [row.address, row]));
    for (const row of [plans.accounts.protocol, plans.accounts.arcade, playerBefore, creditBefore, revenueBefore]) rows.set(row.address, row);
    rows.set(owner.publicKey.toBase58(), { address: owner.publicKey.toBase58(), owner: PublicKey.default.toBase58(), executable: false, data: "", lamports: definition.ownerBalance });
    const before = [...rows.values()];
    const player = coder.decode("playerState", Buffer.from(playerBefore.data, "base64"));
    const credit = coder.decode("creditVault", Buffer.from(creditBefore.data, "base64"));
    const revenue = coder.decode("operatorRevenueVault", Buffer.from(revenueBefore.data, "base64"));
    player.kreditBalance = player.kreditBalance.addn(definition.pack);
    credit.purchasedPrizeLamports = credit.purchasedPrizeLamports.add(new BN((BigInt(definition.pack) * ENTRY_DAILY_LAMPORTS).toString()));
    revenue.grossOperatorShare = revenue.grossOperatorShare.add(new BN((BigInt(definition.pack) * ENTRY_OPERATOR_LAMPORTS).toString()));
    const playerAfter = await encode("playerState", player, playerBefore);
    for (const row of [playerAfter, await encode("creditVault", credit, creditBefore), await encode("operatorRevenueVault", revenue, revenueBefore)]) rows.set(row.address, row);
    const allowed = !definition.failure && !definition.ownerDeclines && definition.ownerBalance > 0;
    scenarios.push({ ...definition, operation: "purchase", label: "Offline synthetic purchase · " + definition.id,
      before, after: [...rows.values()], erAccounts: [], active: null, expectedActive: null,
      transaction: { message, partial, signed: Buffer.from(tx.serialize()).toString("base64"), ownerRequired: true,
        feePayer: owner.publicKey.toBase58(), signatureBytes: Buffer.from(tx.signatures[0]!).toString("base64") },
      expectedBefore: await profile(playerBefore), expectedAfter: await profile(allowed ? playerAfter : playerBefore),
      priceLamports: (BigInt(definition.pack) * ARENA_ENTRY_LAMPORTS).toString(),
      prizeReserveAdded: (BigInt(definition.pack) * ENTRY_DAILY_LAMPORTS).toString(),
      operatorShareAdded: (BigInt(definition.pack) * ENTRY_OPERATOR_LAMPORTS).toString() });
  }
  references.push("client/src/config/kreditPacks.ts", "client/src/backend/solana/content/dailyClient.ts", "client/src/backend/solana/runs/runPlan.ts",
    "client/src/backend/solana/economy/playerStateClient.ts", "client/src/core/protocolVersions.generated.ts",
    "programs/solana/src/instructions/arcade_instructions.rs");
  const body = { schemaVersion: 1, evidenceClass: "offline-synthetic-money-economy", inputs: { ...overview.inputs, now: plans.inputs.now,
    blockhash: result("base-blockhash"), fee: result("base-fee"), rent: result("base-rent"), simulation: result("simulation-ok"),
    ownerSeed: Buffer.alloc(32, 1).toString("base64"), deviceSeed: Buffer.alloc(32, 2).toString("base64"), candidateSeed: Buffer.alloc(32, 3).toString("base64") },
    scenarios, provenance: [...references.map(path => ({ path, sha256: hash(readFileSync(resolve(repositoryRoot, path))) })),
      { path: "client/tools/unity/money-economy-fixtures.ts", sha256: hash(readFileSync(new URL(import.meta.url))) }] };
  return { ...body, sourceSha256: hash(JSON.stringify(body)) };
}

export function generatedMoneyEconomyData(value: Awaited<ReturnType<typeof generateMoneyEconomyFixtures>>) {
  return "// Generated synthetic evidence only. Excluded from production and Store.\n#if (UNITY_EDITOR || ZKUBE_EVIDENCE) && !ZKUBE_STORE\nnamespace ZKube.Integration.App.Evidence\n{\n    internal static class MoneyEconomyEvidenceData\n    {\n        internal static string Json => System.Text.Encoding.UTF8.GetString(System.Convert.FromBase64String(\"" + Buffer.from(JSON.stringify(value)).toString("base64") + "\"));\n    }\n}\n#endif\n";
}
