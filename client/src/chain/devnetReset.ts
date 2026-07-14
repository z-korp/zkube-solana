import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type TransactionInstruction,
} from "@solana/web3.js";
import { DEPLOYED_ZKUBE_SBF_SHA256 } from "./devnetBootstrap";
import { deriveProtocolConfigPda } from "./pdas";
import { SessionWallet } from "./sessionWallet";
import { zkubeProgram } from "./runPlan";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants";

const LEGACY_PROTOCOL_BYTES = 433;
const LEGACY_PROTOCOL_DISCRIMINATOR = Buffer.from([
  207, 91, 250, 28, 152, 179, 215, 209,
]);
const LEGACY_AUTHORITY_OFFSET = 9;
const LEGACY_PAYMASTER_OFFSET = 73;
const RESET_BATCH_SIZE = 16;
const DEFAULT_RESET_RPC = "https://rpc.magicblock.app/devnet";

interface ResetIdentity {
  funder: Keypair;
  authority: Keypair;
}

interface ResetAccountSnapshot {
  address: string;
  dataBytes: number;
  lamports: number;
  dataSha256: string;
}

interface ResetBatch {
  id: string;
  closeProtocol: boolean;
  accounts: ResetAccountSnapshot[];
  instruction: TransactionInstruction;
}

export interface PublicResetBatch {
  id: string;
  closeProtocol: boolean;
  accounts: ResetAccountSnapshot[];
  reclaimedLamports: number;
  instructionDataSha256: string;
  requiredSigners: string[];
}

export interface PublicDevnetResetPlan {
  schema: "zkube-legacy-devnet-reset-plan";
  schemaVersion: 1;
  cluster: "devnet";
  rpc: string;
  genesisHash: string;
  program: string;
  reviewedSbfSha256: string;
  legacyProtocol: string;
  funder: string;
  legacyAuthority: string;
  rentRecipient: string;
  accountCount: number;
  reclaimableLamports: number;
  accounts: ResetAccountSnapshot[];
  batches: PublicResetBatch[];
  policy: {
    legacyProtocolBytes: number;
    maximumAccountsPerBatch: number;
    skipPreflight: false;
  };
}

export interface DevnetResetInput {
  connection: Connection;
  rpc: string;
  identities: ResetIdentity;
  sendEnabled: boolean;
  suppliedApproval?: string;
  candidateOut?: string;
  proofOut?: string;
}

export interface DevnetResetResult {
  input: DevnetResetInput;
  plan: PublicDevnetResetPlan;
  fingerprint: string;
  simulations: Array<{
    id: string;
    unitsConsumed: number | null;
    feeLamports: number;
  }>;
  signatures: string[];
}

export function devnetResetInputFromEnv(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): DevnetResetInput {
  const rpc = devnetRpc(env.ZKUBE_BASE_RPC ?? DEFAULT_RESET_RPC);
  return {
    connection: new Connection(rpc, "confirmed"),
    rpc,
    identities: {
      funder: loadKeypair(
        resolve(
          cwd,
          env.ZKUBE_RESET_FUNDER_KEYPAIR ??
            "../../cycling-sim/.devnet/deployer.json",
        ),
        "reset funder",
      ),
      authority: loadKeypair(
        resolve(
          cwd,
          env.ZKUBE_RESET_AUTHORITY_KEYPAIR ??
            "../.devnet/zkube-governance-authority.json",
        ),
        "legacy authority",
      ),
    },
    sendEnabled: env.ZKUBE_RESET_SEND === "1",
    suppliedApproval: env.ZKUBE_RESET_APPROVAL?.trim() || undefined,
    candidateOut:
      env.ZKUBE_RESET_CANDIDATE_OUT?.trim() ||
      resolve(cwd, "../artifacts/devnet-reset.candidate.json"),
    proofOut: env.ZKUBE_RESET_PROOF_OUT?.trim() || undefined,
  };
}

