import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import {
  createPublicKey,
  randomUUID,
  verify as verifyEd25519Signature,
} from "node:crypto";
import { resolve } from "node:path";
import {
  SOLANA_DEVNET_GENESIS_HASH,
  ZKUBE_PROGRAM_ID,
} from "../chain/constants.js";
export { SOLANA_DEVNET_GENESIS_HASH } from "../chain/constants.js";
import {
  CREATE_SESSION_V2_DISCRIMINATOR,
  SESSION_KEYS_PROGRAM_ID,
  decodeSessionTokenV2Account,
  deriveSessionTokenV2Pda,
} from "../chain/sessionV2.js";
import {
  DEFAULT_ACTION_ESCROW_TOP_UP_LAMPORTS,
  MAGIC_ACTION_ESCROW_INDEX,
  deriveMagicActionEscrowPda,
} from "../chain/magicAction.js";

const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
const ZERO_SIGNATURE = new Uint8Array(64);
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const TOP_UP_ESCROW_DISCRIMINATOR = [9, 0, 0, 0, 0, 0, 0, 0] as const;

export const PAYMASTER_MAX_TRANSACTION_BYTES = 1_232;
export const PAYMASTER_SESSION_MAX_SECONDS = 7 * 24 * 60 * 60;

export const SPONSORED_GAME_DISCRIMINATORS = {
  abandonRun: [35, 86, 196, 223, 149, 225, 12, 24],
  claimAchievement: [107, 181, 102, 247, 207, 212, 251, 24],
  claimQuest: [38, 197, 33, 123, 0, 108, 206, 161],
  claimLevelMilestone: [212, 186, 244, 141, 11, 8, 204, 154],
  claimWeeklyCash: [60, 227, 120, 57, 125, 67, 55, 176],
  claimWeeklyStars: [136, 218, 136, 233, 28, 37, 249, 118],
  closeDailyChallenge: [52, 152, 153, 153, 162, 13, 187, 175],
  closeDailyPlayer: [242, 245, 165, 74, 209, 162, 36, 96],
  closeSettledActiveRun: [156, 85, 34, 175, 240, 226, 191, 171],
  closeWeeklyChallenge: [35, 240, 187, 33, 13, 224, 94, 168],
  closeWeeklyPlayer: [51, 43, 88, 88, 15, 27, 82, 179],
  consumeDailyReceipt: [50, 99, 137, 88, 226, 117, 6, 58],
  consumeRunReceipt: [219, 125, 28, 198, 150, 131, 196, 252],
  delegateActiveRun: [219, 238, 221, 207, 119, 217, 2, 99],
  enterDaily: [4, 177, 119, 10, 43, 9, 107, 53],
  finalizeDailyChallenge: [213, 202, 238, 85, 233, 17, 152, 216],
  finalizeWeeklyChallenge: [123, 8, 78, 174, 14, 229, 14, 58],
  forfeitWeeklyCash: [157, 42, 209, 253, 222, 210, 175, 77],
  initializePlayer: [79, 249, 88, 177, 220, 62, 56, 128],
  prepareCampaignRun: [196, 98, 234, 167, 109, 145, 158, 94],
  openDailyChallenge: [109, 163, 247, 10, 101, 164, 13, 157],
  openWeeklyChallenge: [95, 148, 167, 122, 7, 205, 68, 192],
  purchaseStars: [161, 75, 221, 133, 179, 252, 180, 141],
  refundDailyStars: [40, 40, 190, 173, 41, 249, 98, 211],
  rollupDailyToWeekly: [129, 76, 32, 146, 86, 220, 255, 198],
  unlockZone: [53, 23, 251, 131, 76, 21, 202, 35],
} as const;

interface SponsoredGamePolicy {
  authorization: "owner" | "session" | "linked" | "purchase";
  accountCount: number;
  ownerAccountIndex: number;
  sessionAccountIndex?: number;
  actorAccountIndex?: number;
  payerAccountIndex: number | null;
  validatorAccountIndex?: number;
}

const GAME_ACCOUNT_COUNTS: Record<
  keyof typeof SPONSORED_GAME_DISCRIMINATORS,
  number
