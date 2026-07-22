import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type AccountInfo,
  TransactionInstruction,
} from "@solana/web3.js";

import { buildAtomicArcadeLaunchPlan } from "./adminClient";
import { canonicalCampaignMap } from "./campaignCatalog";
import {
  LAUNCH_DAILY_SEED_LAMPORTS,
  LAUNCH_SEASON_SEED_LAMPORTS,
  LAUNCH_WEEKLY_SEED_LAMPORTS,
} from "./deploymentManifest";
import { inspectUpgradeableProgram } from "./deploymentRunner";
import {
  buildZkubeLaunchPlan,
  LAUNCH_ACCOUNT_SPACES,
  launchCadences,
  launchPlannerInputFromEnv,
  launchTransactionSha256,
  type LaunchCostPlan,
  type LaunchPlannerInput,
} from "./launchPlanner";
import {
  deriveArcadeConfigPda,
  deriveArenaDailyPda,
  deriveDailyRulesCatalogPda,
  deriveMapCatalogPda,
  deriveOperatorRevenueVaultPda,
  deriveProtocolConfigPda,
  deriveSeasonPda,
  deriveWeeklyJackpotPda,
} from "./pdas";
import {
  ARENA_ENTRY_LAMPORTS,
  ENTRY_DAILY_LAMPORTS,
  ENTRY_OPERATOR_LAMPORTS,
  ENTRY_SEASON_LAMPORTS,
  ENTRY_WEEKLY_LAMPORTS,
  SECONDS_PER_DAY,
} from "./protocolVersions.generated";
import { createReadOnlyWallet } from "./readOnlyWallet";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import { ZKUBE_PROGRAM_ID } from "./constants";

type LaunchMode = "plan" | "stage" | "resume" | "activate";

