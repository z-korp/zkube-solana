/** Finite offline profile writes. No deployed execution or economic projection. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import BN from "bn.js";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import { repositoryRoot } from "./solana-fixtures";
import { IDL } from "../../src/backend/solana/idl";
import { derivePlayerStatePda } from "../../src/backend/solana/pdas";
import { buildSetFeaturedEmblemPlan, fetchPlayerStateView } from "../../src/backend/solana/economy/playerStateClient";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import { withPinnedWalletComputeBudget } from "../../src/backend/solana/runs/runPlan";
import { initializeZkubeCoreSync, coreLadderTierCount, coreLadderTierFloor } from "../../src/core/zkubeCore";

export const moneyProfileFixturePath = process.env.ZKUBE_MONEY_PROFILE_FIXTURE_PATH ?? resolve(repositoryRoot, "fixtures/unity-money-profile-v1.json");
export const moneyProfileDataPath = process.env.ZKUBE_MONEY_PROFILE_DATA_PATH ?? resolve(repositoryRoot, "unity/Assets/ZKube/Integration/App/Evidence/MoneyProfileEvidenceData.g.cs");
interface Envelope { address: string; owner: string; executable: boolean; data: string; lamports?: number }
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function generateMoneyProfileFixtures() {
 initializeZkubeCoreSync(readFileSync(resolve(repositoryRoot, "client/src/core/generated/zkube_core_bg.wasm")));
 const paths = ["fixtures/unity-money-economy-v1.json", "fixtures/unity-money-session-v1.json", "fixtures/unity-plans-v1.json"];
 const [economy, sessions, plans] = paths.map(path => JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")));
 const owner = Keypair.fromSeed(Buffer.alloc(32, 1)), device = Keypair.fromSeed(Buffer.alloc(32, 2));
 const current = sessions.scenarios.find((row: {id: string}) => row.id === "session-current");
 if (current.active.signer !== device.publicKey.toBase58()) throw new Error("Synthetic profile signer mismatch");
 const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
 const encode = async (fields: object) => {
  const bytes = Buffer.alloc(coder.size("playerState")); (await coder.encode("playerState", fields)).copy(bytes); return bytes.toString("base64");
 };
 const playerAddress = derivePlayerStatePda(owner.publicKey).toBase58();
 const base = economy.scenarios.find((row: {id: string}) => row.id === "kredit-buy-1").before as Envelope[];
 const source = base.find(row => row.address === playerAddress)!;
 const scenarios = [];
 for (const variant of ["success", "auto", "border-only", "explicit-auto-target", "fresh", "confirmed-failure", "pending-success", "pending-failure", "missing-session", "superseded"] as const) {
  const failure = variant.endsWith("failure"), available = variant !== "missing-session";
  const status = variant.startsWith("pending-") ? "processed" : "confirmed";
  const emblem = variant === "auto" || variant === "border-only" || variant === "fresh" ? 0 : variant === "explicit-auto-target" ? 12 : 8;
  const frame = variant === "auto" || variant === "explicit-auto-target" || variant === "fresh" ? 0 : 3;
  const rows = new Map(base.map(row => [row.address, {...row}]));
  if (available) for (const row of current.before as Envelope[])
   if (row.address === current.active.signer || row.address === current.active.token) rows.set(row.address, {...row});
  const player = coder.decode("playerState", Buffer.from(source.data, "base64"));
  player.campaignStars = Array(25).fill(variant === "fresh" ? 0 : 255);
  player.highestLadderTier = variant === "fresh" ? 0 : coreLadderTierCount() - 1;
  player.ladderPoints = new BN(coreLadderTierFloor(player.highestLadderTier).toString());
  player.featuredEmblem = variant === "auto" ? 8 : 0; player.featuredFrameTier = variant === "auto" ? 3 : 0;
  rows.set(playerAddress, {...source, data: await encode(player)});
  const before = [...rows.values()];
  const plan = await buildSetFeaturedEmblemPlan({connection: {rpcEndpoint: economy.inputs.base} as Connection,
   wallet: new SessionWallet(device), ownerAuthority: owner.publicKey, sessionToken: new PublicKey(current.active.token), emblemId: emblem, frameTier: frame});
  const tx = new VersionedTransaction(new TransactionMessage({payerKey: device.publicKey, recentBlockhash: plans.inputs.blockhash,
   instructions: withPinnedWalletComputeBudget(plan.transaction.instructions)}).compileToV0Message());
  const partial = Buffer.from(tx.serialize()).toString("base64"); tx.sign([device]);
  if (available && !failure) {
   player.featuredEmblem = variant === "superseded" ? 10 : emblem;
   player.featuredFrameTier = variant === "superseded" ? 4 : frame;
   rows.set(playerAddress, {...source, data: await encode(player)});
  }
  const project = async (accounts: Envelope[]) => {
   const row = accounts.find(value => value.address === playerAddress)!;
   const connection = {rpcEndpoint: economy.inputs.base, getAccountInfo: async (address: PublicKey) => address.toBase58() === row.address ? {
    owner: new PublicKey(row.owner), executable: row.executable, data: Buffer.from(row.data, "base64"), lamports: row.lamports ?? economy.inputs.accountLamports, rentEpoch: 0} : null} as unknown as Connection;
   const profile = await fetchPlayerStateView({connection, wallet: new SessionWallet(owner), owner: owner.publicKey});
   if (!profile) throw new Error("Actual TypeScript profile reader rejected fixture");
   return profile;
  };
  const after = [...rows.values()];
  scenarios.push({id: "profile-" + variant, variant, operation: "featured", emblem, frame, failure, status,
   label: "Offline synthetic profile · " + variant, before, after, erAccounts: [], active: available ? current.active : null,
   expectedActive: available ? current.active : null, ownerDeclines: false,
   transaction: {partial, message: Buffer.from(tx.message.serialize()).toString("base64"), signed: Buffer.from(tx.serialize()).toString("base64"),
    ownerRequired: false, feePayer: device.publicKey.toBase58()},
   expectedBefore: await project(before), expectedAfter: await project(after)});
 }
 paths.push("client/src/backend/solana/economy/playerStateClient.ts", "client/src/backend/solana/content/campaignClient.ts",
  "client/src/core/generated/zkube_core_bg.wasm", "programs/solana/src/instructions/profile_instructions.rs", "programs/solana/src/state/protocol.rs");
 const body = {schemaVersion: 1, evidenceClass: "offline-synthetic-money-profile", inputs: economy.inputs, scenarios,
  provenance: [...paths.map(path => ({path, sha256: hash(readFileSync(resolve(repositoryRoot, path)))})),
   {path: "client/tools/unity/money-profile-fixtures.ts", sha256: hash(readFileSync(new URL(import.meta.url)))}]};
 const normalized = JSON.parse(JSON.stringify(body, (_, value) => typeof value === "bigint" ? value.toString() : value));
 return {...normalized, sourceSha256: hash(JSON.stringify(normalized))};
}

export function generatedMoneyProfileData(value: Awaited<ReturnType<typeof generateMoneyProfileFixtures>>) {
 return "// Generated synthetic evidence only. Excluded from production and Store.\n#if (UNITY_EDITOR || ZKUBE_EVIDENCE) && !ZKUBE_STORE\nnamespace ZKube.Integration.App.Evidence\n{\n internal static class MoneyProfileEvidenceData\n {\n  internal static string Json => System.Text.Encoding.UTF8.GetString(System.Convert.FromBase64String(\"" + Buffer.from(JSON.stringify(value)).toString("base64") + "\"));\n }\n}\n#endif\n";
}
