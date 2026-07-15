import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  devnetDeploymentInputFromEnv,
  inspectUpgradeableProgram,
} from "./deploymentRunner.js";

const PROGRAM_DATA_HEADER_BYTES = 45;
const EXTENSION_FEE_HEADROOM_LAMPORTS = 5_000_000;
// SIMD-0431 rejects smaller increments on the current Devnet runtime. Asking
// for the loader minimum is safe on older runtimes and leaves modest headroom
// for the next program build.
export const MINIMUM_EXTEND_PROGRAM_BYTES = 10_240;
const MAX_PROGRAM_DATA_BYTES = 10 * 1024 * 1024;
const UPGRADEABLE_LOADER_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const EXTEND_PROGRAM_CHECKED_FEATURE_ID = new PublicKey(
  "2oMRZEDWT2tqtYMofhmmfQ8SsjqUFzT6sYXppQDavxwz",
);
const LEGACY_EXTEND_PROGRAM_VARIANT = 6;

export interface ProgramExtensionInput {
  cluster: "devnet";
  baseRpc: string;
  expectedGenesisHash: string;
  programId: string;
  programDataAddress: string;
  artifactPath: string;
  artifactSha256: string;
  artifactBytes: number;
  currentCapacityBytes: number;
  targetCapacityBytes: number;
  additionalBytes: number;
  additionalRentLamports: number;
  maximumFeeLamports: number;
  maximumPayerSpendLamports: number;
  authorizationMode: "legacy-payer-only";
  checkedExtensionFeatureId: string;
  checkedExtensionFeatureActive: false;
  payerKeypairPath?: string;
  payerPublicKey?: string;
  upgradeAuthorityPublicKey: string;
  approvalFingerprint: string;
  sendEnabled: boolean;
  suppliedApproval?: string;
}

export interface ProgramExtensionResult {
  mode: "dry-run" | "extended" | "not-required";
  input: ProgramExtensionInput;
  signature?: string;
}

