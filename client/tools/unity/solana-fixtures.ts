import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage,
  VersionedTransaction, type Connection, type TransactionInstruction,
} from "@solana/web3.js";
import * as pdas from "../../src/backend/solana/pdas";
import { IDL } from "../../src/backend/solana/idl";
import { ZKUBE_PROGRAM_ID, DELEGATION_PROGRAM_ID } from "../../src/backend/solana/constants";
import {
  buildApplyBonusPlan, buildFinishRunPlan, buildPlayMovePlan,
  buildRequestRerollPlan, buildRequestRowPlan, withPinnedWalletComputeBudget,
} from "../../src/backend/solana/runs/runPlan";
import { buildClaimDailyPrizePlan, buildPurchaseKreditsPlan } from "../../src/backend/solana/content/dailyClient";
import {
  buildCreateSessionV2Instruction, decodeSessionTokenV2Account,
  deriveSessionTokenV2Pda, SESSION_KEYS_PROGRAM_ID,
  SESSION_TOKEN_V2_DISCRIMINATOR, SESSION_TOKEN_V2_ACCOUNT_BYTES,
  CREATE_SESSION_V2_DISCRIMINATOR,
} from "../../src/backend/solana/session/sessionV2";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import { generateRecoveryFixtures } from "./recovery-fixtures";
import { generateAccountFixtures } from "./account-fixtures";
import { dailyContentFromPairIndex } from "../../src/core/dailyRules";
import { CATALOG_VERSION, DAILY_MAX_MOVES } from "../../src/core/protocolVersions.generated";
import { coreDailyPairIndex } from "../../src/core/zkubeCore";
import BN from "bn.js";
import bs58 from "bs58";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const fixturePath = resolve(repositoryRoot, "fixtures/unity-solana-v1.json");
export const generatedIdlPath = resolve(repositoryRoot, "unity/Assets/ZKube/Integration/Generated/solana.json");
export const generatedSessionPath = resolve(repositoryRoot, "unity/Assets/ZKube/Integration/Generated/session.json");

// Deliberately public, synthetic test identities; never funded or used with RPC.
const ownerKey = Keypair.fromSeed(new Uint8Array(32).fill(1));
const deviceKey = Keypair.fromSeed(new Uint8Array(32).fill(2));
const owner = ownerKey.publicKey;
const device = deviceKey.publicKey;
const blockhash = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
const nowUnix = 1788912000;
const dayId = Math.floor(nowUnix / 86400);
const runId = 9007199254740993n;

function normalized(value: unknown): unknown {
  if (BN.isBN(value)) return value.toString();
  if (typeof value === "bigint") return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalized(item)]),
  );
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalized(value), null, 2) + "\n";
}

function instructionView(instruction: TransactionInstruction) {
  return {
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map((key) => ({
      address: key.pubkey.toBase58(), signer: key.isSigner, writable: key.isWritable,
    })),
    data: Buffer.from(instruction.data).toString("base64"),
  };
}