interface LaunchTransactionReceipt {
  transactionSha256: string;
  state: "pending" | "confirmed";
  signature: string;
  signatureBase64: string;
  rawTransactionBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

interface LaunchProgress {
  funding?: LaunchTransactionReceipt;
  staged: LaunchTransactionReceipt[];
  activation?: LaunchTransactionReceipt;
}

interface LaunchBundle {
  schema: "zkube-v4-devnet-launch-bundle";
  schemaVersion: 2;
  approvalFingerprint: string;
  approvalEvidenceSha256: string;
  approvalPayload: unknown;
  input: LaunchPlannerInput;
  costs: LaunchCostPlan;
  programDataAddress: string;
  rulesCatalogSha256: string;
  activationTransactionSha256: string;
  progress: LaunchProgress;
}

export interface LaunchRunnerResult {
  mode: LaunchMode;
  approvalFingerprint: string;
  bundlePath: string;
  signatures: string[];
  rulesCatalogSha256: string;
}

const DEFAULT_BUNDLE_PATH = "/tmp/zkube-v4-launch-20656.json";

export async function runLaunchFromEnv(
  env: Record<string, string | undefined> = process.env,
): Promise<LaunchRunnerResult> {
  const mode = launchMode(env.ZKUBE_LAUNCH_MODE);
  const bundlePath = env.ZKUBE_LAUNCH_BUNDLE_PATH?.trim() || DEFAULT_BUNDLE_PATH;
  if (mode === "activate") return activateLaunch(env, bundlePath);
  if (mode === "resume") return resumeStaging(env, bundlePath);

  const input = launchPlannerInputFromEnv(env);
  const connection = new Connection(input.baseRpc, "confirmed");
  const plan = await buildZkubeLaunchPlan(input, connection);
  const result: LaunchRunnerResult = {
    mode,
    approvalFingerprint: plan.approvalFingerprint,
    bundlePath,
    signatures: [],
    rulesCatalogSha256: plan.rulesCatalogSha256,
  };
  if (mode === "plan") return result;

  requireApproval(env, plan.approvalFingerprint);
  if (existsSync(bundlePath)) {
    throw new Error("launch bundle already exists; use resume or choose a fresh path");
  }
  const deployer = loadPinnedKeypair(
    required(env, "ZKUBE_DEPLOYER_KEYPAIR"),
    input.deployer,
    "deployer",
  );
  const authority = loadPinnedKeypair(
    required(env, "ZKUBE_PROTOCOL_AUTHORITY_KEYPAIR"),
    input.authority,
    "protocol authority",
  );
  const activation = plan.plans[20];
  if (!activation) throw new Error("launch plan omitted its atomic activation");
  const bundle: LaunchBundle = {
    schema: "zkube-v4-devnet-launch-bundle",
    schemaVersion: 2,
    approvalFingerprint: plan.approvalFingerprint,
    approvalEvidenceSha256: plan.approvalEvidenceSha256,
    approvalPayload: plan.approvalPayload,
    input,
    costs: plan.costs,
    programDataAddress: plan.programDataAddress,
    rulesCatalogSha256: plan.rulesCatalogSha256,
    activationTransactionSha256: launchTransactionSha256(activation),
    progress: { staged: [] },
  };
  saveBundle(bundlePath, bundle);

  const signatures: string[] = [];
  if (plan.fundingPlan) {
    bundle.progress.funding = await executeApprovedTransaction({
      plan: plan.fundingPlan,
      signer: deployer,
      onReceipt: (receipt) => {
        bundle.progress.funding = receipt;
        saveBundle(bundlePath, bundle);
      },
    });
    signatures.push(bundle.progress.funding.signature);
  }
  await verifyFunding(connection, bundle);
  for (const [index, transaction] of plan.plans.slice(0, 20).entries()) {
    const receipt = await executeApprovedTransaction({
      plan: transaction,
      signer: authority,
      onReceipt: (next) => {
        if (bundle.progress.staged.length === index) {
          bundle.progress.staged.push(next);
        } else {
          bundle.progress.staged[index] = next;
        }
        saveBundle(bundlePath, bundle);
      },
    });
    signatures.push(receipt.signature);
  }
  await verifyStagedLaunch(connection, bundle);
  return { ...result, signatures };
}

async function resumeStaging(
  env: Record<string, string | undefined>,
  bundlePath: string,
): Promise<LaunchRunnerResult> {
  const bundle = parseBundle(readFileSync(bundlePath, "utf8"));
  requireApproval(env, bundle.approvalFingerprint);
  const connection = new Connection(bundle.input.baseRpc, "confirmed");
  await verifyImmutableRelease(connection, bundle);
  const deployer = loadPinnedKeypair(
    required(env, "ZKUBE_DEPLOYER_KEYPAIR"),
    bundle.input.deployer,
    "deployer",
  );
  const authority = loadPinnedKeypair(
    required(env, "ZKUBE_PROTOCOL_AUTHORITY_KEYPAIR"),
    bundle.input.authority,
    "protocol authority",
  );
  const payload = object(bundle.approvalPayload, "launch approval payload");
  const funding = payload.fundingTransaction === null
    ? undefined
    : transactionPlanFromPublic(payload.fundingTransaction, connection);
  const publicTransactions = array(payload.transactions, "approved transactions");
  if (publicTransactions.length !== 21) {
    throw new Error("approved launch must contain exactly 21 transactions");
  }
  const plans = publicTransactions.map((value) =>
    transactionPlanFromPublic(value, connection));
  const signatures: string[] = [];

  if (funding) {
    bundle.progress.funding = await executeApprovedTransaction({
      plan: funding,
      signer: deployer,
      existing: bundle.progress.funding,
      onReceipt: (receipt) => {
        bundle.progress.funding = receipt;
        saveBundle(bundlePath, bundle);
      },
    });
    signatures.push(bundle.progress.funding.signature);
  } else if (bundle.progress.funding) {
    throw new Error("bundle contains an unapproved funding receipt");
  }
  await verifyFunding(connection, bundle);

  if (bundle.progress.staged.length > 20) {
    throw new Error("bundle contains excess staging receipts");
  }
  for (let index = 0; index < 20; index += 1) {
    const existing = bundle.progress.staged[index];
    const receipt = await executeApprovedTransaction({
      plan: plans[index]!,
      signer: authority,
      existing,
      onReceipt: (next) => {
        if (bundle.progress.staged.length === index) {
          bundle.progress.staged.push(next);
        } else {
          bundle.progress.staged[index] = next;
        }
        saveBundle(bundlePath, bundle);
      },
    });
    signatures.push(receipt.signature);
  }
  await verifyStagedLaunch(connection, bundle);
  return {
    mode: "resume",
    approvalFingerprint: bundle.approvalFingerprint,
    bundlePath,
    signatures,
    rulesCatalogSha256: bundle.rulesCatalogSha256,
  };
}

async function activateLaunch(
  env: Record<string, string | undefined>,
  bundlePath: string,
): Promise<LaunchRunnerResult> {
  const bundle = parseBundle(readFileSync(bundlePath, "utf8"));
  requireApproval(env, bundle.approvalFingerprint);
  if (required(env, "ZKUBE_KEEPER_STAGED_RELEASE_FINGERPRINT") !==
      bundle.input.keeperReleaseFingerprint) {
    throw new Error("atomic activation requires the verified staged keeper release");
  }
  const connection = new Connection(bundle.input.baseRpc, "confirmed");
  await verifyImmutableRelease(connection, bundle);
  const authority = loadPinnedKeypair(
    required(env, "ZKUBE_PROTOCOL_AUTHORITY_KEYPAIR"),
    bundle.input.authority,
    "protocol authority",
  );
  const { weekId, seasonId } = launchCadences(bundle.input.launchDayId);
  const plan = await buildAtomicArcadeLaunchPlan({
    connection,
    authority: createReadOnlyWallet(authority.publicKey),
    dayId: bundle.input.launchDayId,
    weekId,
    seasonId,
  });
  if (launchTransactionSha256(plan) !== bundle.activationTransactionSha256) {
    throw new Error("atomic activation instruction bytes drifted after approval");
  }
  if (!bundle.progress.activation) {
    await verifyStagedLaunch(connection, bundle);
  }
  bundle.progress.activation = await executeApprovedTransaction({
    plan,
    signer: authority,
    existing: bundle.progress.activation,
    onReceipt: (receipt) => {
      bundle.progress.activation = receipt;
      saveBundle(bundlePath, bundle);
    },
  });
  await verifyActiveLaunch(connection, bundle);
  return {
    mode: "activate",
    approvalFingerprint: bundle.approvalFingerprint,
    bundlePath,
    signatures: [bundle.progress.activation.signature],
    rulesCatalogSha256: bundle.rulesCatalogSha256,
  };
}

async function verifyImmutableRelease(
  connection: Connection,
  bundle: LaunchBundle,
): Promise<void> {
  const genesis = await connection.getGenesisHash();
  if (genesis !== bundle.input.expectedGenesisHash) {
    throw new Error("activation RPC is not the approved Devnet genesis");
  }
  const slot = await connection.getSlot("confirmed");
  const now = await connection.getBlockTime(slot);
  if (now === null || now > bundle.input.launchCutoffUnixTimestamp) {
    throw new Error("approved launch cutoff has expired");
  }
  const deployed = await inspectUpgradeableProgram(connection, ZKUBE_PROGRAM_ID);
  if (deployed.programDataAddress.toBase58() !== bundle.programDataAddress ||
      deployed.deployedSbfSha256 !== bundle.input.deployedProgramDataSha256 ||
      deployed.programCapacityBytes !== bundle.input.programAllocationBytes ||
      deployed.upgradeAuthority !== bundle.input.programUpgradeAuthority) {
    throw new Error("deployed program drifted after launch approval");
  }
}

async function verifyFunding(
  connection: Connection,
  bundle: LaunchBundle,
): Promise<void> {
  const authority = new PublicKey(bundle.input.authority);
  const team = new PublicKey(bundle.input.teamDestination);
  const [authorityBalance, teamInfo] = await Promise.all([
    connection.getBalance(authority, "confirmed"),
    connection.getAccountInfo(team, "confirmed"),
  ]);
  if (authorityBalance < bundle.costs.requiredAuthorityBalanceLamports) {
    throw new Error("launch authority funding did not reach the approved floor");
  }
  requireSystemWallet(teamInfo, "team destination");
}

async function verifyStagedLaunch(
  connection: Connection,
  bundle: LaunchBundle,
): Promise<void> {
  const authority = new PublicKey(bundle.input.authority);
  const program = zkubeProgram(connection, createReadOnlyWallet(authority));
  const protocol = await fetchExact(
    connection,
    program,
    "protocolConfig",
    deriveProtocolConfigPda(),
    LAUNCH_ACCOUNT_SPACES.protocolConfig,
  );
  if (!key(protocol.authority).equals(authority) ||
      !key(protocol.teamDestination).equals(new PublicKey(bundle.input.teamDestination)) ||
      bytesHex(protocol.replayDomain) !== bundle.input.replayDomainHex ||
      integer(protocol.contentVersion) !== 2 ||
      integer(protocol.dailyRulesVersion) !== 1 ||
      integer(protocol.campaignMapCount) !== 10 ||
      protocol.paused !== true) {
    throw new Error("paused protocol carrier does not match launch approval");
  }

  for (let mapId = 1; mapId <= 10; mapId += 1) {
    const map = await fetchExact(
      connection,
      program,
      "mapCatalog",
      deriveMapCatalogPda(2, mapId),
      LAUNCH_ACCOUNT_SPACES.mapCatalog,
    );
    const expected = canonicalCampaignMap(2, mapId);
    if (integer(map.contentVersion) !== 2 || integer(map.mapId) !== mapId ||
        integer(map.themeId) !== expected.themeId || map.enabled !== true ||
        !isDeepStrictEqual(normalize(map.mapRules), expected.mapRules) ||
        !isDeepStrictEqual(normalize(map.levels), expected.levels)) {
      throw new Error(`Campaign map ${mapId} does not match the approved release`);
    }
  }

  const rules = await fetchExact(
    connection,
    program,
    "dailyRulesCatalog",
    deriveDailyRulesCatalogPda(1),
    LAUNCH_ACCOUNT_SPACES.dailyRulesCatalog,
  );
  if (integer(rules.rulesVersion) !== 1 || integer(rules.contentVersion) !== 2 ||
      integer(rules.startsDay) !== bundle.input.launchDayId ||
      bytesHex(rules.catalogHash) !== bundle.rulesCatalogSha256) {
    throw new Error("Arena rules catalog does not match the approved release");
  }

  const arcade = await fetchExact(
    connection,
    program,
    "arcadeConfig",
    deriveArcadeConfigPda(),
    LAUNCH_ACCOUNT_SPACES.arcadeConfig,
  );
  if (arcade.launchSeeded !== false || integer(arcade.launchDayId) !== 0 ||
      amount(arcade.entryLamports) !== ARENA_ENTRY_LAMPORTS ||
      amount(arcade.dailyLamports) !== ENTRY_DAILY_LAMPORTS ||
      amount(arcade.weeklyLamports) !== ENTRY_WEEKLY_LAMPORTS ||
      amount(arcade.seasonLamports) !== ENTRY_SEASON_LAMPORTS ||
      amount(arcade.operatorLamports) !== ENTRY_OPERATOR_LAMPORTS) {
    throw new Error("paused ArcadeConfig does not match the approved economy");
  }
  const vault = await fetchExact(
    connection,
    program,
    "operatorRevenueVault",
    deriveOperatorRevenueVaultPda(),
    LAUNCH_ACCOUNT_SPACES.operatorRevenueVault,
  );
  if (amount(vault.grossOperatorShare) !== 0n || amount(vault.withdrawn) !== 0n) {
    throw new Error("operator vault is not fresh");
  }
  await verifyPeriods(connection, program, bundle, false);
}

async function verifyActiveLaunch(
  connection: Connection,
  bundle: LaunchBundle,
): Promise<void> {
  const authority = new PublicKey(bundle.input.authority);
  const program = zkubeProgram(connection, createReadOnlyWallet(authority));
  const protocol = await fetchExact(
    connection,
    program,
    "protocolConfig",
    deriveProtocolConfigPda(),
    LAUNCH_ACCOUNT_SPACES.protocolConfig,
  );
  const arcade = await fetchExact(
    connection,
    program,
    "arcadeConfig",
    deriveArcadeConfigPda(),
    LAUNCH_ACCOUNT_SPACES.arcadeConfig,
  );
  if (protocol.paused !== false || arcade.launchSeeded !== true ||
      integer(arcade.launchDayId) !== bundle.input.launchDayId) {
    throw new Error("atomic launch did not activate the approved cadence");
  }
  await verifyPeriods(connection, program, bundle, true);
  const balance = await connection.getBalance(authority, "confirmed");
  if (balance < bundle.costs.authorityReserveLamports) {
    throw new Error("launch crossed the approved authority reserve");
  }
}

async function verifyPeriods(
  connection: Connection,
  program: ReturnType<typeof zkubeProgram>,
  bundle: LaunchBundle,
  active: boolean,
): Promise<void> {
  const dayId = bundle.input.launchDayId;
  const { weekId, seasonId } = launchCadences(dayId);
  for (const id of [dayId, dayId + 1]) {
    const value = await fetchExact(
      connection,
      program,
      "arenaDaily",
      deriveArenaDailyPda(id),
      LAUNCH_ACCOUNT_SPACES.arenaDaily,
    );
    verifyPeriod(value, id === dayId && active, id === dayId && active
      ? BigInt(LAUNCH_DAILY_SEED_LAMPORTS)
      : 0n, "Daily");
  }
  for (const id of [weekId, weekId + 1]) {
    const value = await fetchExact(
      connection,
      program,
      "weeklyJackpot",
      deriveWeeklyJackpotPda(id),
      LAUNCH_ACCOUNT_SPACES.weeklyJackpot,
    );
    verifyPeriod(value, id === weekId && active, id === weekId && active
      ? BigInt(LAUNCH_WEEKLY_SEED_LAMPORTS)
      : 0n, "Weekly");
    const expectedStart = id === weekId && active
      ? dayId
      : id * 7 + 4;
    if (integer(value.qualificationStartDay) !== expectedStart) {
      throw new Error("Weekly qualification start is invalid");
    }
  }
  for (const id of [seasonId, seasonId + 1]) {
    const value = await fetchExact(
      connection,
      program,
      "season",
      deriveSeasonPda(id),
      LAUNCH_ACCOUNT_SPACES.season,
    );
    verifyPeriod(value, id === seasonId && active, id === seasonId && active
      ? BigInt(LAUNCH_SEASON_SEED_LAMPORTS)
      : 0n, "Season");
    const expectedStart = id === seasonId && active
      ? dayId
      : id * 28 + 4;
    if (integer(value.qualificationStartDay) !== expectedStart) {
      throw new Error("Season qualification start is invalid");
    }
  }
}

function verifyPeriod(
  value: Record<string, unknown>,
  active: boolean,
  seededLamports: bigint,
  label: string,
): void {
  if (enumName(value.status) !== (active ? "open" : "funding") ||
      value.predecessorRolloverApplied !== active) {
    throw new Error(`${label} status or predecessor flag is invalid`);
  }
  const ledger = object(value.ledger, `${label} ledger`);
  if (amount(ledger.seededLamports) !== seededLamports ||
      amount(ledger.entryLamports) !== 0n ||
      amount(ledger.rolloverInLamports) !== 0n ||
      amount(ledger.payoutLamports) !== 0n ||
      amount(ledger.rolloverOutLamports) !== 0n) {
    throw new Error(`${label} launch ledger is invalid`);
  }
}

async function fetchExact(
  connection: Connection,
  program: ReturnType<typeof zkubeProgram>,
  name: string,
  address: PublicKey,
  size: number,
): Promise<Record<string, unknown>> {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info || info.executable || !info.owner.equals(ZKUBE_PROGRAM_ID) ||
      info.data.length !== size) {
    throw new Error(`${name} account owner, size, or PDA is invalid`);
  }
  try {
    return object(program.coder.accounts.decode(name, info.data), name);
  } catch {
    throw new Error(`${name} account discriminator or data is invalid`);
  }
}

