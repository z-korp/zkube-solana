/** Encode a positive product profile and compose unchanged run/transaction oracles for offline evidence. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { repositoryRoot } from "./solana-fixtures";
import BN from "bn.js";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { IDL } from "../../src/backend/solana/idl/index";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import { fetchPlayerStateView } from "../../src/backend/solana/economy/playerStateClient";
import { projectSolanaEconomy } from "../../src/backend/solana/economy/SolanaEconomyLive";
import { CAMPAIGN_STAR_BYTES, fetchCampaignView } from "../../src/backend/solana/content/campaignClient";
import { coreLadderTier, coreLadderTierFloor, initializeZkubeCoreSync } from "../../src/core/zkubeCore";

export const moneyOverviewFixturePath = process.env.ZKUBE_MONEY_OVERVIEW_FIXTURE_PATH ??
  resolve(repositoryRoot, "fixtures/unity-money-overview-v1.json");
export const moneyOverviewDataPath = process.env.ZKUBE_MONEY_OVERVIEW_DATA_PATH ??
  resolve(repositoryRoot, "unity/Assets/ZKube/Integration/App/Evidence/MoneyEvidenceData.g.cs");
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
interface ExistingAccount { id: string; address: string; owner: string; executable: boolean; data: string }
interface ExistingTransaction { id: string; signedTransaction: string; signature: string; blockhash: string }
interface ExistingRpcCase { id: string; result: unknown }

export async function generateMoneyOverviewFixtures() {
  initializeZkubeCoreSync(readFileSync(resolve(repositoryRoot, "client/src/core/generated/zkube_core_bg.wasm")));
  const files = ["fixtures/unity-product-reads-v1.json", "fixtures/unity-run-client-v1.json",
    "fixtures/unity-solana-v1.json", "fixtures/unity-rpc-v1.json", "fixtures/unity-economy-v1.json"];
  const [products, runs, solana, rpc, economy] = files.map(file => JSON.parse(readFileSync(resolve(repositoryRoot, file), "utf8")));
  const select = <T extends { id: string }>(items: T[], id: string): T => {
    const matches = items.filter(item => item.id === id);
    if (matches.length !== 1) throw new Error(`Expected one existing oracle ${id}`);
    return matches[0];
  };
  const publicAccounts = [products.accounts.protocol, products.accounts.arcade, products.accounts.daily];
  const acceptedRuns = [select<ExistingAccount>(runs.cases, "active-daily-playing")];
  // The run oracle is intentionally a wide-integer serialization specimen, not
  // a positive player history. Preserve its owner/slot identities, then encode
  // separate, reachable product evidence through the canonical account coder.
  const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
  const playerFields = coder.decode("playerState", Buffer.from(runs.player.data, "base64"));
  const points = coreLadderTierFloor(1), tier = coreLadderTier(points);
  const stars = new Array<number>(CAMPAIGN_STAR_BYTES).fill(0);
  stars[0] = 255; stars[1] = 255; stars[2] = 15; // Ten perfected levels; no later progress.
  Object.assign(playerFields, { ladderPoints: new BN(points.toString()), highestLadderTier: tier,
    featuredFrameTier: tier, campaignStars: stars, lifetimePaidEntries: new BN(150),
    entryStreakDays: 3, lastEntryDayId: products.inputs.day, bestDailyScore: 1200 });
  const bytes = Buffer.alloc(coder.size("playerState"));
  (await coder.encode("playerState", playerFields)).copy(bytes);
  const player = { address: runs.player.address as string, owner: runs.player.owner as string,
    executable: runs.player.executable as boolean, data: bytes.toString("base64") };
  const ownerAccounts: Omit<ExistingAccount, "id">[] = [...publicAccounts, player, products.accounts.credit, economy.revenue];
  const lookup = (address: PublicKey) => {
    const row = ownerAccounts.find(value => value.address === address.toBase58());
    return row ? { owner: new PublicKey(row.owner), executable: row.executable,
      data: Buffer.from(row.data, "base64"), lamports: 1, rentEpoch: 0 } : null;
  };
  const connection = { rpcEndpoint: "https://base.invalid/", getAccountInfo: async(address: PublicKey) => lookup(address),
    getMultipleAccountsInfo: async(addresses: PublicKey[]) => addresses.map(lookup) } as unknown as Connection;
  const wallet = new SessionWallet(Keypair.fromSeed(new Uint8Array(32).fill(1)));
  const profile = await fetchPlayerStateView({ connection, wallet, owner: new PublicKey(products.inputs.owner) });
  const campaign = await fetchCampaignView({ connection, wallet });
  if (!profile || !campaign) throw new Error("Actual TS product reads rejected the overview profile");
  const projected = projectSolanaEconomy(profile, []);
  if (projected.profile.highestTier < projected.profile.ladderTier ||
      projected.profile.wornBorder > projected.profile.highestTier) throw new Error("Invalid overview ladder history");
  const expectedProfile = JSON.parse(JSON.stringify({ ...projected.profile, kredits: projected.kredits,
    lifetimePaidEntries: profile.lifetimePaidEntries, lastEntryDayId: profile.lastEntryDayId,
    campaign: campaign.maps.map(value => ({ mapId: value.mapId, unlocked: value.unlocked,
      cleared: value.cleared, perfected: value.perfected, levelStars: value.levelStars })),
    activeCampaign: null }, (_, value: unknown) => typeof value === "bigint" ? value.toString() : value));
  const purchase = select<ExistingTransaction>(solana.transactions, "purchase-1");
  const result = <T>(id: string) => select<ExistingRpcCase>(rpc.cases, id).result as T;
  const lease = result<{ value: { blockhash: string; lastValidBlockHeight: number } }>("base-blockhash");
  const account = result<{ context: { slot: number }; value: { lamports: number } }>("account");
  const pending = { intent: "purchase-one", transaction: purchase.signedTransaction, signature: purchase.signature,
    blockhash: purchase.blockhash, lastValidBlockHeight: lease.value.lastValidBlockHeight };
  const inputs = {
    now: products.inputs.now, owner: products.inputs.owner,
    base: rpc.inputs.base, router: rpc.inputs.router, er: rpc.inputs.er,
    expectedGenesis: rpc.inputs.expectedGenesis, program: rpc.inputs.program,
    accountContext: account.context,
    accountLamports: account.value.lamports,
    height: result<number>("base-height"),
    delegated: select<{ id: string; status: unknown }>(rpc.routing, "ready").status,
    processed: result<unknown>("status-processed-error"),
    confirmedFailure: result<unknown>("status-confirmed-error"),
  };
  if (pending.blockhash !== lease.value.blockhash)
    throw new Error("Existing signed purchase and RPC lease oracle must agree");
  const payload = { schemaVersion: 1, evidenceClass: "offline-injected-money-overview",
    provenance: { sources: [
      { path: "client/tools/unity/money-overview-fixtures.ts", sha256: hash(readFileSync(fileURLToPath(import.meta.url))) },
      ...files.map(path => ({ path, sha256: hash(readFileSync(resolve(repositoryRoot, path))) })),
      ...["client/src/backend/solana/economy/playerStateClient.ts", "client/src/backend/solana/economy/SolanaEconomyLive.ts",
        "client/src/backend/solana/content/campaignClient.ts", "client/src/core/generated/zkube_core_bg.wasm"].map(path =>
        ({ path, sha256: hash(readFileSync(resolve(repositoryRoot, path))) })),
    ] }, inputs, expectedProfile,
    scenarios: [
      { id: "public-disconnected", label: "Offline evidence · Public Daily", baseAccounts: publicAccounts, erAccounts: [], pending: null },
      { id: "owner-overview", label: "Offline evidence · Owner overview", baseAccounts: ownerAccounts, erAccounts: acceptedRuns, pending: null },
      { id: "pending-confirmed-failure", label: "Offline evidence · Pending transaction", baseAccounts: ownerAccounts, erAccounts: acceptedRuns, pending },
      { id: "campaign-playable", label: "Offline evidence · Local Campaign", baseAccounts: publicAccounts, erAccounts: [], pending: null },
    ],
  };
  return { ...payload, sourceSha256: hash(JSON.stringify(payload)) };
}

export function generatedMoneyEvidenceData(fixture: Awaited<ReturnType<typeof generateMoneyOverviewFixtures>>) {
  return "// Generated by the canonical TypeScript evidence producer. No runtime file access.\n" +
    "#if (UNITY_EDITOR || ZKUBE_EVIDENCE) && !ZKUBE_STORE\nnamespace ZKube.Integration.App.Evidence\n{\n" +
    "    internal static class MoneyEvidenceData\n    {\n" +
    `        internal const string Json = @"${JSON.stringify(fixture).replace(/"/g, '""')}";\n` +
    "    }\n}\n#endif\n";
}
