import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";

import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type AccountInfo,
} from "@solana/web3.js";

import { buildTopUpPrizePoolPlan, type PrizePoolKind } from "./adminClient";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants";
import {
  isZkubeDeploymentManifest,
  type ZkubeDeploymentManifest,
} from "./deploymentManifest";
import { inspectUpgradeableProgram } from "./deploymentRunner";
import { LAUNCH_ACCOUNT_SPACES } from "./launchPlanner";
import {
  deriveArcadeConfigPda,
  deriveArenaDailyPda,
  deriveProtocolConfigPda,
  deriveSeasonPda,
  deriveWeeklyJackpotPda,
} from "./pdas";
import {
  ARCADE_ACCOUNT_VERSION,
  ARENA_ENTRY_LAMPORTS,
  ENTRY_DAILY_LAMPORTS,
  ENTRY_OPERATOR_LAMPORTS,
  ENTRY_SEASON_LAMPORTS,
  ENTRY_WEEKLY_LAMPORTS,
  MONDAY_EPOCH_DAY_ID,
  PROTOCOL_ACCOUNT_VERSION,
  SEASON_DAYS,
  SECONDS_PER_DAY,
  WEEK_DAYS,
} from "./protocolVersions.generated";
import { createReadOnlyWallet } from "./readOnlyWallet";
import { zkubeProgram, type TransactionPlan } from "./runPlan";

type PrizeTopUpMode = "plan" | "execute";
type CadenceSelector = "current" | "following" | number;

export interface RequestedPrizeTopUp {
  kind: PrizePoolKind;
  cadence: CadenceSelector;
  lamports: bigint;
}

export interface PrizeTopUpCliOptions {
  mode: PrizeTopUpMode;
  topUps: RequestedPrizeTopUp[];
  bundlePath?: string;
  manifestPath: string;
  rpcOverride?: string;
  authorityReserveLamports: number;
}

interface ResolvedPrizeTopUp {
  kind: PrizePoolKind;
  cadenceId: number;
  lamports: string;
}

interface LedgerObservation {
  seededLamports: string;
  entryLamports: string;
  rolloverInLamports: string;
  payoutLamports: string;
  rolloverOutLamports: string;
  availableLamports: string;
}

interface PoolObservation {
  kind: PrizePoolKind;
  cadenceId: number;
  address: string;
  status: "funding" | "open";
  closesAt: number;
  accountLamports: number;
  rentFloorLamports: number;
  ledgerBefore: LedgerObservation;
  seededLamportsAfter: string;
}

interface PublicInstruction {
  programId: string;
  accounts: Array<{
    publicKey: string;
    signer: boolean;
    writable: boolean;
  }>;
  dataBase64: string;
}

interface PublicTransactionPlan {
  layer: "solana-base";
  label: string;
  feePayer: string;
  instructions: PublicInstruction[];
}

interface PrizeTopUpApprovalPayload {
  schema: "zkube-prize-top-up-approval";
  schemaVersion: 1;
  cluster: "devnet";
  rpc: string;
  genesisHash: string;
  programId: string;
  programDataAddress: string;
  deployedProgramDataSha256: string;
  programAllocationBytes: number;
  programUpgradeAuthority: string;
  protocol: string;
  arcadeConfig: string;
  authority: string;
  observedUnixTimestamp: number;
  currentCadences: Record<PrizePoolKind, number>;
  operations: ResolvedPrizeTopUp[];
  pools: PoolObservation[];
  transaction: PublicTransactionPlan;
  transactionSha256: string;
  costs: {
    totalTopUpLamports: string;
    maximumFeeLamports: number;
    maximumAuthoritySpendLamports: string;
    authorityReserveLamports: number;
    requiredAuthorityBalanceLamports: string;
    observedAuthorityBalanceLamports: number;
    simulatedUnitsConsumed: number | null;
  };
}