export async function generateSolanaFixtures() {
  // Property access on an unconfigured transport fails before any network work.
  const offlineConnection = new Proxy({ rpcEndpoint: "https://base.invalid" }, {
    get(target, property) {
      if (property in target) return Reflect.get(target, property);
      throw new Error(`Unexpected offline RPC access: ${String(property)}`);
    },
  }) as unknown as Connection;
  const ownerWallet = new SessionWallet(ownerKey);
  const sessionWallet = new SessionWallet(deviceKey);
  const sessionToken = deriveSessionTokenV2Pda({ authority: owner, sessionSigner: device }).sessionToken;
  const activeRun = pdas.deriveRunAddresses(owner, runId).activeRun;
  const context = { owner, sessionWallet, sessionToken, activeRun, erConnection: offlineConnection };
  const seed = new Uint8Array(32).fill(7);
  const transactions: object[] = [];
  function add(id: string, name: string, args: object, instruction: TransactionInstruction,
    version: "v0" | "legacy", payer = device) {
    const instructions = version === "v0" ? withPinnedWalletComputeBudget([instruction]) : [instruction];
    const message = version === "v0"
      ? new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message().serialize()
      : new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(...instructions).serializeMessage();
    const signers = [ownerKey, deviceKey].filter(key => key.publicKey.equals(payer) ||
      instructions.some(ix => ix.keys.some(meta => meta.isSigner && meta.pubkey.equals(key.publicKey))));
    let signedTransaction: Uint8Array, signature: Uint8Array;
    if (version === "v0") {
      const signed = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message());
      signed.sign(signers); signedTransaction = signed.serialize(); signature = signed.signatures[0];
    } else {
      const signed = new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(...instructions);
      signed.sign(...signers); signedTransaction = signed.serialize(); signature = signed.signature!;
    }
    const decoded = VersionedTransaction.deserialize(signedTransaction).message;
    const decodedAccounts = decoded.staticAccountKeys.map((key, index) => ({ address: key.toBase58(),
      signer: decoded.isAccountSigner(index), writable: decoded.isAccountWritable(index) }));
    const decodedInstructions = decoded.compiledInstructions.map(ix => ({ programId: decodedAccounts[ix.programIdIndex].address,
      accounts: ix.accountKeyIndexes.map(index => decodedAccounts[index]), data: Buffer.from(ix.data).toString("base64") }));
    transactions.push({ id, instructionName: name, args, version, feePayer: payer.toBase58(), decodedAccounts, decodedInstructions,
      signers: signers.map(key => key.publicKey.toBase58()), signedTransaction: Buffer.from(signedTransaction).toString("base64"), signature: bs58.encode(signature),
      blockhash, instructions: instructions.map(instructionView), message: Buffer.from(message).toString("base64") });
  }
  for (const count of [1, 10, 25]) {
    const plan = await buildPurchaseKreditsPlan({ connection: offlineConnection, ownerWallet, kreditCount: count });
    add(`purchase-${count}`, "purchase_kredits", { kredit_count: count, expected_unit_lamports: "10000000" },
      plan.transaction.instructions[0], "v0", owner);
  }
  for (const board of ["score", "theme"] as const) {
    const plan = await buildClaimDailyPrizePlan({ connection: offlineConnection, wallet: sessionWallet,
      ownerAuthority: owner, sessionToken, dayId, board, position: 3 });
    add(`claim-${board}`, "claim_daily_prize", { board: { [board]: {} }, position: 3 }, plan.transaction.instructions[0], "v0");
  }
  const createSession = buildCreateSessionV2Instruction({ authority: owner, sessionSigner: device, feePayer: owner,
    topUp: false, validUntil: BigInt(nowUnix + 604800), lamports: 5000000n });
  add("session-create", "create_session_v2", { top_up: false, valid_until: String(nowUnix + 604800), lamports: "5000000" },
    createSession, "v0", owner);
  const row = await buildRequestRowPlan({ ...context, clientSeed: seed });
  add("request-row", "request_vrf", { client_seed: [...seed] }, row.transaction.instructions[0], "legacy");
  const move = await buildPlayMovePlan({ ...context, expectedAction: 3, expectedMove: 2, row: 1, start: 2, destination: 4, clientSeed: seed });
  add("move", "play_move", { expected_action: 3, expected_move: 2, row: 1, start: 2, destination: 4, client_seed: [...seed] }, move.transaction.instructions[0], "legacy");
  const bonus = await buildApplyBonusPlan({ ...context, expectedAction: 9, row: 2, column: 5, clientSeed: seed });
  add("bonus", "apply_bonus", { expected_action: 9, row: 2, column: 5, client_seed: [...seed] }, bonus.transaction.instructions[0], "legacy");
  const reroll = await buildRequestRerollPlan({ ...context, expectedAction: 9, clientSeed: seed });
  add("reroll", "request_reroll", { expected_action: 9, client_seed: [...seed] }, reroll.transaction.instructions[0], "legacy");
  const finish = await buildFinishRunPlan({ owner, signerWallet: sessionWallet, sessionToken, activeRun, erConnection: offlineConnection });
  add("abandon", "finish_run", { reason: { abandon: {} } }, finish.transaction.instructions[0], "legacy");

  const pdaCases: object[] = [];
  const pda = (id: string, seeds: Uint8Array[], expected: PublicKey, program = ZKUBE_PROGRAM_ID) => {
    const [actual, bump] = PublicKey.findProgramAddressSync(seeds.map((value) => Buffer.from(value)), program);
    if (!expected.equals(actual)) throw new Error(`PDA oracle disagrees: ${id}`);
    pdaCases.push({ id, seeds: seeds.map((value) => Buffer.from(value).toString("base64")),
      program: program.toBase58(), address: expected.toBase58(), bump });
  };
  for (const [id, seedValue, derive] of [
    ["protocol", "protocol", pdas.deriveProtocolConfigPda], ["arcade", "arcade", pdas.deriveArcadeConfigPda],
    ["archive", "arcade_archive", pdas.deriveArcadeArchivePda], ["cadence", "cadence_funding", pdas.deriveCadenceFundingPda],
    ["operator", "operator_revenue", pdas.deriveOperatorRevenueVaultPda], ["credit", "credit_vault", pdas.deriveCreditVaultPda],
  ] as const) pda(id, [Buffer.from(seedValue)], derive());
  pda("player", [Buffer.from("player"), owner.toBytes()], pdas.derivePlayerStatePda(owner));
  pda("label", [Buffer.from("label"), owner.toBytes()], pdas.derivePlayerLabelPda(owner));
  const dayBytes = Buffer.alloc(4); dayBytes.writeUInt32LE(dayId);
  const daily = pdas.deriveArenaDailyPda(dayId);
  pda("daily", [Buffer.from("arena_daily"), dayBytes], daily);
  for (const board of ["score", "theme"] as const) pda(`board-${board}`, [Buffer.from("arena_board"), daily.toBytes(), Buffer.from(board)], pdas.deriveArenaBoardPda(daily, board));
  pda("arena-player", [Buffer.from("arena_player"), daily.toBytes(), owner.toBytes()], pdas.deriveArenaPlayerPda(daily, owner));
  const runBytes = Buffer.alloc(8); runBytes.writeBigUInt64LE(runId);
  pda("run-high-u64", [Buffer.from("run"), Buffer.from("active"), owner.toBytes(), runBytes], activeRun);
  pda("session", [Buffer.from("session_token_v2"), ZKUBE_PROGRAM_ID.toBytes(), device.toBytes(), owner.toBytes()], sessionToken, SESSION_KEYS_PROGRAM_ID);

  const sessionData = Buffer.concat([Buffer.from(SESSION_TOKEN_V2_DISCRIMINATOR), owner.toBuffer(),
    ZKUBE_PROGRAM_ID.toBuffer(), device.toBuffer(), owner.toBuffer(), Buffer.alloc(8)]);
  sessionData.writeBigInt64LE(BigInt(nowUnix + 604800), 136);
  const envelope = { owner: SESSION_KEYS_PROGRAM_ID, executable: false, lamports: 1000000, rentEpoch: 0, data: sessionData };
  const accounts: object[] = [];
  for (const mutation of ["valid", "short", "long", "wrong-owner", "executable", "discriminator", "wrong-address", "expiry-overflow"]) {
    const info = { ...envelope, data: Buffer.from(sessionData) };
    let address = sessionToken;
    if (mutation === "short") info.data = info.data.subarray(0, 143);
    if (mutation === "long") info.data = Buffer.concat([info.data, Buffer.from([0])]);
    if (mutation === "wrong-owner") info.owner = SystemProgram.programId;
    if (mutation === "executable") info.executable = true;
    if (mutation === "discriminator") info.data[0] ^= 1;
    if (mutation === "wrong-address") address = owner;
    if (mutation === "expiry-overflow") info.data.writeBigInt64LE(9223372036854775807n, 136);
    let decoded: unknown = null; let error: string | null = null;
    try { decoded = normalized(decodeSessionTokenV2Account(address, info)); } catch (cause) { error = (cause as Error).message; }
    accounts.push({ id: `session-${mutation}`, kind: "session_token_v2", address: address.toBase58(),
      owner: info.owner.toBase58(), executable: info.executable, data: info.data.toString("base64"), decoded, error });
  }

  const signed = new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash,
    instructions: withPinnedWalletComputeBudget([SystemProgram.transfer({ fromPubkey: device, toPubkey: owner, lamports: 0 })]),
  }).compileToV0Message());
  signed.sign([deviceKey]);
  const before = Buffer.from(signed.serialize()).toString("base64");
  signed.sign([ownerKey]);
  const valid = Buffer.from(signed.serialize()).toString("base64");
  const forged = VersionedTransaction.deserialize(signed.serialize()); forged.signatures[0] = new Uint8Array(64).fill(3);
  const discarded = VersionedTransaction.deserialize(signed.serialize()); discarded.signatures[1] = new Uint8Array(64);
  const mutated = VersionedTransaction.deserialize(signed.serialize()); mutated.message.recentBlockhash = owner.toBase58();
  const walletCases = [
    { id: "valid", output: valid, accept: true },
    { id: "forged-nonzero-owner", output: Buffer.from(forged.serialize()).toString("base64"), accept: false },
    { id: "discarded-partial", output: Buffer.from(discarded.serialize()).toString("base64"), accept: false },
    { id: "mutated-message", output: Buffer.from(mutated.serialize()).toString("base64"), accept: false },
  ].map((entry) => ({ ...entry, before, owner: owner.toBase58() }));
  for (const invalidPartial of ["missing", "forged"] as const) {
    const original = VersionedTransaction.deserialize(Buffer.from(before, "base64"));
    original.signatures[1] = new Uint8Array(64).fill(invalidPartial === "missing" ? 0 : 3);
    walletCases.push({ id: `${invalidPartial}-partial-before-wallet`, before: Buffer.from(original.serialize()).toString("base64"),
      owner: owner.toBase58(), output: valid, accept: false });
  }
  const sourcePaths = ["client/pnpm-lock.yaml", "client/src/backend/solana/idl/solana.json",
    "client/src/backend/solana/pdas.ts", "client/src/backend/solana/runs/runPlan.ts",
    "client/src/backend/solana/content/dailyClient.ts", "client/src/backend/solana/session/sessionV2.ts",
    "client/tools/unity/solana-fixtures.ts", "client/tools/unity/recovery-fixtures.ts",
    "client/src/backend/solana/runs/resumeRun.ts", "client/tools/unity/account-fixtures.ts",
    "client/src/backend/solana/content/campaignClient.ts", "client/src/core/protocolVersions.generated.ts",
    "client/src/core/dailyRules.ts", "client/src/core/dailyRules.generated.ts",
    "client/src/core/generated/zkube_core_bg.wasm"];
  // This initializes the actual Rust WASM boundary, also used for account states.
  const nativeAccounts = await generateAccountFixtures(ownerKey, deviceKey, nowUnix);
  const dailyPublication = dailyContentFromPairIndex(dayId, await coreDailyPairIndex(dayId));
  return { schemaVersion: 1, provenance: Object.fromEntries(sourcePaths.map((path) => [path,
    createHash("sha256").update(readFileSync(resolve(repositoryRoot, path))).digest("hex")])),
  inputs: { nowUnix, dayId, runId: runId.toString(), owner: owner.toBase58(), device: device.toBase58(), blockhash,
    programId: ZKUBE_PROGRAM_ID.toBase58(), delegationProgramId: DELEGATION_PROGRAM_ID.toBase58() },
  dailyAuthority: { day: dayId, pairIndex: dailyPublication.pairIndex, realm: dailyPublication.realmMapId,
    objective: dailyPublication.objective, contentVersion: CATALOG_VERSION, maxMoves: DAILY_MAX_MOVES },
  pdas: pdaCases, transactions, accounts: [...accounts, ...nativeAccounts], walletCases, walletSignature: bs58.encode(signed.signatures[0]),
  recovery: await generateRecoveryFixtures(nowUnix, ownerKey, deviceKey) };
}

export function generatedIdl(): string { return canonicalJson(IDL); }

export function generatedSession(): string {
  return canonicalJson({ programId: SESSION_KEYS_PROGRAM_ID.toBase58(), accountBytes: SESSION_TOKEN_V2_ACCOUNT_BYTES,
    accountDiscriminator: SESSION_TOKEN_V2_DISCRIMINATOR, createDiscriminator: CREATE_SESSION_V2_DISCRIMINATOR });
}