export async function programExtensionInputFromEnv(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): Promise<ProgramExtensionInput> {
  const deployment = devnetDeploymentInputFromEnv(env, cwd);
  if (deployment.deploymentMode !== "upgrade") {
    throw new Error(
      "ProgramData extension applies only to an existing upgradeable program",
    );
  }
  const connection = new Connection(deployment.baseRpc, "confirmed");
  const genesisHash = await connection.getGenesisHash();
  if (genesisHash !== deployment.expectedGenesisHash) {
    throw new Error(`Devnet genesis mismatch: received ${genesisHash}`);
  }
  const state = await inspectUpgradeableProgram(
    connection,
    new PublicKey(deployment.programId),
  );
  if (!state.upgradeAuthority) {
    throw new Error("deployed program is immutable and cannot be extended");
  }
  const checkedExtensionFeature = await connection.getAccountInfo(
    EXTEND_PROGRAM_CHECKED_FEATURE_ID,
    "confirmed",
  );
  if (checkedExtensionFeature) {
    throw new Error(
      "ExtendProgramChecked is active; this planner only accepts the pinned legacy payer-only Devnet instruction",
    );
  }
  const artifactBytes = readFileSync(deployment.artifactPath).byteLength;
  const additionalBytes = plannedProgramExtensionBytes(
    state.programCapacityBytes,
    artifactBytes,
  );
  const targetCapacityBytes = state.programCapacityBytes + additionalBytes;
  const requiredRent = await connection.getMinimumBalanceForRentExemption(
    targetCapacityBytes + PROGRAM_DATA_HEADER_BYTES,
    "confirmed",
  );
  const additionalRentLamports = Math.max(
    0,
    requiredRent - state.programDataLamports,
  );
  const payerPublicKey =
    deployment.deployerPublicKey ??
    optionalPublicKey(
      env.ZKUBE_EXTENSION_PAYER_PUBLIC_KEY,
      "ZKUBE_EXTENSION_PAYER_PUBLIC_KEY",
    );
  const maximumPayerSpendLamports =
    additionalRentLamports + EXTENSION_FEE_HEADROOM_LAMPORTS;
  const approvalPayload = {
    operation: "extend-upgradeable-program-data",
    cluster: deployment.cluster,
    baseRpc: deployment.baseRpc,
    expectedGenesisHash: deployment.expectedGenesisHash,
    programId: deployment.programId,
    programDataAddress: state.programDataAddress.toBase58(),
    artifactSha256: deployment.artifactSha256,
    artifactBytes,
    currentCapacityBytes: state.programCapacityBytes,
    targetCapacityBytes,
    additionalBytes,
    additionalRentLamports,
    maximumFeeLamports: EXTENSION_FEE_HEADROOM_LAMPORTS,
    maximumPayerSpendLamports,
    authorizationMode: "legacy-payer-only",
    checkedExtensionFeatureId: EXTEND_PROGRAM_CHECKED_FEATURE_ID.toBase58(),
    checkedExtensionFeatureActive: false,
    instruction:
      additionalBytes === 0
        ? null
        : {
            programId: UPGRADEABLE_LOADER_ID.toBase58(),
            dataHex: legacyExtendProgramData(additionalBytes).toString("hex"),
            accounts: [
              {
                publicKey: state.programDataAddress.toBase58(),
                writable: true,
                signer: false,
              },
              {
                publicKey: deployment.programId,
                writable: true,
                signer: false,
              },
              {
                publicKey: SystemProgram.programId.toBase58(),
                writable: false,
                signer: false,
              },
              {
                publicKey: payerPublicKey ?? null,
                writable: true,
                signer: true,
              },
            ],
          },
    payerPublicKey: payerPublicKey ?? null,
    upgradeAuthorityPublicKey: state.upgradeAuthority,
    preflightSkipping: false,
    signatureVerifiedSimulation: true,
  };
  return {
    cluster: "devnet",
    baseRpc: deployment.baseRpc,
    expectedGenesisHash: deployment.expectedGenesisHash,
    programId: deployment.programId,
    programDataAddress: state.programDataAddress.toBase58(),
    artifactPath: deployment.artifactPath,
    artifactSha256: deployment.artifactSha256,
    artifactBytes,
    currentCapacityBytes: state.programCapacityBytes,
    targetCapacityBytes,
    additionalBytes,
    additionalRentLamports,
    maximumFeeLamports: EXTENSION_FEE_HEADROOM_LAMPORTS,
    maximumPayerSpendLamports,
    authorizationMode: "legacy-payer-only",
    checkedExtensionFeatureId: EXTEND_PROGRAM_CHECKED_FEATURE_ID.toBase58(),
    checkedExtensionFeatureActive: false,
    payerKeypairPath: deployment.deployerKeypairPath,
    payerPublicKey,
    upgradeAuthorityPublicKey: state.upgradeAuthority,
    approvalFingerprint: createHash("sha256")
      .update(JSON.stringify(approvalPayload))
      .digest("hex")
      .slice(0, 16),
    sendEnabled: env.ZKUBE_EXTEND_PROGRAM === "1",
    suppliedApproval: env.ZKUBE_EXTEND_APPROVAL?.trim() || undefined,
  };
}