interface PrizeTopUpReceipt {
  state: "pending" | "confirmed";
  transactionSha256: string;
  signature: string;
  signatureBase64: string;
  rawTransactionBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

interface PrizeTopUpBundle {
  schema: "zkube-devnet-prize-top-up-bundle";
  schemaVersion: 1;
  approvalFingerprint: string;
  approvalPayload: PrizeTopUpApprovalPayload;
  progress: { receipt?: PrizeTopUpReceipt };
}

export interface PrizeTopUpResult {
  mode: PrizeTopUpMode;
  approvalFingerprint: string;
  bundlePath: string;
  payload: PrizeTopUpApprovalPayload;
  signature?: string;
}

const DEFAULT_MANIFEST_PATH = "deployment/devnet-v4.json";
const DEFAULT_AUTHORITY_RESERVE_LAMPORTS = 100_000_000;
const MAX_TOP_UPS = 6;
const U64_MAX = (1n << 64n) - 1n;
const KIND_ORDER: Record<PrizePoolKind, number> = {
  daily: 0,
  weekly: 1,
  season: 2,
};

export function parsePrizeTopUpCliArgs(
  argv: readonly string[],
  cwd = process.cwd(),
): PrizeTopUpCliOptions {
  let index = argv[0] === "--" ? 1 : 0;
  let mode: PrizeTopUpMode = "plan";
  const requestedMode = argv[index];
  if (requestedMode === "plan" || requestedMode === "execute") {
    mode = requestedMode;
    index += 1;
  }
  const topUps: RequestedPrizeTopUp[] = [];
  let bundlePath: string | undefined;
  let manifestPath = resolve(cwd, DEFAULT_MANIFEST_PATH);
  let rpcOverride: string | undefined;
  let authorityReserveLamports = DEFAULT_AUTHORITY_RESERVE_LAMPORTS;

  while (index < argv.length) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag ?? "argument"} requires a value`);
    }
    switch (flag) {
      case "--top-up":
        topUps.push(parseTopUpSpec(value));
        break;
      case "--bundle":
        bundlePath = resolve(cwd, value);
        break;
      case "--manifest":
        manifestPath = resolve(cwd, value);
        break;
      case "--rpc":
        rpcOverride = devnetEndpoint(value);
        break;
      case "--reserve-lamports":
        authorityReserveLamports = safePositiveInteger(
          value,
          "--reserve-lamports",
          true,
        );
        break;
      default:
        throw new Error(`unsupported argument ${flag ?? ""}`.trim());
    }
    index += 2;
  }

  if (mode === "plan" && topUps.length === 0) {
    throw new Error("plan mode requires at least one --top-up");
  }
  if (mode === "execute" && topUps.length > 0) {
    throw new Error("execute mode reads exact top-ups from its bundle");
  }
  if (mode === "execute" && !bundlePath) {
    throw new Error("execute mode requires --bundle");
  }
  if (topUps.length > MAX_TOP_UPS) {
    throw new Error(`a manual top-up may contain at most ${MAX_TOP_UPS} pools`);
  }
  return {
    mode,
    topUps,
    ...(bundlePath ? { bundlePath } : {}),
    manifestPath,
    ...(rpcOverride ? { rpcOverride } : {}),
    authorityReserveLamports,
  };
}

export function parseTopUpSpec(value: string): RequestedPrizeTopUp {
  const parts = value.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "--top-up must use kind:current|following|cadence-id:amountSOL|amountlamports",
    );
  }
  const [rawKind, rawCadence, rawAmount] = parts;
  if (rawKind !== "daily" && rawKind !== "weekly" && rawKind !== "season") {
    throw new Error("top-up kind must be daily, weekly, or season");
  }
  let cadence: CadenceSelector;
  if (rawCadence === "current" || rawCadence === "following") {
    cadence = rawCadence;
  } else {
    cadence = u32(rawCadence ?? "", "top-up cadence id");
  }
  return {
    kind: rawKind,
    cadence,
    lamports: parseLamports(rawAmount ?? ""),
  };
}

export async function runPrizeTopUpCommand(
  options: PrizeTopUpCliOptions,
  env: Record<string, string | undefined> = process.env,
): Promise<PrizeTopUpResult> {
  if (options.mode === "execute") {
    return executePrizeTopUp(options.bundlePath!, env);
  }
  const manifest = readApprovedDevnetManifest(options.manifestPath);
  const rpc = options.rpcOverride ?? devnetEndpoint(manifest.rpc.base);
  const connection = new Connection(rpc, "confirmed");
  const payload = await buildPrizeTopUpApproval({
    connection,
    manifest,
    rpc,
    requestedTopUps: options.topUps,
    authorityReserveLamports: options.authorityReserveLamports,
  });
  const approvalFingerprint = approvalHash(payload);
  const bundlePath =
    options.bundlePath ??
    resolve(
      "/tmp",
      `zkube-prize-top-up-${approvalFingerprint.slice(0, 16)}.json`,
    );
  if (existsSync(bundlePath)) {
    throw new Error(
      "top-up bundle already exists; choose a fresh --bundle path",
    );
  }
  const bundle: PrizeTopUpBundle = {
    schema: "zkube-devnet-prize-top-up-bundle",
    schemaVersion: 1,
    approvalFingerprint,
    approvalPayload: payload,
    progress: {},
  };
  saveBundle(bundlePath, bundle);
  return {
    mode: "plan",
    approvalFingerprint,
    bundlePath,
    payload,
  };
}

export async function buildPrizeTopUpApproval(args: {
  connection: Connection;
  manifest: ZkubeDeploymentManifest;
  rpc: string;
  requestedTopUps: readonly RequestedPrizeTopUp[];
  authorityReserveLamports: number;
}): Promise<PrizeTopUpApprovalPayload> {
  const { connection, manifest } = args;
  const genesisHash = await connection.getGenesisHash();
  if (
    genesisHash !== SOLANA_DEVNET_GENESIS_HASH ||
    genesisHash !== manifest.rpc.expectedGenesisHash
  ) {
    throw new Error(`Devnet genesis mismatch: received ${genesisHash}`);
  }
  const deployed = await inspectUpgradeableProgram(
    connection,
    ZKUBE_PROGRAM_ID,
  );
  assertManifestProgram(manifest, deployed);
  const slot = await connection.getSlot("confirmed");
  const observedUnixTimestamp = await connection.getBlockTime(slot);
  if (observedUnixTimestamp === null || observedUnixTimestamp < 0) {
    throw new Error("confirmed Devnet block time is unavailable");
  }
  const currentCadences = cadencesAt(observedUnixTimestamp);
  const operations = resolveOperations(args.requestedTopUps, currentCadences);
  const authority = new PublicKey(manifest.protocol.authority);
  const program = zkubeProgram(connection, createReadOnlyWallet(authority));
  const [protocol, arcadeConfig, authorityBalanceLamports] = await Promise.all([
    fetchExact(
      connection,
      program,
      "protocolConfig",
      deriveProtocolConfigPda(),
      LAUNCH_ACCOUNT_SPACES.protocolConfig,
    ),
    fetchExact(
      connection,
      program,
      "arcadeConfig",
      deriveArcadeConfigPda(),
      LAUNCH_ACCOUNT_SPACES.arcadeConfig,
    ),
    connection.getBalance(authority, "confirmed"),
  ]);
  assertProtocolAndArcade(protocol.value, arcadeConfig.value, authority);

  const pools: PoolObservation[] = [];
  for (const operation of operations) {
    pools.push(
      await inspectPool({
        connection,
        program,
        operation,
        currentCadence: currentCadences[operation.kind],
        observedUnixTimestamp,
      }),
    );
  }
  const transactionPlan = await buildAtomicTopUpPlan(
    connection,
    authority,
    operations,
  );
  const latest = await connection.getLatestBlockhash("confirmed");
  transactionPlan.transaction.feePayer = authority;
  transactionPlan.transaction.recentBlockhash = latest.blockhash;
  const fee = await connection.getFeeForMessage(
    transactionPlan.transaction.compileMessage(),
    "confirmed",
  );
  if (
    fee.value === null ||
    !Number.isSafeInteger(fee.value) ||
    fee.value <= 0
  ) {
    throw new Error("unable to estimate the exact top-up transaction fee");
  }
  const simulation = await connection.simulateTransaction(
    transactionPlan.transaction,
  );
  if (simulation.value.err) {
    throw new Error(
      `unsigned top-up simulation failed: ${JSON.stringify(simulation.value.err)}`,
    );
  }
  const totalTopUpLamports = operations.reduce(
    (total, operation) => checkedU64Add(total, BigInt(operation.lamports)),
    0n,
  );
  const maximumAuthoritySpendLamports = totalTopUpLamports + BigInt(fee.value);
  const requiredAuthorityBalanceLamports =
    maximumAuthoritySpendLamports + BigInt(args.authorityReserveLamports);
  if (BigInt(authorityBalanceLamports) < requiredAuthorityBalanceLamports) {
    throw new Error(
      `protocol authority needs ${requiredAuthorityBalanceLamports.toString()} lamports but has ${authorityBalanceLamports}`,
    );
  }
  const publicTransaction = publicPlan(transactionPlan);
  return {
    schema: "zkube-prize-top-up-approval",
    schemaVersion: 1,
    cluster: "devnet",
    rpc: args.rpc,
    genesisHash,
    programId: ZKUBE_PROGRAM_ID.toBase58(),
    programDataAddress: deployed.programDataAddress.toBase58(),
    deployedProgramDataSha256: deployed.deployedSbfSha256,
    programAllocationBytes: deployed.programCapacityBytes,
    programUpgradeAuthority: deployed.upgradeAuthority!,
    protocol: deriveProtocolConfigPda().toBase58(),
    arcadeConfig: deriveArcadeConfigPda().toBase58(),
    authority: authority.toBase58(),
    observedUnixTimestamp,
    currentCadences,
    operations,
    pools,
    transaction: publicTransaction,
    transactionSha256: publicPlanHash(publicTransaction),
    costs: {
      totalTopUpLamports: totalTopUpLamports.toString(),
      maximumFeeLamports: fee.value,
      maximumAuthoritySpendLamports: maximumAuthoritySpendLamports.toString(),
      authorityReserveLamports: args.authorityReserveLamports,
      requiredAuthorityBalanceLamports:
        requiredAuthorityBalanceLamports.toString(),
      observedAuthorityBalanceLamports: authorityBalanceLamports,
      simulatedUnitsConsumed: simulation.value.unitsConsumed ?? null,
    },
  };
}

async function executePrizeTopUp(
  bundlePath: string,
  env: Record<string, string | undefined>,
): Promise<PrizeTopUpResult> {
  const bundle = parseBundle(readFileSync(bundlePath, "utf8"));
  if (env.ZKUBE_PRIZE_TOP_UP_APPROVAL?.trim() !== bundle.approvalFingerprint) {
    throw new Error(
      `top-up blocked: exact approval ${bundle.approvalFingerprint} is required`,
    );
  }
  const payload = bundle.approvalPayload;
  const connection = new Connection(devnetEndpoint(payload.rpc), "confirmed");
  await assertImmutableRelease(connection, payload);
  const signer = loadPinnedKeypair(
    required(env, "ZKUBE_PROTOCOL_AUTHORITY_KEYPAIR"),
    payload.authority,
    "protocol authority",
  );
  const plan = await buildAtomicTopUpPlan(
    connection,
    signer.publicKey,
    payload.operations,
  );
  const rebuiltPublic = publicPlan(plan);
  if (
    !isDeepStrictEqual(rebuiltPublic, payload.transaction) ||
    publicPlanHash(rebuiltPublic) !== payload.transactionSha256
  ) {
    throw new Error("top-up instruction bytes drifted after approval");
  }

  if (bundle.progress.receipt) {
    const receipt = await recoverReceipt(
      connection,
      plan,
      signer,
      bundle.progress.receipt,
    );
    bundle.progress.receipt = receipt;
    saveBundle(bundlePath, bundle);
    await verifyPostState(connection, payload);
    return {
      mode: "execute",
      approvalFingerprint: bundle.approvalFingerprint,
      bundlePath,
      payload,
      signature: receipt.signature,
    };
  }

  await assertPreState(connection, payload);
  const latest = await connection.getLatestBlockhash("confirmed");
  plan.transaction.feePayer = signer.publicKey;
  plan.transaction.recentBlockhash = latest.blockhash;
  const fee = await connection.getFeeForMessage(
    plan.transaction.compileMessage(),
    "confirmed",
  );
  if (
    fee.value === null ||
    !Number.isSafeInteger(fee.value) ||
    fee.value <= 0 ||
    fee.value > payload.costs.maximumFeeLamports
  ) {
    throw new Error("live transaction fee exceeds the exact approved maximum");
  }
  const balance = await connection.getBalance(signer.publicKey, "confirmed");
  if (
    BigInt(balance) < BigInt(payload.costs.requiredAuthorityBalanceLamports)
  ) {
    throw new Error(
      "protocol authority balance is below the approved spend and reserve floor",
    );
  }
  plan.transaction.sign(signer);
  const simulation = await connection.simulateTransaction(plan.transaction);
  if (simulation.value.err) {
    throw new Error(
      `signed top-up simulation failed: ${JSON.stringify(simulation.value.err)}`,
    );
  }
  const signatureBytes = plan.transaction.signature;
  if (!signatureBytes || !plan.transaction.verifySignatures()) {
    throw new Error(
      "top-up did not produce a valid pinned authority signature",
    );
  }
  const raw = plan.transaction.serialize();
  const pending: PrizeTopUpReceipt = {
    state: "pending",
    transactionSha256: payload.transactionSha256,
    signature: encodeBase58(signatureBytes),
    signatureBase64: Buffer.from(signatureBytes).toString("base64"),
    rawTransactionBase64: raw.toString("base64"),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
  bundle.progress.receipt = pending;
  saveBundle(bundlePath, bundle);
  const relayed = await connection.sendRawTransaction(raw, {
    maxRetries: 5,
    skipPreflight: false,
  });
  if (relayed !== pending.signature) {
    throw new Error("submitted top-up signature drifted");
  }
  const confirmed = await confirmReceipt(connection, pending);
  bundle.progress.receipt = confirmed;
  saveBundle(bundlePath, bundle);
  await verifyPostState(connection, payload);
  return {
    mode: "execute",
    approvalFingerprint: bundle.approvalFingerprint,
    bundlePath,
    payload,
    signature: confirmed.signature,
  };
}

async function assertImmutableRelease(
  connection: Connection,
  payload: PrizeTopUpApprovalPayload,
): Promise<void> {
  const genesis = await connection.getGenesisHash();
  if (
    genesis !== SOLANA_DEVNET_GENESIS_HASH ||
    genesis !== payload.genesisHash ||
    payload.cluster !== "devnet" ||
    payload.programId !== ZKUBE_PROGRAM_ID.toBase58()
  ) {
    throw new Error(
      "top-up execution is not bound to the approved Devnet program",
    );
  }
  const deployed = await inspectUpgradeableProgram(
    connection,
    ZKUBE_PROGRAM_ID,
  );
  if (
    deployed.programDataAddress.toBase58() !== payload.programDataAddress ||
    deployed.deployedSbfSha256 !== payload.deployedProgramDataSha256 ||
    deployed.programCapacityBytes !== payload.programAllocationBytes ||
    deployed.upgradeAuthority !== payload.programUpgradeAuthority
  ) {
    throw new Error("deployed ProgramData drifted after top-up approval");
  }
  const slot = await connection.getSlot("confirmed");
  const now = await connection.getBlockTime(slot);
  if (now === null)
    throw new Error("confirmed Devnet block time is unavailable");
  const current = cadencesAt(now);
  for (const operation of payload.operations) {
    if (
      operation.cadenceId !== current[operation.kind] &&
      operation.cadenceId !== current[operation.kind] + 1
    ) {
      throw new Error(
        `${operation.kind} ${operation.cadenceId} is no longer current or following`,
      );
    }
  }
}

async function assertPreState(
  connection: Connection,
  payload: PrizeTopUpApprovalPayload,
): Promise<void> {
  const program = zkubeProgram(
    connection,
    createReadOnlyWallet(new PublicKey(payload.authority)),
  );
  const protocol = await fetchExact(
    connection,
    program,
    "protocolConfig",
    deriveProtocolConfigPda(),
    LAUNCH_ACCOUNT_SPACES.protocolConfig,
  );
  const arcadeConfig = await fetchExact(
    connection,
    program,
    "arcadeConfig",
    deriveArcadeConfigPda(),
    LAUNCH_ACCOUNT_SPACES.arcadeConfig,
  );
  assertProtocolAndArcade(
    protocol.value,
    arcadeConfig.value,
    new PublicKey(payload.authority),
  );
  const slot = await connection.getSlot("confirmed");
  const now = await connection.getBlockTime(slot);
  if (now === null)
    throw new Error("confirmed Devnet block time is unavailable");
  const current = cadencesAt(now);
  for (const operation of payload.operations) {
    const observed = await inspectPool({
      connection,
      program,
      operation,
      currentCadence: current[operation.kind],
      observedUnixTimestamp: now,
    });
    const approved = payload.pools.find(
      (pool) =>
        pool.kind === operation.kind && pool.cadenceId === operation.cadenceId,
    );
    if (
      !approved ||
      observed.ledgerBefore.seededLamports !==
        approved.ledgerBefore.seededLamports
    ) {
      throw new Error(
        `${operation.kind} ${operation.cadenceId} seeded balance drifted; replan to prevent a duplicate top-up`,
      );
    }
  }
}

async function verifyPostState(
  connection: Connection,
  payload: PrizeTopUpApprovalPayload,
): Promise<void> {
  const program = zkubeProgram(
    connection,
    createReadOnlyWallet(new PublicKey(payload.authority)),
  );
  for (const approved of payload.pools) {
    const account = await fetchPoolAccount(
      connection,
      program,
      approved.kind,
      approved.cadenceId,
    );
    const ledger = ledgerObservation(
      object(account.value.ledger, "pool ledger"),
    );
    if (ledger.seededLamports !== approved.seededLamportsAfter) {
      throw new Error(
        `${approved.kind} ${approved.cadenceId} did not reach its approved seeded balance`,
      );
    }
  }
}

async function recoverReceipt(
  connection: Connection,
  plan: TransactionPlan,
  signer: Keypair,
  receipt: PrizeTopUpReceipt,
): Promise<PrizeTopUpReceipt> {
  verifyReceipt(receipt, plan, signer.publicKey);
  const status = await connection.getSignatureStatus(receipt.signature, {
    searchTransactionHistory: true,
  });
  if (status.value?.err) {
    throw new Error(
      `previous top-up failed: ${JSON.stringify(status.value.err)}`,
    );
  }
  if (confirmedStatus(status.value?.confirmationStatus)) {
    return { ...receipt, state: "confirmed" };
  }
  if (receipt.state === "confirmed") {
    throw new Error("confirmed top-up receipt is no longer visible on Devnet");
  }
  const valid = await connection.isBlockhashValid(receipt.blockhash, {
    commitment: "confirmed",
  });
  if (!valid.value) {
    throw new Error(
      "pending top-up blockhash expired; verify the saved signature before creating a fresh plan",
    );
  }
  const raw = Buffer.from(receipt.rawTransactionBase64, "base64");
  const relayed = await connection.sendRawTransaction(raw, {
    maxRetries: 5,
    skipPreflight: false,
  });
  if (relayed !== receipt.signature) {
    throw new Error("recovered top-up signature drifted");
  }
  return confirmReceipt(connection, receipt);
}

async function confirmReceipt(
  connection: Connection,
  receipt: PrizeTopUpReceipt,
): Promise<PrizeTopUpReceipt> {
  const confirmation = await connection.confirmTransaction(
    {
      blockhash: receipt.blockhash,
      lastValidBlockHeight: receipt.lastValidBlockHeight,
      signature: receipt.signature,
    },
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error(
      `top-up confirmation failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }
  const status = await connection.getSignatureStatus(receipt.signature, {
    searchTransactionHistory: true,
  });
  if (
    !status.value ||
    status.value.err ||
    !confirmedStatus(status.value.confirmationStatus)
  ) {
    throw new Error("top-up could not be re-verified after confirmation");
  }
  return { ...receipt, state: "confirmed" };
}