> = {
  abandonRun: 4,
  claimAchievement: 6,
  claimQuest: 9,
  claimLevelMilestone: 9,
  claimWeeklyCash: 13,
  claimWeeklyStars: 7,
  closeDailyChallenge: 6,
  closeDailyPlayer: 7,
  closeSettledActiveRun: 8,
  closeWeeklyChallenge: 15,
  closeWeeklyPlayer: 7,
  consumeDailyReceipt: 11,
  consumeRunReceipt: 8,
  // Twelve generated IDL accounts plus the router-selected validator passed
  // as the instruction's required remaining account.
  delegateActiveRun: 13,
  enterDaily: 14,
  finalizeDailyChallenge: 3,
  finalizeWeeklyChallenge: 10,
  forfeitWeeklyCash: 7,
  initializePlayer: 7,
  prepareCampaignRun: 12,
  openDailyChallenge: 8,
  openWeeklyChallenge: 11,
  purchaseStars: 11,
  refundDailyStars: 6,
  rollupDailyToWeekly: 10,
  unlockZone: 8,
};

const GAME_POLICIES = new Map<string, SponsoredGamePolicy>([
  sessionPolicy("abandonRun", 1, 2, 3, null),
  sessionPolicy("claimAchievement", 3, 4, 5, null),
  sessionPolicy("claimQuest", 5, 6, 7, 4),
  sessionPolicy("claimLevelMilestone", 5, 6, 7, 4),
  sessionPolicy("claimWeeklyCash", 8, 9, 10, 7),
  sessionPolicy("claimWeeklyStars", 4, 5, 6, null),
  policy("closeDailyChallenge", 5, 2),
  policy("closeDailyPlayer", 6, 5),
  sessionPolicy("closeSettledActiveRun", 0, 1, 2, 4),
  policy("closeWeeklyChallenge", 7, 1),
  policy("closeWeeklyPlayer", 6, 5),
  linkedPolicy("consumeDailyReceipt", 8, null),
  linkedPolicy("consumeRunReceipt", 5, null),
  sessionPolicy("delegateActiveRun", 1, 2, 3, 0, 12),
  sessionPolicy("enterDaily", 10, 11, 12, 9),
  policy("finalizeDailyChallenge", 2, null),
  policy("finalizeWeeklyChallenge", 2, null),
  policy("forfeitWeeklyCash", 6, null),
  sessionPolicy("initializePlayer", 3, 4, 5, 2),
  sessionPolicy("prepareCampaignRun", 8, 9, 10, 7),
  policy("openDailyChallenge", 6, 5),
  policy("openWeeklyChallenge", 9, 8),
  purchasePolicy("purchaseStars", 10),
  sessionPolicy("refundDailyStars", 3, 4, 5, null),
  policy("rollupDailyToWeekly", 8, 7),
  sessionPolicy("unlockZone", 5, 6, 7, null),
]);

function policy(
  name: keyof typeof SPONSORED_GAME_DISCRIMINATORS,
  ownerAccountIndex: number,
  payerAccountIndex: number | null,
): [string, SponsoredGamePolicy] {
  return [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS[name]),
    {
      authorization: "owner",
      accountCount: GAME_ACCOUNT_COUNTS[name],
      ownerAccountIndex,
      payerAccountIndex,
    },
  ];
}

function sessionPolicy(
  name: keyof typeof SPONSORED_GAME_DISCRIMINATORS,
  ownerAccountIndex: number,
  sessionAccountIndex: number,
  actorAccountIndex: number,
  payerAccountIndex: number | null,
  validatorAccountIndex?: number,
): [string, SponsoredGamePolicy] {
  return [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS[name]),
    {
      authorization: "session",
      accountCount: GAME_ACCOUNT_COUNTS[name],
      ownerAccountIndex,
      sessionAccountIndex,
      actorAccountIndex,
      payerAccountIndex,
      ...(validatorAccountIndex === undefined
        ? {}
        : { validatorAccountIndex }),
    },
  ];
}