async function executeApprovedTransaction(args: {
  plan: TransactionPlan;
  signer: Keypair;
  existing?: LaunchTransactionReceipt;
  onReceipt?: (receipt: LaunchTransactionReceipt) => void;
}): Promise<LaunchTransactionReceipt> {
  const { plan, signer } = args;
  if (!plan.feePayer.equals(signer.publicKey)) {
    throw new Error(`${plan.label} fee payer does not match its pinned signer`);
  }
  const transactionSha256 = launchTransactionSha256(plan);
  if (args.existing) {
    verifyReceipt(args.existing, plan, signer.publicKey);
    if (args.existing.transactionSha256 !== transactionSha256) {
      throw new Error(`${plan.label} receipt does not match its approved transaction`);
    }
    const status = await plan.connection.getSignatureStatus(args.existing.signature, {
      searchTransactionHistory: true,
    });
    if (status.value?.err) {
      throw new Error(`${plan.label} previously failed: ${JSON.stringify(status.value.err)}`);
    }
    if (confirmedStatus(status.value?.confirmationStatus)) {
      const confirmed = { ...args.existing, state: "confirmed" as const };
      args.onReceipt?.(confirmed);
      return confirmed;
    }
    if (args.existing.state === "confirmed") {
      throw new Error(`${plan.label} confirmed receipt is no longer visible on Devnet`);
    }
    const stillValid = await plan.connection.isBlockhashValid(
      args.existing.blockhash,
      { commitment: "confirmed" },
    );
    if (stillValid.value) {
      const raw = Buffer.from(args.existing.rawTransactionBase64, "base64");
      const relayed = await plan.connection.sendRawTransaction(raw, {
        maxRetries: 5,
        skipPreflight: false,
      });
      if (relayed !== args.existing.signature) {
        throw new Error(`${plan.label} recovered signature drifted`);
      }
      const confirmed = await confirmReceipt(plan, args.existing);
      args.onReceipt?.(confirmed);
      return confirmed;
    }
  }

  const latest = await plan.connection.getLatestBlockhash("confirmed");
  const transaction = plan.transaction as Transaction;
  transaction.feePayer = signer.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(signer);
  const simulation = await plan.connection.simulateTransaction(transaction);
  if (simulation.value.err) {
    throw new Error(`${plan.label} simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }
  const raw = transaction.serialize();
  const signatureBytes = transaction.signature;
  if (!signatureBytes || !transaction.verifySignatures()) {
    throw new Error(`${plan.label} did not produce a valid pinned signature`);
  }
  const signature = encodeBase58(signatureBytes);
  const pending: LaunchTransactionReceipt = {
    transactionSha256,
    state: "pending",
    signature,
    signatureBase64: Buffer.from(signatureBytes).toString("base64"),
    rawTransactionBase64: raw.toString("base64"),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
  args.onReceipt?.(pending);
  const relayed = await plan.connection.sendRawTransaction(
    raw,
    { maxRetries: 5, skipPreflight: false },
  );
  if (relayed !== signature) {
    throw new Error(`${plan.label} submitted signature drifted`);
  }
  const confirmed = await confirmReceipt(plan, pending);
  args.onReceipt?.(confirmed);
  return confirmed;
}

async function confirmReceipt(
  plan: TransactionPlan,
  receipt: LaunchTransactionReceipt,
): Promise<LaunchTransactionReceipt> {
  const confirmation = await plan.connection.confirmTransaction({
    blockhash: receipt.blockhash,
    lastValidBlockHeight: receipt.lastValidBlockHeight,
    signature: receipt.signature,
  }, "confirmed");
  if (confirmation.value.err) {
    throw new Error(`${plan.label} confirmation failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  const status = await plan.connection.getSignatureStatus(receipt.signature, {
    searchTransactionHistory: true,
  });
  if (!status.value || status.value.err ||
      !confirmedStatus(status.value.confirmationStatus)) {
    throw new Error(`${plan.label} could not be re-verified after confirmation`);
  }
  return { ...receipt, state: "confirmed" };
}

function confirmedStatus(value: string | null | undefined): boolean {
  return value === "confirmed" || value === "finalized";
}

function verifyReceipt(
  receipt: LaunchTransactionReceipt,
  plan: TransactionPlan,
  signer: PublicKey,
): void {
  if (!/^[0-9a-f]{64}$/.test(receipt.transactionSha256) ||
      !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(receipt.signature) ||
      !Number.isSafeInteger(receipt.lastValidBlockHeight) ||
      receipt.lastValidBlockHeight <= 0 ||
      (receipt.state !== "pending" && receipt.state !== "confirmed")) {
    throw new Error(`${plan.label} receipt is malformed`);
  }
  const raw = Buffer.from(receipt.rawTransactionBase64, "base64");
  const transaction = Transaction.from(raw);
  if (!transaction.feePayer?.equals(signer) || !transaction.recentBlockhash ||
      transaction.recentBlockhash !== receipt.blockhash ||
      !transaction.signature ||
      encodeBase58(transaction.signature) !== receipt.signature ||
      Buffer.from(transaction.signature).toString("base64") !== receipt.signatureBase64 ||
      !transaction.verifySignatures()) {
    throw new Error(`${plan.label} receipt signature or fee payer is invalid`);
  }
  const expected = new Transaction().add(...plan.transaction.instructions);
  expected.feePayer = signer;
  expected.recentBlockhash = receipt.blockhash;
  if (!Buffer.from(expected.serializeMessage()).equals(transaction.serializeMessage())) {
    throw new Error(`${plan.label} receipt instruction bytes drifted from approval`);
  }
}

function transactionPlanFromPublic(
  value: unknown,
  connection: Connection,
): TransactionPlan {
  const publicPlan = object(value, "approved transaction");
  if (publicPlan.layer !== "solana-base" ||
      typeof publicPlan.label !== "string" || !publicPlan.label ||
      typeof publicPlan.feePayer !== "string") {
    throw new Error("approved transaction header is malformed");
  }
  const feePayer = new PublicKey(publicPlan.feePayer);
  const transaction = new Transaction();
  for (const rawInstruction of array(
    publicPlan.instructions,
    "approved transaction instructions",
  )) {
    const instruction = object(rawInstruction, "approved instruction");
    if (typeof instruction.programId !== "string" ||
        typeof instruction.dataBase64 !== "string") {
      throw new Error("approved instruction is malformed");
    }
    const data = Buffer.from(instruction.dataBase64, "base64");
    if (data.toString("base64") !== instruction.dataBase64) {
      throw new Error("approved instruction data is not canonical base64");
    }
    transaction.add(new TransactionInstruction({
      programId: new PublicKey(instruction.programId),
      keys: array(instruction.accounts, "approved instruction accounts")
        .map((rawAccount) => {
          const account = object(rawAccount, "approved instruction account");
          if (typeof account.publicKey !== "string" ||
              typeof account.signer !== "boolean" ||
              typeof account.writable !== "boolean") {
            throw new Error("approved instruction account is malformed");
          }
          return {
            pubkey: new PublicKey(account.publicKey),
            isSigner: account.signer,
            isWritable: account.writable,
          };
        }),
      data,
    }));
  }
  if (transaction.instructions.length === 0) {
    throw new Error("approved transaction has no instructions");
  }
  return {
    layer: "solana-base",
    label: publicPlan.label,
    connection,
    transaction,
    feePayer,
    signers: [],
  };
}

function saveBundle(path: string, bundle: LaunchBundle): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(bundle, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
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

function loadPinnedKeypair(path: string, expected: string, label: string): Keypair {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed) || parsed.length !== 64 ||
      !parsed.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw new Error(`${label} keypair file is malformed`);
  }
  const keypair = Keypair.fromSecretKey(Uint8Array.from(parsed));
  if (keypair.publicKey.toBase58() !== expected) {
    throw new Error(`${label} keypair does not match the approved public key`);
  }
  return keypair;
}

function parseBundle(source: string): LaunchBundle {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object" ||
      (value as { schema?: unknown }).schema !== "zkube-v4-devnet-launch-bundle" ||
      (value as { schemaVersion?: unknown }).schemaVersion !== 2) {
    throw new Error("launch bundle is malformed or unsupported");
  }
  const bundle = value as LaunchBundle;
  const recomputedApproval = createHash("sha256")
    .update(JSON.stringify(bundle.approvalPayload))
    .digest("hex");
  if (!/^[0-9a-f]{64}$/.test(bundle.approvalFingerprint) ||
      !/^[0-9a-f]{64}$/.test(bundle.activationTransactionSha256) ||
      !/^[0-9a-f]{64}$/.test(bundle.rulesCatalogSha256) ||
      bundle.approvalFingerprint !== bundle.approvalEvidenceSha256 ||
      recomputedApproval !== bundle.approvalFingerprint) {
    throw new Error("launch bundle hashes are malformed");
  }
  const payload = object(bundle.approvalPayload, "launch approval payload");
  const observed = object(payload.observed, "launch approval observation");
  const transactions = array(payload.transactions, "approved transactions");
  if (!isDeepStrictEqual(payload.input, bundle.input) ||
      !isDeepStrictEqual(payload.costs, bundle.costs) ||
      observed.programDataAddress !== bundle.programDataAddress ||
      observed.rulesCatalogSha256 !== bundle.rulesCatalogSha256 ||
      transactions.length !== 21 ||
      createHash("sha256")
        .update(JSON.stringify(transactions[20]))
        .digest("hex") !== bundle.activationTransactionSha256) {
    throw new Error("launch bundle fields drifted from approved evidence");
  }
  const progress = object(bundle.progress, "launch progress");
  if (!Array.isArray(progress.staged) ||
      progress.staged.length > 20 ||
      (progress.funding !== undefined &&
        (typeof progress.funding !== "object" || progress.funding === null)) ||
      (progress.activation !== undefined &&
        (typeof progress.activation !== "object" || progress.activation === null))) {
    throw new Error("launch progress is malformed");
  }
  return bundle;
}