export async function runDevnetReset(
  input: DevnetResetInput,
): Promise<DevnetResetResult> {
  await verifyDeployment(input);
  const inventory = await fetchInventory(input.connection);
  const { authority, paymaster } = await legacyProtocolIdentities(
    input.connection,
    inventory,
  );
  if (!authority.equals(input.identities.authority.publicKey)) {
    throw new Error(
      `legacy authority ${authority.toBase58()} does not match the configured reset authority`,
    );
  }
  const batches = await buildBatches(input, inventory, paymaster);
  const plan = publicPlan(input, inventory, paymaster, batches);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(plan))
    .digest("hex")
    .slice(0, 16);
  const simulations = await simulateBatches(input, batches);
  const signatures: string[] = [];

  if (input.sendEnabled) {
    if (input.suppliedApproval !== fingerprint) {
      throw new Error(
        `reset blocked: set ZKUBE_RESET_APPROVAL=${fingerprint} only after explicit approval`,
      );
    }
    let remaining = inventory;
    for (const batch of batches) {
      await verifySnapshot(input.connection, remaining);
      signatures.push(await executeBatch(input, batch));
      const closed = new Set(batch.accounts.map((account) => account.address));
      if (batch.closeProtocol) {
        closed.add(deriveProtocolConfigPda().toBase58());
      }
      remaining = remaining.filter((account) => !closed.has(account.address));
    }
    const residual = await input.connection.getProgramAccounts(
      ZKUBE_PROGRAM_ID,
      { commitment: "confirmed", dataSlice: { offset: 0, length: 0 } },
    );
    if (residual.length !== 0) {
      throw new Error(
        `legacy reset postcondition failed: ${residual.length} program accounts remain`,
      );
    }
  }

  const result = { input, plan, fingerprint, simulations, signatures };
  if (input.candidateOut) writeCandidate(input.candidateOut, result);
  if (input.proofOut && signatures.length > 0) {
    writeProof(input.proofOut, result);
  }
  return result;
}

export function formatDevnetReset(result: DevnetResetResult): string {
  return [
    "zKube legacy Devnet reset",
    `Mode: ${result.signatures.length > 0 ? "executed" : "dry-run"}`,
    `RPC: ${result.plan.rpc}`,
    `Program: ${result.plan.program}`,
    `Legacy protocol: ${result.plan.legacyProtocol}`,
    `Legacy authority: ${result.plan.legacyAuthority}`,
    `Rent recipient: ${result.plan.rentRecipient}`,
    `Accounts closed: ${result.plan.accountCount}`,
    `Rent reclaimed: ${result.plan.reclaimableLamports} lamports`,
    `Approval fingerprint: ${result.fingerprint}`,
    ...result.plan.batches.map((batch, index) => {
      const simulation = result.simulations[index];
      return [
        `[${result.signatures.length > 0 ? "executed" : "simulated"}] ${batch.id}`,
        `  accounts: ${batch.accounts.length + Number(batch.closeProtocol)}`,
        `  reclaimed: ${batch.reclaimedLamports} lamports`,
        `  close protocol: ${batch.closeProtocol ? "yes" : "no"}`,
        `  estimated fee: ${simulation?.feeLamports ?? "unknown"} lamports`,
        `  units consumed: ${simulation?.unitsConsumed ?? "unknown"}`,
        ...(result.signatures[index]
          ? [`  signature: ${result.signatures[index]}`]
          : []),
      ].join("\n");
    }),
    ...(result.signatures.length === 0
      ? [
          "No transaction was signed or sent.",
          `To execute only after approval: ZKUBE_RESET_SEND=1 ZKUBE_RESET_APPROVAL=${result.fingerprint}`,
        ]
      : []),
  ].join("\n");
}

async function verifyDeployment(input: DevnetResetInput): Promise<void> {
  const [genesis, program] = await Promise.all([
    input.connection.getGenesisHash(),
    input.connection.getAccountInfo(ZKUBE_PROGRAM_ID, "confirmed"),
  ]);
  if (genesis !== SOLANA_DEVNET_GENESIS_HASH) {
    throw new Error(`Devnet genesis mismatch: received ${genesis}`);
  }
  if (!program?.executable || program.data.length < 36) {
    throw new Error("deployed zKube program is missing or malformed");
  }
  const programDataAddress = new PublicKey(program.data.subarray(4, 36));
  const programData = await input.connection.getAccountInfo(
    programDataAddress,
    "confirmed",
  );
  if (!programData || programData.data.length < 45) {
    throw new Error("deployed zKube ProgramData is missing or malformed");
  }
  const codeOffset = programData.data[12] === 1 ? 45 : 13;
  const hash = sha256(programData.data.subarray(codeOffset));
  if (hash !== DEPLOYED_ZKUBE_SBF_SHA256) {
    throw new Error(
      `deployed zKube SBF hash ${hash} does not match the reset release`,
    );
  }
}

async function fetchInventory(
  connection: Connection,
): Promise<ResetAccountSnapshot[]> {
  const accounts = await connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
    commitment: "confirmed",
  });
  return accounts
    .map(({ pubkey, account }) => snapshot(pubkey, account))
    .sort((left, right) => left.address.localeCompare(right.address));
}