function purchasePolicy(
  name: "purchaseStars",
  ownerAccountIndex: number,
): [string, SponsoredGamePolicy] {
  return [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS[name]),
    {
      authorization: "purchase",
      accountCount: GAME_ACCOUNT_COUNTS[name],
      ownerAccountIndex,
      payerAccountIndex: null,
    },
  ];
}

/** Permissionless settlement instructions carry an unchecked player owner
 * whose PDA relationships are verified on-chain. The owner must match every
 * other instruction in the envelope, but does not need to sign. */
function linkedPolicy(
  name: keyof typeof SPONSORED_GAME_DISCRIMINATORS,
  ownerAccountIndex: number,
  payerAccountIndex: number | null,
): [string, SponsoredGamePolicy] {
  return [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS[name]),
    {
      authorization: "linked",
      accountCount: GAME_ACCOUNT_COUNTS[name],
      ownerAccountIndex,
      payerAccountIndex,
    },
  ];
}

export interface PaymasterResult {
  status: number;
  body: { signature?: string; pubkey?: string; error?: string };
  telemetry?: {
    operation?: string;
    unitsConsumed?: number;
    signature?: string;
  };
}

export interface PaymasterDependencies {
  keypair: Keypair;
  connection: Connection;
  now?: () => number;
  expectedGenesisHash?: string;
  telemetry?: (event: PaymasterTelemetryEvent) => void;
  requestId?: () => string;
}

export interface PaymasterTelemetryEvent {
  schemaVersion: 1;
  event: "paymaster_request";
  traceId: string;
  layer: "solana-base";
  method: string;
  status: number;
  outcome: string;
  durationMs: number;
  operation?: string;
  unitsConsumed?: number;
  signature?: string;
}

export function paymasterKeypairFromEnv(
  env: Record<string, string | undefined> = process.env,
): Keypair {
  let encoded = env.PAYMASTER_SECRET_KEY;
  if (!encoded && env.PAYMASTER_KEYPAIR_PATH) {
    if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
      throw new Error(
        "PAYMASTER_KEYPAIR_PATH is disabled in production; use secret-manager PAYMASTER_SECRET_KEY",
      );
    }
    try {
      encoded = readFileSync(resolve(env.PAYMASTER_KEYPAIR_PATH), "utf8");
    } catch (error) {
      throw new Error(
        `Unable to read PAYMASTER_KEYPAIR_PATH: ${(error as Error).message}`,
      );
    }
  }
  if (!encoded) {
    throw new Error(
      "PAYMASTER_SECRET_KEY or development PAYMASTER_KEYPAIR_PATH is not configured",
    );
  }
  const parsed = JSON.parse(encoded) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    !parsed.every(
      (byte) => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255,
    )
  ) {
    throw new Error("PAYMASTER_SECRET_KEY must be a 64-byte JSON array");
  }
  const keypair = Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
  const expected = env.ZKUBE_PAYMASTER_PUBLIC_KEY;
  if (expected && keypair.publicKey.toBase58() !== expected) {
    throw new Error(
      "PAYMASTER_SECRET_KEY does not match ZKUBE_PAYMASTER_PUBLIC_KEY",
    );
  }
  return keypair;
}

export function createDevnetPaymasterConnection(
  env: Record<string, string | undefined> = process.env,
): Connection {
  const endpoint =
    env.SOLANA_DEVNET_RPC_URL ?? "https://rpc.magicblock.app/devnet";
  const parsed = new URL(endpoint);
  const local =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error("Paymaster RPC must use HTTPS, except for localhost");
  }
  return new Connection(endpoint, "confirmed");
}