function requireApproval(
  env: Record<string, string | undefined>,
  expected: string,
): void {
  if (env.ZKUBE_LAUNCH_APPROVAL?.trim() !== expected) {
    throw new Error(`launch blocked: exact approval ${expected} is required`);
  }
}

function launchMode(value: string | undefined): LaunchMode {
  const mode = value?.trim() || "plan";
  if (mode !== "plan" && mode !== "stage" && mode !== "resume" &&
      mode !== "activate") {
    throw new Error("ZKUBE_LAUNCH_MODE must be plan, stage, resume, or activate");
  }
  return mode;
}

function required(env: Record<string, string | undefined>, keyName: string): string {
  const value = env[keyName]?.trim();
  if (!value) throw new Error(`${keyName} is required`);
  return value;
}

function requireSystemWallet(info: AccountInfo<Buffer> | null, label: string): void {
  if (!info || info.executable || !info.owner.equals(SystemProgram.programId) ||
      info.data.length !== 0) {
    throw new Error(`${label} must be an existing System-owned zero-data account`);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is malformed`);
  return value;
}

function key(value: unknown): PublicKey {
  if (value instanceof PublicKey) return value;
  if (typeof value === "string") return new PublicKey(value);
  throw new Error("decoded public key is malformed");
}

function integer(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (BN.isBN(value)) return value.toNumber();
  throw new Error("decoded integer is malformed");
}

function amount(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (BN.isBN(value)) return BigInt(value.toString(10));
  throw new Error("decoded amount is malformed");
}

function bytesHex(value: unknown): string {
  const bytes = value instanceof Uint8Array
    ? value
    : Array.isArray(value)
      ? Uint8Array.from(value as number[])
      : undefined;
  if (!bytes || bytes.length !== 32) throw new Error("decoded bytes32 is malformed");
  return Buffer.from(bytes).toString("hex");
}

function enumName(value: unknown): string {
  const record = object(value, "enum");
  const keys = Object.keys(record);
  if (keys.length !== 1) throw new Error("decoded enum is malformed");
  return keys[0]!;
}

function normalize(value: unknown): unknown {
  if (BN.isBN(value)) return value.toNumber();
  if (value instanceof PublicKey) return value.toBase58();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([name, child]) => [name, normalize(child)]),
    );
  }
  return value;
}

export function formatLaunchRunnerResult(result: LaunchRunnerResult): string {
  return [
    `Mode: ${result.mode}`,
    `Approval fingerprint: ${result.approvalFingerprint}`,
    `Arena catalog SHA-256: ${result.rulesCatalogSha256}`,
    `Bundle: ${result.bundlePath}`,
    ...result.signatures.map((signature, index) =>
      `Signature ${index + 1}: ${signature}`),
    ...(result.mode === "plan"
      ? ["No transaction was signed or sent."]
      : result.mode === "stage" || result.mode === "resume"
        ? ["Paused launch carrier staged; atomic activation was not sent."]
        : ["Atomic seed and activation confirmed."]),
  ].join("\n");
}