async function buildAtomicTopUpPlan(
  connection: Connection,
  authority: PublicKey,
  operations: readonly ResolvedPrizeTopUp[],
): Promise<TransactionPlan> {
  const wallet = createReadOnlyWallet(authority);
  const transaction = new Transaction();
  for (const operation of operations) {
    const plan = await buildTopUpPrizePoolPlan({
      connection,
      authority: wallet,
      pool: operation.kind,
      cadenceId: operation.cadenceId,
      lamports: BigInt(operation.lamports),
    });
    transaction.add(...plan.transaction.instructions);
  }
  return {
    layer: "solana-base",
    label: `Manual prize top-up (${operations.length} pool${operations.length === 1 ? "" : "s"})`,
    connection,
    transaction,
    feePayer: authority,
    signers: [],
  };
}

async function inspectPool(args: {
  connection: Connection;
  program: ReturnType<typeof zkubeProgram>;
  operation: ResolvedPrizeTopUp;
  currentCadence: number;
  observedUnixTimestamp: number;
}): Promise<PoolObservation> {
  if (
    args.operation.cadenceId !== args.currentCadence &&
    args.operation.cadenceId !== args.currentCadence + 1
  ) {
    throw new Error(
      `${args.operation.kind} ${args.operation.cadenceId} must be canonical current or following`,
    );
  }
  const account = await fetchPoolAccount(
    args.connection,
    args.program,
    args.operation.kind,
    args.operation.cadenceId,
  );
  const value = account.value;
  if (integer(value.version, "pool version") !== ARCADE_ACCOUNT_VERSION) {
    throw new Error(`${args.operation.kind} account version is invalid`);
  }
  if (
    !key(value.arcadeConfig, "pool arcade config").equals(
      deriveArcadeConfigPda(),
    )
  ) {
    throw new Error(
      `${args.operation.kind} account has the wrong Arcade config`,
    );
  }
  const decodedCadence = integer(
    args.operation.kind === "daily"
      ? value.dayId
      : args.operation.kind === "weekly"
        ? value.weekId
        : value.seasonId,
    "pool cadence id",
  );
  if (decodedCadence !== args.operation.cadenceId) {
    throw new Error(
      `${args.operation.kind} account cadence does not match its PDA`,
    );
  }
  const status = enumName(value.status, "pool status");
  if (status !== "funding" && status !== "open") {
    throw new Error(
      `${args.operation.kind} ${args.operation.cadenceId} is not live`,
    );
  }
  const closesAt = integer(
    args.operation.kind === "daily" ? value.runsCloseAt : value.closesAt,
    "pool close time",
  );
  if (args.observedUnixTimestamp >= closesAt) {
    throw new Error(
      `${args.operation.kind} ${args.operation.cadenceId} has closed`,
    );
  }
  const ledgerBefore = ledgerObservation(object(value.ledger, "pool ledger"));
  const rentFloorLamports =
    await args.connection.getMinimumBalanceForRentExemption(
      poolSpace(args.operation.kind),
      "confirmed",
    );
  const accountedLamports =
    BigInt(rentFloorLamports) + BigInt(ledgerBefore.availableLamports);
  if (BigInt(account.info.lamports) !== accountedLamports) {
    throw new Error(
      `${args.operation.kind} ${args.operation.cadenceId} contains unaccounted lamports`,
    );
  }
  const seededAfter = checkedU64Add(
    BigInt(ledgerBefore.seededLamports),
    BigInt(args.operation.lamports),
  );
  return {
    kind: args.operation.kind,
    cadenceId: args.operation.cadenceId,
    address: poolAddress(
      args.operation.kind,
      args.operation.cadenceId,
    ).toBase58(),
    status,
    closesAt,
    accountLamports: account.info.lamports,
    rentFloorLamports,
    ledgerBefore,
    seededLamportsAfter: seededAfter.toString(),
  };
}