export function validatePaymasterTransaction(
  transaction: VersionedTransaction,
  paymaster: PublicKey,
  nowUnix = Math.floor(Date.now() / 1_000),
): string | null {
  const message = transaction.message;
  const keys = message.staticAccountKeys;
  if (message.addressTableLookups.length !== 0)
    return "address lookup tables are not accepted";
  if (message.header.numRequiredSignatures < 2 || !keys[0]?.equals(paymaster)) {
    return "fee payer must be the paymaster and a player must also sign";
  }
  if (
    message.compiledInstructions.length === 0 ||
    message.compiledInstructions.length > 8
  ) {
    return "instruction count is outside the sponsored policy";
  }
  const serializedMessage = message.serialize();
  for (
    let index = 1;
    index < message.header.numRequiredSignatures;
    index += 1
  ) {
    const signature = transaction.signatures[index];
    const signer = keys[index];
    if (!signature || bytesEqual(signature, ZERO_SIGNATURE)) {
      return `required signer ${keys[index]?.toBase58() ?? index} has not signed`;
    }
    if (
      !signer ||
      !verifyRequiredSignature(signer, signature, serializedMessage)
    ) {
      return `required signer ${signer?.toBase58() ?? index} has an invalid signature`;
    }
  }

  const authorities = new Set<string>();
  let gameInstructionCount = 0;
  let purchaseInstructionCount = 0;
  let purchaseInitializationCount = 0;
  let purchaseInitializationIsOwnerDirect = true;
  let sessionInstructionCount = 0;
  let escrowInstructionCount = 0;
  for (const instruction of message.compiledInstructions) {
    const program = keys[instruction.programIdIndex];
    if (!program) return "instruction program is missing";
    if (program.equals(ComputeBudgetProgram.programId)) {
      return "Compute Budget instructions are not sponsored";
    }
    if (program.equals(ZKUBE_PROGRAM_ID)) {
      gameInstructionCount += 1;
      // The largest sponsored envelope is abandon-first finalization:
      // abandonRun + consumeRunReceipt + closeSettledActiveRun.
      if (gameInstructionCount > 3)
        return "too many zkube instructions in one sponsored transaction";
      const key = discriminatorKey(instruction.data);
      const policy = GAME_POLICIES.get(key);
      if (!policy) return "zkube instruction is not sponsored";
      if (policy.authorization === "purchase") purchaseInstructionCount += 1;
      if (
        key ===
        discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.initializePlayer)
      ) {
        purchaseInitializationCount += 1;
        const initializationOwner =
          keys[instruction.accountKeyIndexes[policy.ownerAccountIndex]];
        const initializationActor =
          policy.actorAccountIndex === undefined
            ? undefined
            : keys[instruction.accountKeyIndexes[policy.actorAccountIndex]];
        const initializationToken =
          policy.sessionAccountIndex === undefined
            ? undefined
            : keys[instruction.accountKeyIndexes[policy.sessionAccountIndex]];
        purchaseInitializationIsOwnerDirect &&=
          Boolean(initializationOwner) &&
          Boolean(initializationActor?.equals(initializationOwner!)) &&
          Boolean(initializationToken?.equals(ZKUBE_PROGRAM_ID));
      }
      const rejection = validateGameInstruction(
        instruction.accountKeyIndexes,
        keys,
        message.header.numRequiredSignatures,
        (index) => message.isAccountWritable(index),
        paymaster,
        policy,
        authorities,
      );
      if (rejection) return rejection;
      continue;
    }
    if (program.equals(SESSION_KEYS_PROGRAM_ID)) {
      sessionInstructionCount += 1;
      if (sessionInstructionCount > 1)
        return "only one SessionTokenV2 creation is sponsored";
      const rejection = validateSessionInstruction(
        instruction.accountKeyIndexes,
        instruction.data,
        keys,
        message.header.numRequiredSignatures,
        paymaster,
        authorities,
        nowUnix,
      );
      if (rejection) return rejection;
      continue;
    }
    if (program.equals(DELEGATION_PROGRAM_ID)) {
      escrowInstructionCount += 1;
      if (escrowInstructionCount > 1)
        return "only one Magic Action escrow top-up is sponsored";
      const rejection = validateEscrowInstruction(
        instruction.accountKeyIndexes,
        instruction.data,
        keys,
        paymaster,
        authorities,
      );
      if (rejection) return rejection;
      continue;
    }
    return `program ${program.toBase58()} is not sponsored`;
  }
  if (authorities.size !== 1)
    return "transaction must sponsor exactly one player authority";
  if (sessionInstructionCount !== 0 && gameInstructionCount !== 0)
    return "session enablement must be a separate owner-approved transaction";
  if (gameInstructionCount === 0 && sessionInstructionCount !== 1)
    return "transaction must contain a zkube instruction or session enablement";
  if (gameInstructionCount === 0 && escrowInstructionCount !== 0)
    return "session enablement cannot include a Magic Action escrow top-up";
  if (
    purchaseInstructionCount !== 0 &&
    (purchaseInstructionCount !== 1 ||
      purchaseInitializationCount > 1 ||
      !purchaseInitializationIsOwnerDirect ||
      gameInstructionCount !== 1 + purchaseInitializationCount ||
      escrowInstructionCount !== 0)
  ) {
    return "Star purchase sponsorship allows only one owner-approved purchase and optional player initialization";
  }
  return null;
}