function snapshot(
  pubkey: PublicKey,
  account: AccountInfo<Buffer>,
): ResetAccountSnapshot {
  if (!account.owner.equals(ZKUBE_PROGRAM_ID)) {
    throw new Error(`account ${pubkey.toBase58()} is not owned by zKube`);
  }
  return {
    address: pubkey.toBase58(),
    dataBytes: account.data.length,
    lamports: account.lamports,
    dataSha256: sha256(account.data),
  };
}

async function legacyProtocolIdentities(
  connection: Connection,
  inventory: ResetAccountSnapshot[],
): Promise<{
  authority: PublicKey;
  paymaster: PublicKey;
}> {
  const address = deriveProtocolConfigPda();
  const protocol = inventory.find(
    (account) => account.address === address.toBase58(),
  );
  if (!protocol || protocol.dataBytes !== LEGACY_PROTOCOL_BYTES) {
    throw new Error("exact legacy 433-byte ProtocolConfig is not present");
  }
  const account = await connection.getAccountInfo(address, "confirmed");
  if (
    !account?.owner.equals(ZKUBE_PROGRAM_ID) ||
    account.data.length !== LEGACY_PROTOCOL_BYTES ||
    sha256(account.data) !== protocol.dataSha256 ||
    !account.data.subarray(0, 8).equals(LEGACY_PROTOCOL_DISCRIMINATOR) ||
    account.data[8] !== 1
  ) {
    throw new Error("legacy ProtocolConfig bytes changed or are malformed");
  }
  return {
    authority: new PublicKey(
      account.data.subarray(
        LEGACY_AUTHORITY_OFFSET,
        LEGACY_AUTHORITY_OFFSET + 32,
      ),
    ),
    paymaster: new PublicKey(
      account.data.subarray(
        LEGACY_PAYMASTER_OFFSET,
        LEGACY_PAYMASTER_OFFSET + 32,
      ),
    ),
  };
}

async function buildBatches(
  input: DevnetResetInput,
  inventory: ResetAccountSnapshot[],
  paymaster: PublicKey,
): Promise<ResetBatch[]> {
  const protocol = deriveProtocolConfigPda().toBase58();
  const targets = inventory.filter((account) => account.address !== protocol);
  const chunks: ResetAccountSnapshot[][] = [];
  for (let offset = 0; offset < targets.length; offset += RESET_BATCH_SIZE) {
    chunks.push(targets.slice(offset, offset + RESET_BATCH_SIZE));
  }
  if (chunks.length === 0) chunks.push([]);
  const program = zkubeProgram(
    input.connection,
    new SessionWallet(input.identities.authority),
  );
  const batches: ResetBatch[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const accounts = chunks[index]!;
    const closeProtocol = index === chunks.length - 1;
    const instruction = await program.methods
      .resetLegacyDevnetState(closeProtocol)
      .accountsPartial({
        legacyProtocol: deriveProtocolConfigPda(),
        rentRecipient: paymaster,
        legacyAuthority: input.identities.authority.publicKey,
      })
      .remainingAccounts(
        accounts.map((account) => ({
          pubkey: new PublicKey(account.address),
          isSigner: false,
          isWritable: true,
        })),
      )
      .instruction();
    batches.push({
      id: `reset-${String(index + 1).padStart(2, "0")}`,
      closeProtocol,
      accounts,
      instruction,
    });
  }
  return batches;
}

function publicPlan(
  input: DevnetResetInput,
  inventory: ResetAccountSnapshot[],
  paymaster: PublicKey,
  batches: ResetBatch[],
): PublicDevnetResetPlan {
  const protocol = deriveProtocolConfigPda().toBase58();
  const protocolSnapshot = inventory.find(
    (account) => account.address === protocol,
  )!;
  return {
    schema: "zkube-legacy-devnet-reset-plan",
    schemaVersion: 1,
    cluster: "devnet",
    rpc: input.rpc,
    genesisHash: SOLANA_DEVNET_GENESIS_HASH,
    program: ZKUBE_PROGRAM_ID.toBase58(),
    reviewedSbfSha256: DEPLOYED_ZKUBE_SBF_SHA256,
    legacyProtocol: protocol,
    funder: input.identities.funder.publicKey.toBase58(),
    legacyAuthority: input.identities.authority.publicKey.toBase58(),
    rentRecipient: paymaster.toBase58(),
    accountCount: inventory.length,
    reclaimableLamports: inventory.reduce(
      (sum, account) => sum + account.lamports,
      0,
    ),
    accounts: inventory,
    batches: batches.map((batch) => ({
      id: batch.id,
      closeProtocol: batch.closeProtocol,
      accounts: batch.accounts,
      reclaimedLamports:
        batch.accounts.reduce((sum, account) => sum + account.lamports, 0) +
        (batch.closeProtocol ? protocolSnapshot.lamports : 0),
      instructionDataSha256: sha256(batch.instruction.data),
      requiredSigners: [
        input.identities.funder.publicKey.toBase58(),
        input.identities.authority.publicKey.toBase58(),
      ],
    })),
    policy: {
      legacyProtocolBytes: LEGACY_PROTOCOL_BYTES,
      maximumAccountsPerBatch: RESET_BATCH_SIZE,
      skipPreflight: false,
    },
  };
}