async function fetchPoolAccount(
  connection: Connection,
  program: ReturnType<typeof zkubeProgram>,
  kind: PrizePoolKind,
  cadenceId: number,
) {
  return fetchExact(
    connection,
    program,
    poolAccountName(kind),
    poolAddress(kind, cadenceId),
    poolSpace(kind),
  );
}

async function fetchExact(
  connection: Connection,
  program: ReturnType<typeof zkubeProgram>,
  name: string,
  address: PublicKey,
  size: number,
): Promise<{ info: AccountInfo<Buffer>; value: Record<string, unknown> }> {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (
    !info ||
    info.executable ||
    !info.owner.equals(ZKUBE_PROGRAM_ID) ||
    info.data.length !== size
  ) {
    throw new Error(`${name} account owner, size, or PDA is invalid`);
  }
  try {
    return {
      info,
      value: object(program.coder.accounts.decode(name, info.data), name),
    };
  } catch {
    throw new Error(`${name} account discriminator or data is invalid`);
  }
}

function assertProtocolAndArcade(
  protocol: Record<string, unknown>,
  arcade: Record<string, unknown>,
  authority: PublicKey,
): void {
  if (
    integer(protocol.version, "protocol version") !==
      PROTOCOL_ACCOUNT_VERSION ||
    !key(protocol.authority, "protocol authority").equals(authority)
  ) {
    throw new Error(
      "protocol version or authority does not match the approved manifest",
    );
  }
  if (
    integer(arcade.version, "Arcade version") !== ARCADE_ACCOUNT_VERSION ||
    !key(arcade.protocol, "Arcade protocol").equals(
      deriveProtocolConfigPda(),
    ) ||
    arcade.launchSeeded !== true ||
    amount(arcade.entryLamports, "entry lamports") !== ARENA_ENTRY_LAMPORTS ||
    amount(arcade.dailyLamports, "daily entry share") !==
      ENTRY_DAILY_LAMPORTS ||
    amount(arcade.weeklyLamports, "weekly entry share") !==
      ENTRY_WEEKLY_LAMPORTS ||
    amount(arcade.seasonLamports, "season entry share") !==
      ENTRY_SEASON_LAMPORTS ||
    amount(arcade.operatorLamports, "operator entry share") !==
      ENTRY_OPERATOR_LAMPORTS
  ) {
    throw new Error("Arcade config is not the active canonical economy");
  }
}