export async function runProgramExtension(
  input: ProgramExtensionInput,
): Promise<ProgramExtensionResult> {
  if (input.additionalBytes === 0) return { mode: "not-required", input };
  if (!input.sendEnabled) return { mode: "dry-run", input };
  if (input.suppliedApproval !== input.approvalFingerprint) {
    throw new Error(
      `extension blocked: set ZKUBE_EXTEND_APPROVAL=${input.approvalFingerprint} after explicit approval`,
    );
  }
  if (!input.payerKeypairPath || !input.payerPublicKey) {
    throw new Error(
      "ZKUBE_DEPLOYER_KEYPAIR is required to pay for ProgramData extension",
    );
  }

  const connection = new Connection(input.baseRpc, "confirmed");
  const genesisHash = await connection.getGenesisHash();
  if (genesisHash !== input.expectedGenesisHash) {
    throw new Error(`Devnet genesis mismatch: received ${genesisHash}`);
  }
  const checkedExtensionFeature = await connection.getAccountInfo(
    new PublicKey(input.checkedExtensionFeatureId),
    "confirmed",
  );
  if (checkedExtensionFeature) {
    throw new Error(
      "ExtendProgramChecked activated after approval; regenerate an authority-signed extension scope",
    );
  }
  const state = await inspectUpgradeableProgram(
    connection,
    new PublicKey(input.programId),
  );
  if (
    state.programDataAddress.toBase58() !== input.programDataAddress ||
    state.programCapacityBytes !== input.currentCapacityBytes
  ) {
    throw new Error("live ProgramData allocation changed after approval");
  }
  if (state.upgradeAuthority !== input.upgradeAuthorityPublicKey) {
    throw new Error(
      "live ProgramData upgrade authority changed after approval",
    );
  }
  const artifact = readFileSync(input.artifactPath);
  if (
    artifact.byteLength !== input.artifactBytes ||
    createHash("sha256").update(artifact).digest("hex") !== input.artifactSha256
  ) {
    throw new Error("approved program artifact changed");
  }
  const requiredRent = await connection.getMinimumBalanceForRentExemption(
    input.targetCapacityBytes + PROGRAM_DATA_HEADER_BYTES,
    "confirmed",
  );
  const additionalRent = Math.max(0, requiredRent - state.programDataLamports);
  if (additionalRent !== input.additionalRentLamports) {
    throw new Error("live ProgramData rent changed after approval");
  }
  const payerBalance = await connection.getBalance(
    new PublicKey(input.payerPublicKey),
    "confirmed",
  );
  if (payerBalance < input.maximumPayerSpendLamports) {
    throw new Error(
      `extension payer balance ${payerBalance} is below required floor ${input.maximumPayerSpendLamports}`,
    );
  }
  const payer = keypairFromFile(input.payerKeypairPath);
  if (payer.publicKey.toBase58() !== input.payerPublicKey) {
    throw new Error("extension payer keypair changed after approval");
  }
  const instruction = legacyExtendProgramInstruction({
    programId: new PublicKey(input.programId),
    programDataAddress: new PublicKey(input.programDataAddress),
    payer: payer.publicKey,
    additionalBytes: input.additionalBytes,
  });
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [instruction],
  }).compileToV0Message();
  if (
    message.header.numRequiredSignatures !== 1 ||
    !message.staticAccountKeys[0]?.equals(payer.publicKey)
  ) {
    throw new Error("extension transaction signer layout is not payer-only");
  }
  const fee = await connection.getFeeForMessage(message, "confirmed");
  if (fee.value === null) {
    throw new Error("unable to estimate ProgramData extension transaction fee");
  }
  if (fee.value > input.maximumFeeLamports) {
    throw new Error(
      `extension fee ${fee.value} exceeds approved ceiling ${input.maximumFeeLamports}`,
    );
  }
  const transaction = new VersionedTransaction(message);
  transaction.sign([payer]);
  const simulation = await connection.simulateTransaction(transaction, {
    commitment: "confirmed",
    replaceRecentBlockhash: false,
    sigVerify: true,
  });
  if (simulation.value.err) {
    throw new Error(
      `ProgramData extension simulation failed: ${JSON.stringify(simulation.value.err)}`,
    );
  }
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    {
      maxRetries: 5,
      preflightCommitment: "confirmed",
      skipPreflight: false,
    },
  );
  const confirmation = await connection.confirmTransaction(
    { signature, ...latestBlockhash },
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error(
      `ProgramData extension transaction failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }
  const verified = await inspectUpgradeableProgram(
    connection,
    new PublicKey(input.programId),
  );
  if (
    verified.programDataAddress.toBase58() !== input.programDataAddress ||
    verified.programCapacityBytes !== input.targetCapacityBytes ||
    verified.upgradeAuthority !== input.upgradeAuthorityPublicKey
  ) {
    throw new Error("ProgramData extension postcondition verification failed");
  }
  return {
    mode: "extended",
    input,
    signature,
  };
}

export function legacyExtendProgramInstruction(input: {
  programId: PublicKey;
  programDataAddress: PublicKey;
  payer: PublicKey;
  additionalBytes: number;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: UPGRADEABLE_LOADER_ID,
    data: legacyExtendProgramData(input.additionalBytes),
    keys: [
      { pubkey: input.programDataAddress, isWritable: true, isSigner: false },
      { pubkey: input.programId, isWritable: true, isSigner: false },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
      { pubkey: input.payer, isWritable: true, isSigner: true },
    ],
  });
}

export function plannedProgramExtensionBytes(
  currentCapacityBytes: number,
  artifactBytes: number,
): number {
  if (
    !Number.isSafeInteger(currentCapacityBytes) ||
    !Number.isSafeInteger(artifactBytes) ||
    currentCapacityBytes < 0 ||
    artifactBytes < 0 ||
    currentCapacityBytes > MAX_PROGRAM_DATA_BYTES ||
    artifactBytes > MAX_PROGRAM_DATA_BYTES
  ) {
    throw new Error("ProgramData capacity must fit the loader's 10 MiB limit");
  }
  const required = Math.max(0, artifactBytes - currentCapacityBytes);
  if (required === 0) return 0;
  const additionalBytes = Math.max(required, MINIMUM_EXTEND_PROGRAM_BYTES);
  if (currentCapacityBytes + additionalBytes > MAX_PROGRAM_DATA_BYTES) {
    throw new Error("ProgramData extension exceeds the loader's 10 MiB limit");
  }
  return additionalBytes;
}

export function legacyExtendProgramData(additionalBytes: number): Buffer {
  if (
    !Number.isSafeInteger(additionalBytes) ||
    additionalBytes <= 0 ||
    additionalBytes > 0xffff_ffff
  ) {
    throw new Error("additional ProgramData bytes must fit a positive u32");
  }
  const data = Buffer.alloc(8);
  data.writeUInt32LE(LEGACY_EXTEND_PROGRAM_VARIANT, 0);
  data.writeUInt32LE(additionalBytes, 4);
  return data;
}

export function formatProgramExtension(result: ProgramExtensionResult): string {
  const { input } = result;
  const executable = Boolean(input.payerKeypairPath && input.payerPublicKey);
  return [
    "zKube Devnet ProgramData extension",
    `Mode: ${result.mode}`,
    `Base RPC: ${input.baseRpc}`,
    `Program: ${input.programId}`,
    `ProgramData: ${input.programDataAddress}`,
    `SBF SHA-256: ${input.artifactSha256}`,
    `Current capacity: ${input.currentCapacityBytes} bytes`,
    `Target artifact: ${input.artifactBytes} bytes`,
    `Target capacity: ${input.targetCapacityBytes} bytes`,
    `Additional allocation: ${input.additionalBytes} bytes`,
    `Additional rent: ${input.additionalRentLamports} lamports`,
    `Maximum transaction fee: ${input.maximumFeeLamports} lamports`,
    `Maximum payer spend: ${input.maximumPayerSpendLamports} lamports`,
    `Authorization: ${input.authorizationMode}`,
    `ExtendProgramChecked feature: inactive (${input.checkedExtensionFeatureId})`,
    `Payer: ${input.payerPublicKey ?? "missing"}`,
    `Upgrade authority (preserved, not a signer): ${input.upgradeAuthorityPublicKey}`,
    `Approval fingerprint: ${input.approvalFingerprint}`,
    `Executable plan: ${executable ? "yes" : "no"}`,
    "Preflight skipping: disabled",
    ...(result.signature ? [`Extension signature: ${result.signature}`] : []),
    ...(result.mode === "dry-run"
      ? executable
        ? [
            "No transaction was signed or sent.",
            "Set ZKUBE_EXTEND_PROGRAM=1 only after approval of this exact fingerprint.",
          ]
        : [
            "No transaction was signed or sent.",
            "Candidate only: required signer identity is missing. Do not approve this fingerprint.",
          ]
      : []),
  ].join("\n");
}

function keypairFromFile(path: string): Keypair {
  let source: unknown;
  try {
    source = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read extension payer keypair: ${(error as Error).message}`,
    );
  }
  if (
    !Array.isArray(source) ||
    source.length !== 64 ||
    !source.every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 255,
    )
  ) {
    throw new Error(
      "extension payer must be a Solana 64-byte keypair JSON array",
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(source as number[]));
}

function optionalPublicKey(
  value: string | undefined,
  label: string,
): string | undefined {
  const publicKey = value?.trim();
  if (!publicKey) return undefined;
  try {
    return new PublicKey(publicKey).toBase58();
  } catch {
    throw new Error(`${label} must be a valid Solana public key`);
  }
}
