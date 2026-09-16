import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import { buildSetArenaSuspensionPlan } from "./adminClient.js";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants.js";
import { inspectUpgradeableProgram } from "./deploymentRunner.js";
import { executeApprovedTransaction, loadPinnedKeypair } from "./launchRunner.js";
import { publicLaunchPlan } from "./launchPlanner.js";
import { deriveProtocolConfigPda } from "./pdas.js";
import { zkubeProgram } from "./program.js";
import { createReadOnlyWallet } from "./readOnlyWallet.js";
import { PROTOCOL_ACCOUNT_VERSION } from "../../services/src/protocolVersions.generated.js";

interface SuspensionInput {
  rpc: string;
  authority: string;
  deployedProgramDataSha256: string;
  untilDay: number;
}

const MAXIMUM_FEE_LAMPORTS = 10_000;
const RESERVE_LAMPORTS = 100_000_000;
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function planSuspension(connection: Connection, input: SuspensionInput) {
  if (new URL(input.rpc).protocol !== "https:" ||
      !/^[0-9a-f]{64}$/.test(input.deployedProgramDataSha256) ||
      !Number.isSafeInteger(input.untilDay) || input.untilDay < 0 || input.untilDay > 0xffff_ffff) {
    throw new Error("Suspension requires HTTPS, a deployed program hash and a u32 day");
  }
  if (await connection.getGenesisHash() !== SOLANA_DEVNET_GENESIS_HASH) {
    throw new Error("Suspension is restricted to Devnet");
  }
  const deployed = await inspectUpgradeableProgram(connection, ZKUBE_PROGRAM_ID);
  if (deployed.deployedSbfSha256 !== input.deployedProgramDataSha256) {
    throw new Error("Deployed program differs from the suspension release input");
  }
  const authority = createReadOnlyWallet(new PublicKey(input.authority));
  const program = zkubeProgram(connection, authority);
  const info = await connection.getAccountInfo(deriveProtocolConfigPda(), "confirmed");
  if (!info || !info.owner.equals(ZKUBE_PROGRAM_ID) || info.data.length > 1024) {
    throw new Error("Suspension protocol account is missing or malformed");
  }
  const protocol = program.coder.accounts.decode("protocolConfig", info.data);
  if (protocol.version !== PROTOCOL_ACCOUNT_VERSION || !protocol.authority.equals(authority.publicKey)) {
    throw new Error("Suspension authority or protocol version differs from the release input");
  }
  const plan = await buildSetArenaSuspensionPlan({ connection, authority, untilDay: input.untilDay });
  const latest = await connection.getLatestBlockhash("confirmed");
  plan.transaction.feePayer = authority.publicKey;
  plan.transaction.recentBlockhash = latest.blockhash;
  const fee = await connection.getFeeForMessage(plan.transaction.compileMessage(), "confirmed");
  if (fee.value === null || !Number.isSafeInteger(fee.value) || fee.value < 0 || fee.value > MAXIMUM_FEE_LAMPORTS ||
      await connection.getBalance(authority.publicKey, "confirmed") < RESERVE_LAMPORTS + MAXIMUM_FEE_LAMPORTS) {
    throw new Error("Suspension fee or authority reserve exceeds the approved bounds");
  }
  const payload = {
    schema: "zkube-devnet-suspension-v1", input,
    genesis: SOLANA_DEVNET_GENESIS_HASH, program: ZKUBE_PROGRAM_ID.toBase58(),
    maximumFeeLamports: MAXIMUM_FEE_LAMPORTS, reserveLamports: RESERVE_LAMPORTS,
    transaction: publicLaunchPlan(plan),
  };
  return { plan, payload, fingerprint: fingerprint(payload) };
}

type Receipt = Awaited<ReturnType<typeof executeApprovedTransaction>>;
interface Bundle {
  payload: Awaited<ReturnType<typeof planSuspension>>["payload"];
  fingerprint: string;
  receipt?: Receipt;
}

export async function runSuspension(mode: string, env: Record<string, string | undefined>) {
  const path = env.ZKUBE_SUSPENSION_BUNDLE ?? fileURLToPath(new URL("../../build/chain/suspension.json", import.meta.url));
  const save = (bundle: Bundle) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path + ".tmp", JSON.stringify(bundle, null, 2) + "\n");
    renameSync(path + ".tmp", path);
  };
  if (mode === "plan") {
    if (existsSync(path)) throw new Error("Suspension bundle already exists; execute it or select a fresh path");
    const input = {
      rpc: required(env, "SOLANA_DEVNET_RPC_URL"),
      authority: required(env, "ZKUBE_PROTOCOL_AUTHORITY"),
      deployedProgramDataSha256: required(env, "ZKUBE_DEPLOYED_SBF_SHA256"),
      untilDay: Number(required(env, "ZKUBE_SUSPENSION_UNTIL_DAY")),
    };
    const planned = await planSuspension(new Connection(input.rpc, "confirmed"), input);
    save({ payload: planned.payload, fingerprint: planned.fingerprint });
    return { bundle: path, fingerprint: planned.fingerprint };
  }
  if (mode !== "execute") throw new Error("Suspension mode is plan or execute");
  const bundle: Bundle = JSON.parse(readFileSync(path, "utf8"));
  if (bundle.payload?.schema !== "zkube-devnet-suspension-v1" ||
      !/^[0-9a-f]{64}$/.test(bundle.fingerprint) || fingerprint(bundle.payload) !== bundle.fingerprint ||
      env.ZKUBE_APPROVAL !== bundle.fingerprint) {
    throw new Error("Suspension requires the exact approved fingerprint before loading a signer");
  }
  const planned = await planSuspension(new Connection(bundle.payload.input.rpc, "confirmed"), bundle.payload.input);
  if (planned.fingerprint !== bundle.fingerprint) throw new Error("Suspension plan changed after approval");
  const signer = loadPinnedKeypair(required(env, "ZKUBE_PROTOCOL_AUTHORITY_KEYPAIR"), bundle.payload.input.authority, "protocol authority");
  const receipt = await executeApprovedTransaction({ plan: planned.plan, signer, existing: bundle.receipt,
    onReceipt: receipt => { bundle.receipt = receipt; save(bundle); } });
  return { bundle: path, fingerprint: bundle.fingerprint, signature: receipt.signature };
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}