function assertManifestProgram(
  manifest: ZkubeDeploymentManifest,
  deployed: Awaited<ReturnType<typeof inspectUpgradeableProgram>>,
): void {
  if (
    manifest.cluster !== "devnet" ||
    manifest.program.id !== ZKUBE_PROGRAM_ID.toBase58() ||
    deployed.programDataAddress.toBase58() !==
      manifest.program.programDataAddress ||
    deployed.deployedSbfSha256 !== manifest.program.deployedProgramDataSha256 ||
    deployed.programCapacityBytes !== manifest.program.allocationBytes ||
    deployed.upgradeAuthority !== manifest.program.upgradeAuthority
  ) {
    throw new Error(
      "live Devnet ProgramData does not match the approved deployment manifest",
    );
  }
}

function resolveOperations(
  requested: readonly RequestedPrizeTopUp[],
  current: Record<PrizePoolKind, number>,
): ResolvedPrizeTopUp[] {
  if (requested.length === 0 || requested.length > MAX_TOP_UPS) {
    throw new Error(`manual top-up requires one to ${MAX_TOP_UPS} pools`);
  }
  const resolved = requested.map((topUp) => ({
    kind: topUp.kind,
    cadenceId:
      topUp.cadence === "current"
        ? current[topUp.kind]
        : topUp.cadence === "following"
          ? current[topUp.kind] + 1
          : topUp.cadence,
    lamports: topUp.lamports.toString(),
  }));
  resolved.sort(
    (left, right) =>
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      left.cadenceId - right.cadenceId,
  );
  const seen = new Set<string>();
  for (const topUp of resolved) {
    const id = `${topUp.kind}:${topUp.cadenceId}`;
    if (seen.has(id)) throw new Error(`duplicate top-up target ${id}`);
    seen.add(id);
    if (topUp.cadenceId > 0xffff_ffff) {
      throw new Error(`${id} does not fit in u32`);
    }
    const lamports = BigInt(topUp.lamports);
    if (lamports <= 0n || lamports > U64_MAX) {
      throw new Error(`${id} amount must fit in a positive u64`);
    }
  }
  return resolved;
}