export async function handlePaymasterRequest(
  method: string,
  payload: unknown,
  dependencies: PaymasterDependencies,
): Promise<PaymasterResult> {
  const startedAt = dependencies.now?.() ?? Date.now();
  const traceId = dependencies.requestId?.() ?? randomUUID();
  const result = await processPaymasterRequest(
    method,
    payload,
    dependencies,
    startedAt,
  );
  try {
    dependencies.telemetry?.({
      schemaVersion: 1,
      event: "paymaster_request",
      traceId,
      layer: "solana-base",
      method: method.toUpperCase().slice(0, 12),
      status: result.status,
      outcome: paymasterOutcome(result),
      durationMs: Math.max(0, (dependencies.now?.() ?? Date.now()) - startedAt),
      ...(result.telemetry?.operation ? { operation: result.telemetry.operation } : {}),
      ...(result.telemetry?.unitsConsumed !== undefined
        ? { unitsConsumed: result.telemetry.unitsConsumed }
        : {}),
      ...(result.telemetry?.signature ? { signature: result.telemetry.signature } : {}),
    });
  } catch {
    // Observability must never acquire signing or availability authority.
  }
  return result;
}

async function processPaymasterRequest(
  method: string,
  payload: unknown,
  dependencies: PaymasterDependencies,
  now: number,
): Promise<PaymasterResult> {
  if (method === "GET") {
    return {
      status: 200,
      body: { pubkey: dependencies.keypair.publicKey.toBase58() },
    };
  }
  if (method !== "POST")
    return { status: 405, body: { error: "method not allowed" } };
  const encoded =
    isRecord(payload) && typeof payload.transaction === "string"
      ? payload.transaction
      : null;
  if (!encoded) return { status: 400, body: { error: "missing transaction" } };
  const raw = Buffer.from(encoded, "base64");
  if (raw.length > PAYMASTER_MAX_TRANSACTION_BYTES) {
    return { status: 400, body: { error: "transaction too large" } };
  }
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(raw);
  } catch {
    return { status: 400, body: { error: "malformed transaction" } };
  }
  const rejection = validatePaymasterTransaction(
    transaction,
    dependencies.keypair.publicKey,
    Math.floor(now / 1_000),
  );
  if (rejection) return { status: 403, body: { error: rejection } };
  const operation = sponsoredOperation(transaction);
  try {
    const genesisHash = await dependencies.connection.getGenesisHash();
    if (
      genesisHash !==
      (dependencies.expectedGenesisHash ?? SOLANA_DEVNET_GENESIS_HASH)
    ) {
      return {
        status: 503,
        body: { error: "paymaster RPC is not the configured devnet" },
      };
    }
  } catch {
    return {
      status: 503,
      body: { error: "unable to verify paymaster RPC cluster" },
    };
  }
  try {
    const sessionRejection = await validateLiveSessionAccounts(
      transaction,
      dependencies.connection,
      dependencies.keypair.publicKey,
      Math.floor(now / 1_000),
    );
    if (sessionRejection) {
      return { status: 403, body: { error: sessionRejection } };
    }
  } catch {
    return {
      status: 503,
      body: { error: "unable to verify scoped session accounts" },
    };
  }
  const simulation = await dependencies.connection.simulateTransaction(
    transaction,
    {
      sigVerify: false,
      replaceRecentBlockhash: false,
    },
  );
  if (simulation.value.err) {
    return {
      status: 422,
      body: { error: "transaction simulation failed" },
      telemetry: {
        operation,
        ...(simulation.value.unitsConsumed !== undefined
          ? { unitsConsumed: simulation.value.unitsConsumed }
          : {}),
      },
    };
  }
  transaction.sign([dependencies.keypair]);
  try {
    const signature = await dependencies.connection.sendRawTransaction(
      transaction.serialize(),
      {
        maxRetries: 5,
        skipPreflight: false,
      },
    );
    return {
      status: 200,
      body: { signature },
      telemetry: {
        operation,
        signature,
        ...(simulation.value.unitsConsumed !== undefined
          ? { unitsConsumed: simulation.value.unitsConsumed }
          : {}),
      },
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        error:
          error instanceof Error ? error.message.slice(0, 200) : "send failed",
      },
    };
  }
}