async function simulateBatches(
  input: DevnetResetInput,
  batches: ResetBatch[],
): Promise<DevnetResetResult["simulations"]> {
  const simulations: DevnetResetResult["simulations"] = [];
  for (const batch of batches) {
    const latest = await input.connection.getLatestBlockhash("confirmed");
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: input.identities.funder.publicKey,
        recentBlockhash: latest.blockhash,
        instructions: [batch.instruction],
      }).compileToV0Message(),
    );
    const [simulation, fee] = await Promise.all([
      input.connection.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: false,
      }),
      input.connection.getFeeForMessage(transaction.message, "confirmed"),
    ]);
    if (simulation.value.err) {
      throw new Error(
        `unsigned Devnet simulation failed for ${batch.id}: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join("\n") ?? ""}`,
      );
    }
    if (fee.value === null) {
      throw new Error(`Unable to estimate the Devnet fee for ${batch.id}`);
    }
    simulations.push({
      id: batch.id,
      unitsConsumed: simulation.value.unitsConsumed ?? null,
      feeLamports: fee.value,
    });
  }
  return simulations;
}

async function executeBatch(
  input: DevnetResetInput,
  batch: ResetBatch,
): Promise<string> {
  const latest = await input.connection.getLatestBlockhash("confirmed");
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: input.identities.funder.publicKey,
      recentBlockhash: latest.blockhash,
      instructions: [batch.instruction],
    }).compileToV0Message(),
  );
  transaction.sign([input.identities.funder, input.identities.authority]);
  const simulation = await input.connection.simulateTransaction(transaction, {
    sigVerify: true,
    replaceRecentBlockhash: false,
  });
  if (simulation.value.err) {
    throw new Error(
      `signed Devnet simulation failed for ${batch.id}: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join("\n") ?? ""}`,
    );
  }
  const signature = await input.connection.sendRawTransaction(
    transaction.serialize(),
    { skipPreflight: false, maxRetries: 5 },
  );
  const confirmation = await input.connection.confirmTransaction(
    { signature, ...latest },
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error(
      `Devnet confirmation failed for ${batch.id}: ${JSON.stringify(confirmation.value.err)}`,
    );
  }
  return signature;
}

async function verifySnapshot(
  connection: Connection,
  expected: ResetAccountSnapshot[],
): Promise<void> {
  const actual = await fetchInventory(connection);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("legacy account inventory changed after approval");
  }
}

function writeCandidate(path: string, result: DevnetResetResult): void {
  writeJson(path, {
    schema: "zkube-legacy-devnet-reset-candidate",
    schemaVersion: 1,
    fingerprint: result.fingerprint,
    plan: result.plan,
    simulations: result.simulations,
    signed: false,
    sent: false,
  });
}

function writeProof(path: string, result: DevnetResetResult): void {
  writeJson(path, {
    schema: "zkube-legacy-devnet-reset-proof",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    fingerprint: result.fingerprint,
    plan: result.plan,
    simulations: result.simulations,
    signatures: result.signatures,
  });
}

function writeJson(path: string, value: unknown): void {
  const destination = resolve(path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}

function loadKeypair(path: string, label: string): Keypair {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read ${label} keypair: ${(error as Error).message}`,
    );
  }
  if (
    !Array.isArray(value) ||
    value.length !== 64 ||
    !value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    throw new Error(`${label} keypair must be a 64-byte JSON array`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(value as number[]));
}

function devnetRpc(value: string): string {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:") {
    throw new Error("Devnet reset RPC must use HTTPS");
  }
  if (/mainnet|testnet|localhost|127\.0\.0\.1/i.test(value)) {
    throw new Error("Devnet reset accepts Devnet only");
  }
  return endpoint.toString().replace(/\/$/, "");
}

function sha256(value: Buffer | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