function cadencesAt(unixTimestamp: number): Record<PrizePoolKind, number> {
  const day = Math.floor(unixTimestamp / SECONDS_PER_DAY);
  if (!Number.isSafeInteger(day) || day < MONDAY_EPOCH_DAY_ID) {
    throw new Error(
      "confirmed block time is outside the supported cadence range",
    );
  }
  const relative = day - MONDAY_EPOCH_DAY_ID;
  return {
    daily: day,
    weekly: Math.floor(relative / WEEK_DAYS),
    season: Math.floor(relative / SEASON_DAYS),
  };
}

function poolAddress(kind: PrizePoolKind, cadenceId: number): PublicKey {
  switch (kind) {
    case "daily":
      return deriveArenaDailyPda(cadenceId);
    case "weekly":
      return deriveWeeklyJackpotPda(cadenceId);
    case "season":
      return deriveSeasonPda(cadenceId);
  }
}

function poolAccountName(kind: PrizePoolKind): string {
  switch (kind) {
    case "daily":
      return "arenaDaily";
    case "weekly":
      return "weeklyJackpot";
    case "season":
      return "season";
  }
}

function poolSpace(kind: PrizePoolKind): number {
  switch (kind) {
    case "daily":
      return LAUNCH_ACCOUNT_SPACES.arenaDaily;
    case "weekly":
      return LAUNCH_ACCOUNT_SPACES.weeklyJackpot;
    case "season":
      return LAUNCH_ACCOUNT_SPACES.season;
  }
}