function sponsoredOperation(transaction: VersionedTransaction): string {
  const keys = transaction.message.staticAccountKeys;
  const names: string[] = [];
  for (const instruction of transaction.message.compiledInstructions) {
    if (!keys[instruction.programIdIndex]?.equals(ZKUBE_PROGRAM_ID)) continue;
    const key = discriminatorKey(instruction.data);
    const name = Object.entries(SPONSORED_GAME_DISCRIMINATORS).find(
      ([, discriminator]) => discriminatorKey(discriminator) === key,
    )?.[0];
    if (name) names.push(name);
  }
  return names.join("+") || "unknown";
}

function paymasterOutcome(result: PaymasterResult): string {
  if (result.status === 200 && result.body.pubkey) return "identity";
  if (result.status === 200 && result.body.signature) return "submitted";
  if (result.status === 405) return "method_rejected";
  if (result.status === 400) {
    if (result.body.error === "missing transaction") return "payload_missing";
    if (result.body.error === "transaction too large")
      return "payload_oversized";
    return "payload_malformed";
  }
  if (result.status === 403) return "policy_rejected";
  if (result.status === 422) return "simulation_failed";
  if (result.status === 502) return "submission_failed";
  if (result.status === 503) {
    return result.body.error === "paymaster RPC is not the configured devnet"
      ? "cluster_mismatch"
      : "cluster_unavailable";
  }
  return "internal_error";
}

function discriminatorKey(value: ArrayLike<number>): string {
  return Array.from(value).slice(0, 8).join(",");
}

function validateGameInstruction(
  accountIndexes: readonly number[],
  keys: PublicKey[],
  requiredSignatures: number,
  isAccountWritable: (index: number) => boolean,
  paymaster: PublicKey,
  policy: SponsoredGamePolicy,
  authorities: Set<string>,
): string | null {
  if (accountIndexes.length !== policy.accountCount) {
    return `zkube instruction account layout is invalid: expected ${policy.accountCount}, received ${accountIndexes.length}`;
  }
  const ownerKeyIndex = accountIndexes[policy.ownerAccountIndex];
  const owner = keys[ownerKeyIndex];
  if (!owner || owner.equals(paymaster)) {
    return "zkube owner authority is invalid";
  }
  if (
    policy.authorization === "owner" ||
    policy.authorization === "purchase"
  ) {
    if (ownerKeyIndex >= requiredSignatures) {
      return "zkube owner must be a non-paymaster transaction signer";
    }
  } else if (policy.authorization === "session") {
    const sessionIndex = policy.sessionAccountIndex;
    const actorIndex = policy.actorAccountIndex;
    if (sessionIndex === undefined || actorIndex === undefined) {
      return "zkube session policy is malformed";
    }
    const actorKeyIndex = accountIndexes[actorIndex];
    const actor = keys[actorKeyIndex];
    const sessionToken = keys[accountIndexes[sessionIndex]];
    if (!actor || actor.equals(paymaster) || actorKeyIndex >= requiredSignatures) {
      return "zkube actor must be a non-paymaster transaction signer";
    }
    if (actor.equals(owner)) {
      if (!sessionToken?.equals(ZKUBE_PROGRAM_ID)) {
        return "direct owner authorization must not include a session token";
      }
    } else {
      const expected = deriveSessionTokenV2Pda({
        authority: owner,
        sessionSigner: actor,
        targetProgram: ZKUBE_PROGRAM_ID,
      }).sessionToken;
      if (!sessionToken?.equals(expected)) {
        return "zkube session token PDA does not match owner and actor";
      }
    }
  }
  authorities.add(owner.toBase58());
  const payerOccurrences = Array.from(accountIndexes).filter((index) =>
    keys[index]?.equals(paymaster),
  );
  if (policy.payerAccountIndex === null) {
    if (payerOccurrences.length !== 0)
      return "paymaster is not an account for this zkube instruction";
  } else if (
    payerOccurrences.length !== 1 ||
    !keys[accountIndexes[policy.payerAccountIndex]]?.equals(paymaster)
  ) {
    return "zkube rent payer must be the paymaster at the expected account position";
  }
  if (policy.validatorAccountIndex !== undefined) {
    const validatorKeyIndex = accountIndexes[policy.validatorAccountIndex];
    const validator = keys[validatorKeyIndex];
    if (
      !validator ||
      validatorKeyIndex < requiredSignatures ||
      isAccountWritable(validatorKeyIndex) ||
      validator.equals(PublicKey.default) ||
      validator.equals(paymaster) ||
      validator.equals(ZKUBE_PROGRAM_ID) ||
      validator.equals(DELEGATION_PROGRAM_ID) ||
      validator.equals(SystemProgram.programId)
    ) {
      return "zkube delegation validator must be a read-only non-signer at the expected account position";
    }
  }
  return null;
}