function ledgerObservation(ledger: Record<string, unknown>): LedgerObservation {
  const seeded = amount(ledger.seededLamports, "seeded lamports");
  const entry = amount(ledger.entryLamports, "entry lamports");
  const rolloverIn = amount(ledger.rolloverInLamports, "rollover-in lamports");
  const payout = amount(ledger.payoutLamports, "payout lamports");
  const rolloverOut = amount(
    ledger.rolloverOutLamports,
    "rollover-out lamports",
  );
  const funded = checkedU64Add(checkedU64Add(seeded, entry), rolloverIn);
  const accountedOut = checkedU64Add(payout, rolloverOut);
  if (accountedOut > funded) throw new Error("prize ledger is overdrawn");
  return {
    seededLamports: seeded.toString(),
    entryLamports: entry.toString(),
    rolloverInLamports: rolloverIn.toString(),
    payoutLamports: payout.toString(),
    rolloverOutLamports: rolloverOut.toString(),
    availableLamports: (funded - accountedOut).toString(),
  };
}

function publicPlan(plan: TransactionPlan): PublicTransactionPlan {
  return {
    layer: "solana-base",
    label: plan.label,
    feePayer: plan.feePayer.toBase58(),
    instructions: plan.transaction.instructions.map((instruction) => ({
      programId: instruction.programId.toBase58(),
      accounts: instruction.keys.map((account) => ({
        publicKey: account.pubkey.toBase58(),
        signer: account.isSigner,
        writable: account.isWritable,
      })),
      dataBase64: Buffer.from(instruction.data).toString("base64"),
    })),
  };
}

function publicPlanHash(plan: PublicTransactionPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function approvalHash(payload: PrizeTopUpApprovalPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function saveBundle(path: string, bundle: PrizeTopUpBundle): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(bundle, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function parseBundle(source: string): PrizeTopUpBundle {
  const value: unknown = JSON.parse(source);
  if (
    !value ||
    typeof value !== "object" ||
    (value as { schema?: unknown }).schema !==
      "zkube-devnet-prize-top-up-bundle" ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1
  ) {
    throw new Error("top-up bundle is malformed or unsupported");
  }
  const bundle = value as PrizeTopUpBundle;
  if (
    !/^[0-9a-f]{64}$/.test(bundle.approvalFingerprint) ||
    approvalHash(bundle.approvalPayload) !== bundle.approvalFingerprint ||
    !bundle.progress ||
    typeof bundle.progress !== "object"
  ) {
    throw new Error("top-up bundle fingerprint or progress is malformed");
  }
  validateApprovalPayload(bundle.approvalPayload);
  if (bundle.progress.receipt) validateReceiptShape(bundle.progress.receipt);
  return bundle;
}

function validateApprovalPayload(payload: PrizeTopUpApprovalPayload): void {
  if (
    payload.schema !== "zkube-prize-top-up-approval" ||
    payload.schemaVersion !== 1 ||
    payload.cluster !== "devnet" ||
    payload.genesisHash !== SOLANA_DEVNET_GENESIS_HASH ||
    payload.programId !== ZKUBE_PROGRAM_ID.toBase58() ||
    !/^[0-9a-f]{64}$/.test(payload.deployedProgramDataSha256) ||
    !/^[0-9a-f]{64}$/.test(payload.transactionSha256) ||
    publicPlanHash(payload.transaction) !== payload.transactionSha256 ||
    payload.operations.length === 0 ||
    payload.operations.length > MAX_TOP_UPS ||
    payload.pools.length !== payload.operations.length
  ) {
    throw new Error("top-up approval payload is malformed");
  }
  devnetEndpoint(payload.rpc);
  new PublicKey(payload.authority);
  new PublicKey(payload.protocol);
  new PublicKey(payload.arcadeConfig);
  new PublicKey(payload.programDataAddress);
  new PublicKey(payload.programUpgradeAuthority);
  resolveOperations(
    payload.operations.map((operation) => ({
      kind: operation.kind,
      cadence: operation.cadenceId,
      lamports: BigInt(operation.lamports),
    })),
    payload.currentCadences,
  );
}

function verifyReceipt(
  receipt: PrizeTopUpReceipt,
  plan: TransactionPlan,
  signer: PublicKey,
): void {
  validateReceiptShape(receipt);
  if (receipt.transactionSha256 !== publicPlanHash(publicPlan(plan))) {
    throw new Error(
      "saved receipt does not match the approved top-up transaction",
    );
  }
  const raw = Buffer.from(receipt.rawTransactionBase64, "base64");
  const transaction = Transaction.from(raw);
  if (
    !transaction.feePayer?.equals(signer) ||
    transaction.recentBlockhash !== receipt.blockhash ||
    !transaction.signature ||
    encodeBase58(transaction.signature) !== receipt.signature ||
    Buffer.from(transaction.signature).toString("base64") !==
      receipt.signatureBase64 ||
    !transaction.verifySignatures()
  ) {
    throw new Error("saved top-up receipt signature or fee payer is invalid");
  }
  const expected = new Transaction().add(...plan.transaction.instructions);
  expected.feePayer = signer;
  expected.recentBlockhash = receipt.blockhash;
  if (
    !Buffer.from(expected.serializeMessage()).equals(
      transaction.serializeMessage(),
    )
  ) {
    throw new Error(
      "saved top-up receipt instruction bytes drifted from approval",
    );
  }
}

function validateReceiptShape(receipt: PrizeTopUpReceipt): void {
  if (
    (receipt.state !== "pending" && receipt.state !== "confirmed") ||
    !/^[0-9a-f]{64}$/.test(receipt.transactionSha256) ||
    !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(receipt.signature) ||
    !Number.isSafeInteger(receipt.lastValidBlockHeight) ||
    receipt.lastValidBlockHeight <= 0
  ) {
    throw new Error("top-up receipt is malformed");
  }
}

function loadPinnedKeypair(
  path: string,
  expected: string,
  label: string,
): Keypair {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    !parsed.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    throw new Error(`${label} keypair file is malformed`);
  }
  const keypair = Keypair.fromSecretKey(Uint8Array.from(parsed));
  if (keypair.publicKey.toBase58() !== expected) {
    throw new Error(`${label} keypair does not match the approved public key`);
  }
  return keypair;
}

function readApprovedDevnetManifest(path: string): ZkubeDeploymentManifest {
  const source: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !isZkubeDeploymentManifest(source, ZKUBE_PROGRAM_ID) ||
    source.cluster !== "devnet" ||
    source.approval.status !== "approved"
  ) {
    throw new Error(
      "manual top-up requires an approved Devnet deployment manifest",
    );
  }
  return source;
}

function parseLamports(value: string): bigint {
  const sol = value.match(/^(0|[1-9]\d*)(?:\.(\d{1,9}))?SOL$/i);
  if (sol) {
    const whole = BigInt(sol[1]!);
    const fractional = (sol[2] ?? "").padEnd(9, "0");
    const lamports = whole * 1_000_000_000n + BigInt(fractional || "0");
    if (lamports <= 0n || lamports > U64_MAX) {
      throw new Error("top-up amount must fit in a positive u64");
    }
    return lamports;
  }
  const raw = value.match(/^([1-9]\d*)lamports$/i);
  if (!raw) {
    throw new Error("top-up amount must end in SOL or lamports");
  }
  const lamports = BigInt(raw[1]!);
  if (lamports > U64_MAX) throw new Error("top-up amount must fit in u64");
  return lamports;
}

function devnetEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "https:" ||
    /mainnet|localhost|127\.0\.0\.1|localnet/i.test(value)
  ) {
    throw new Error(
      "prize top-up RPC must be HTTPS Devnet, never Mainnet or localhost",
    );
  }
  return endpoint.toString().replace(/\/$/, "");
}

function safePositiveInteger(
  value: string,
  label: string,
  allowZero = false,
): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new Error(
      `${label} must be a ${allowZero ? "non-negative" : "positive"} safe integer`,
    );
  }
  return parsed;
}

function u32(value: string, label: string): number {
  const parsed = safePositiveInteger(value, label, true);
  if (parsed > 0xffff_ffff) throw new Error(`${label} must fit in u32`);
  return parsed;
}

function checkedU64Add(left: bigint, right: bigint): bigint {
  const value = left + right;
  if (value > U64_MAX) throw new Error("u64 prize accounting overflow");
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed`);
  }
  return value as Record<string, unknown>;
}

function key(value: unknown, label: string): PublicKey {
  if (value instanceof PublicKey) return value;
  if (typeof value === "string") return new PublicKey(value);
  throw new Error(`${label} is malformed`);
}

function integer(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (BN.isBN(value)) return value.toNumber();
  throw new Error(`${label} is malformed`);
}

function amount(value: unknown, label: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (BN.isBN(value)) return BigInt(value.toString(10));
  throw new Error(`${label} is malformed`);
}

function enumName(value: unknown, label: string): string {
  const record = object(value, label);
  const keys = Object.keys(record);
  if (keys.length !== 1) throw new Error(`${label} is malformed`);
  return keys[0]!;
}

function required(
  env: Record<string, string | undefined>,
  keyName: string,
): string {
  const value = env[keyName]?.trim();
  if (!value) throw new Error(`${keyName} is required`);
  return value;
}

function confirmedStatus(value: string | null | undefined): boolean {
  return value === "confirmed" || value === "finalized";
}

function encodeBase58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)]! + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || "1";
}

export function formatPrizeTopUpResult(result: PrizeTopUpResult): string {
  const { payload } = result;
  const lines = [
    "zKube Devnet manual prize top-up",
    `Mode: ${result.mode}`,
    `Program: ${payload.programId}`,
    `ProgramData SHA-256: ${payload.deployedProgramDataSha256}`,
    `Authority / fee payer: ${payload.authority}`,
    `Observed chain time: ${new Date(payload.observedUnixTimestamp * 1_000).toISOString()}`,
    ...payload.operations.map((operation, index) => {
      const pool = payload.pools[index]!;
      return [
        `Top-up ${index + 1}: ${operation.kind} ${operation.cadenceId}`,
        `  PDA: ${pool.address}`,
        `  Amount: ${operation.lamports} lamports`,
        `  Seeded before/after: ${pool.ledgerBefore.seededLamports}/${pool.seededLamportsAfter}`,
        `  Status / closes: ${pool.status}/${new Date(pool.closesAt * 1_000).toISOString()}`,
      ].join("\n");
    }),
    `Total top-up: ${payload.costs.totalTopUpLamports} lamports`,
    `Maximum fee: ${payload.costs.maximumFeeLamports} lamports`,
    `Maximum authority spend: ${payload.costs.maximumAuthoritySpendLamports} lamports`,
    `Required post-transaction reserve: ${payload.costs.authorityReserveLamports} lamports`,
    `Observed authority balance: ${payload.costs.observedAuthorityBalanceLamports} lamports`,
    `Unsigned simulation units: ${payload.costs.simulatedUnitsConsumed ?? "unavailable"}`,
    `Instruction fingerprint: ${payload.transactionSha256}`,
    `Approval fingerprint: ${result.approvalFingerprint}`,
    `Bundle: ${result.bundlePath}`,
  ];
  if (result.signature) lines.push(`Signature: ${result.signature}`);
  lines.push(
    result.mode === "plan"
      ? "No transaction was signed or sent."
      : "Atomic prize top-up confirmed and seeded balances re-verified.",
  );
  return lines.join("\n");
}