function validateSessionInstruction(
  accountIndexes: readonly number[],
  data: Uint8Array,
  keys: PublicKey[],
  requiredSignatures: number,
  paymaster: PublicKey,
  authorities: Set<string>,
  nowUnix: number,
): string | null {
  if (
    data.length !== 20 ||
    !startsWith(data, CREATE_SESSION_V2_DISCRIMINATOR) ||
    data[8] !== 1 ||
    data[9] !== 0 ||
    data[10] !== 1 ||
    data[19] !== 0
  )
    return "only bounded SessionTokenV2 creation without a SOL top-up is sponsored";
  const validUntil = readU64Le(data, 11);
  if (
    validUntil <= BigInt(nowUnix) ||
    validUntil > BigInt(nowUnix + PAYMASTER_SESSION_MAX_SECONDS)
  )
    return "SessionTokenV2 lifetime must be positive and at most seven days";
  if (accountIndexes.length !== 6)
    return "SessionTokenV2 account layout is invalid";
  const sessionSignerIndex = accountIndexes[1];
  const sessionSigner = keys[sessionSignerIndex];
  const sessionToken = keys[accountIndexes[0]];
  const feePayer = keys[accountIndexes[2]];
  const authorityIndex = accountIndexes[3];
  const authority = keys[authorityIndex];
  const targetProgram = keys[accountIndexes[4]];
  const systemProgram = keys[accountIndexes[5]];
  if (
    sessionSignerIndex >= requiredSignatures ||
    authorityIndex >= requiredSignatures ||
    !authority ||
    authority.equals(paymaster)
  )
    return "SessionTokenV2 authority and session signer must sign";
  if (!feePayer?.equals(paymaster))
    return "SessionTokenV2 fee payer must be the paymaster";
  if (!targetProgram?.equals(ZKUBE_PROGRAM_ID))
    return "SessionTokenV2 must target zkube";
  if (!systemProgram?.equals(SystemProgram.programId))
    return "SessionTokenV2 system program is invalid";
  if (
    !sessionSigner ||
    !sessionToken?.equals(
      deriveSessionTokenV2Pda({
        authority,
        sessionSigner,
        targetProgram,
      }).sessionToken,
    )
  )
    return "SessionTokenV2 PDA is invalid";
  authorities.add(authority.toBase58());
  return null;
}

async function validateLiveSessionAccounts(
  transaction: VersionedTransaction,
  connection: Connection,
  paymaster: PublicKey,
  nowUnix: number,
): Promise<string | null> {
  const keys = transaction.message.staticAccountKeys;
  const requested = new Map<
    string,
    { address: PublicKey; owner: PublicKey; actor: PublicKey }
  >();
  for (const instruction of transaction.message.compiledInstructions) {
    if (!keys[instruction.programIdIndex]?.equals(ZKUBE_PROGRAM_ID)) continue;
    const policy = GAME_POLICIES.get(discriminatorKey(instruction.data));
    if (!policy || policy.authorization !== "session") continue;
    const sessionIndex = policy.sessionAccountIndex;
    const actorIndex = policy.actorAccountIndex;
    if (sessionIndex === undefined || actorIndex === undefined) {
      return "zkube session policy is malformed";
    }
    const owner = keys[instruction.accountKeyIndexes[policy.ownerAccountIndex]];
    const actor = keys[instruction.accountKeyIndexes[actorIndex]];
    const address = keys[instruction.accountKeyIndexes[sessionIndex]];
    if (!owner || !actor || !address) return "zkube session accounts are missing";
    if (actor.equals(owner)) continue;
    requested.set(address.toBase58(), { address, owner, actor });
  }
  if (requested.size === 0) return null;

  const expected = [...requested.values()];
  const infos = await connection.getMultipleAccountsInfo(
    expected.map(({ address }) => address),
    "confirmed",
  );
  for (const [index, authorization] of expected.entries()) {
    const info = infos[index];
    if (!info) return "scoped session token account is missing";
    let token;
    try {
      token = decodeSessionTokenV2Account(authorization.address, info);
    } catch (error) {
      return error instanceof Error ? error.message : "scoped session token is malformed";
    }
    if (
      !token.authority.equals(authorization.owner) ||
      !token.sessionSigner.equals(authorization.actor) ||
      !token.targetProgram.equals(ZKUBE_PROGRAM_ID) ||
      !token.feePayer.equals(paymaster)
    ) {
      return "scoped session token fields do not match the sponsored action";
    }
    if (token.validUntil <= nowUnix) return "scoped session token has expired";
  }
  return null;
}

function validateEscrowInstruction(
  accountIndexes: readonly number[],
  data: Uint8Array,
  keys: PublicKey[],
  paymaster: PublicKey,
  authorities: Set<string>,
): string | null {
  if (
    data.length !== 17 ||
    !startsWith(data, TOP_UP_ESCROW_DISCRIMINATOR) ||
    readU64Le(data, 8) > BigInt(DEFAULT_ACTION_ESCROW_TOP_UP_LAMPORTS) ||
    readU64Le(data, 8) === 0n ||
    data[16] !== MAGIC_ACTION_ESCROW_INDEX
  )
    return "Magic Action escrow top-up is outside the sponsored limit";
  if (accountIndexes.length !== 4)
    return "Magic Action escrow account layout is invalid";
  const payer = keys[accountIndexes[0]];
  const authority = keys[accountIndexes[1]];
  const escrow = keys[accountIndexes[2]];
  const systemProgram = keys[accountIndexes[3]];
  if (!payer?.equals(paymaster))
    return "Magic Action escrow payer must be the paymaster";
  if (!authority || !escrow?.equals(deriveMagicActionEscrowPda(authority))) {
    return "Magic Action escrow PDA is invalid";
  }
  if (!systemProgram?.equals(SystemProgram.programId))
    return "Magic Action system program is invalid";
  authorities.add(authority.toBase58());
  return null;
}

function readU64Le(value: Uint8Array, offset: number): bigint {
  let result = 0n;
  for (let index = 7; index >= 0; index -= 1) {
    result = (result << 8n) | BigInt(value[offset + index] ?? 0);
  }
  return result;
}

function startsWith(value: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((byte, index) => value[index] === byte);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function verifyRequiredSignature(
  signer: PublicKey,
  signature: Uint8Array,
  message: Uint8Array,
): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(signer.toBytes())]),
      format: "der",
      type: "spki",
    });
    return verifyEd25519Signature(
      null,
      Buffer.from(message),
      publicKey,
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
