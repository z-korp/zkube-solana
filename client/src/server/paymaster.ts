import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SOLANA_DEVNET_GENESIS_HASH,
  ZKUBE_PROGRAM_ID,
} from "../chain/constants.js";
export { SOLANA_DEVNET_GENESIS_HASH } from "../chain/constants.js";
import {
  CREATE_SESSION_V2_DISCRIMINATOR,
  SESSION_KEYS_PROGRAM_ID,
  deriveSessionTokenV2Pda,
} from "../chain/sessionV2.js";
import {
  DEFAULT_ACTION_ESCROW_TOP_UP_LAMPORTS,
  MAGIC_ACTION_ESCROW_INDEX,
  deriveMagicActionEscrowPda,
} from "../chain/magicAction.js";
import {
  deriveProtocolConfigPda,
  deriveSponsorAllowancePda,
  deriveTreasuryLedgerPda,
} from "../chain/pdas.js";

const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
const ZERO_SIGNATURE = new Uint8Array(64);
const TOP_UP_ESCROW_DISCRIMINATOR = [9, 0, 0, 0, 0, 0, 0, 0] as const;

export const PAYMASTER_MAX_TRANSACTION_BYTES = 1_232;
export const PAYMASTER_SESSION_MAX_SECONDS = 7 * 24 * 60 * 60;

export const SPONSORED_GAME_DISCRIMINATORS = {
  abandonRunV1: [125, 40, 244, 230, 253, 139, 171, 92],
  claimAchievementV1: [89, 171, 8, 91, 40, 109, 245, 208],
  claimDailyPrizeV1: [176, 233, 126, 177, 41, 111, 81, 233],
  claimQuestV1: [61, 90, 44, 10, 13, 189, 4, 3],
  consumeSponsorshipV1: [59, 233, 232, 90, 10, 245, 139, 141],
  closeSettledActiveRunV1: [15, 185, 11, 182, 7, 135, 180, 159],
  consumeDailyReceiptV1: [167, 133, 90, 4, 83, 62, 112, 143],
  consumeRunReceiptV1: [153, 5, 99, 189, 42, 139, 168, 22],
  delegateActiveRunV1: [197, 109, 88, 188, 239, 118, 146, 107],
  enterDailyPaidV1: [243, 167, 161, 133, 50, 97, 189, 39],
  enterDailyWithStarsV1: [35, 6, 113, 106, 140, 138, 65, 187],
  initializePlayerV1: [99, 199, 152, 251, 221, 241, 157, 188],
  prepareCampaignRunV1: [119, 10, 2, 12, 124, 82, 222, 248],
  purchaseMapWithUsdcV1: [4, 155, 216, 148, 66, 187, 242, 232],
  refundDailyEntryV1: [116, 103, 39, 233, 230, 94, 180, 217],
  rotateRunShellAuthorityV1: [223, 191, 8, 214, 182, 95, 10, 124],
  unlockMapWithStarsV1: [217, 210, 254, 241, 119, 234, 184, 212],
} as const;

interface SponsoredGamePolicy {
  ownerAccountIndex: number;
  payerAccountIndex: number | null;
}

const GAME_POLICIES = new Map<string, SponsoredGamePolicy>([
  [
    // Owner-signed abandon of a stuck non-terminal base run; the actor is
    // the player signer and the bundled consume/close settle it for rent.
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.abandonRunV1),
    {
      ownerAccountIndex: 3,
      payerAccountIndex: null,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.claimAchievementV1),
    {
      ownerAccountIndex: 4,
      payerAccountIndex: null,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.claimDailyPrizeV1),
    {
      ownerAccountIndex: 7,
      payerAccountIndex: null,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.claimQuestV1),
    {
      ownerAccountIndex: 5,
      payerAccountIndex: 4,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.consumeSponsorshipV1),
    {
      ownerAccountIndex: 3,
      payerAccountIndex: 2,
    },
  ],
  [
    // The payer slot doubles as the rent recipient: cleanup returns every
    // run rent to the protocol paymaster that fronted it at prepare.
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.closeSettledActiveRunV1),
    {
      ownerAccountIndex: 0,
      payerAccountIndex: 2,
    },
  ],
  [
    // Base-layer settlement completion when the Magic Action stalled. The
    // program needs no signer (owner is unchecked), but the sponsored-shape
    // policy still pins the owner to a transaction signer — the bundled
    // close instruction provides that signature.
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.consumeRunReceiptV1),
    {
      ownerAccountIndex: 5,
      payerAccountIndex: null,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.consumeDailyReceiptV1),
    {
      ownerAccountIndex: 7,
      payerAccountIndex: null,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.delegateActiveRunV1),
    {
      ownerAccountIndex: 1,
      payerAccountIndex: 0,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.enterDailyPaidV1),
    {
      ownerAccountIndex: 12,
      payerAccountIndex: 11,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.enterDailyWithStarsV1),
    {
      ownerAccountIndex: 8,
      payerAccountIndex: 7,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.initializePlayerV1),
    {
      ownerAccountIndex: 3,
      payerAccountIndex: 2,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.prepareCampaignRunV1),
    {
      ownerAccountIndex: 8,
      payerAccountIndex: 7,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.purchaseMapWithUsdcV1),
    {
      ownerAccountIndex: 8,
      payerAccountIndex: null,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.refundDailyEntryV1),
    {
      ownerAccountIndex: 7,
      payerAccountIndex: null,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.rotateRunShellAuthorityV1),
    {
      ownerAccountIndex: 1,
      payerAccountIndex: null,
    },
  ],
  [
    discriminatorKey(SPONSORED_GAME_DISCRIMINATORS.unlockMapWithStarsV1),
    {
      ownerAccountIndex: 4,
      payerAccountIndex: null,
    },
  ],
]);
const CONSUME_SPONSORSHIP_KEY = discriminatorKey(
  SPONSORED_GAME_DISCRIMINATORS.consumeSponsorshipV1,
);

export interface PaymasterResult {
  status: number;
  body: { signature?: string; pubkey?: string; error?: string };
}

export interface PaymasterDependencies {
  keypair: Keypair;
  connection: Connection;
  now?: () => number;
  expectedGenesisHash?: string;
  telemetry?: (event: PaymasterTelemetryEvent) => void;
}

export interface PaymasterTelemetryEvent {
  event: "paymaster_request";
  method: string;
  status: number;
  outcome: string;
  durationMs: number;
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
  if (!Array.isArray(parsed) || parsed.length !== 64) {
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
  for (
    let index = 1;
    index < message.header.numRequiredSignatures;
    index += 1
  ) {
    if (
      !transaction.signatures[index] ||
      bytesEqual(transaction.signatures[index], ZERO_SIGNATURE)
    ) {
      return `required signer ${keys[index]?.toBase58() ?? index} has not signed`;
    }
  }

  const authorities = new Set<string>();
  let gameInstructionCount = 0;
  let gamePayloadCount = 0;
  let sponsorshipInstructionCount = 0;
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
      // consumeSponsorshipV1 + abandonRunV1 + consumeRunReceiptV1 +
      // closeSettledActiveRunV1.
      if (gameInstructionCount > 4)
        return "too many zkube instructions in one sponsored transaction";
      const key = discriminatorKey(instruction.data);
      if (key === CONSUME_SPONSORSHIP_KEY) sponsorshipInstructionCount += 1;
      else gamePayloadCount += 1;
      if (gamePayloadCount > 3) {
        return "too many zkube payload instructions in one sponsored transaction";
      }
      const policy = GAME_POLICIES.get(key);
      if (!policy) return "zkube instruction is not sponsored";
      const rejection = validateGameInstruction(
        instruction.accountKeyIndexes,
        keys,
        message.header.numRequiredSignatures,
        paymaster,
        policy,
        authorities,
      );
      if (rejection) return rejection;
      if (key === CONSUME_SPONSORSHIP_KEY) {
        const sponsorshipRejection = validateSponsorshipInstruction(
          instruction.accountKeyIndexes,
          keys,
          paymaster,
        );
        if (sponsorshipRejection) return sponsorshipRejection;
      }
      if (
        key ===
          discriminatorKey(
            SPONSORED_GAME_DISCRIMINATORS.purchaseMapWithUsdcV1,
          ) &&
        !keys[instruction.accountKeyIndexes[1]]?.equals(
          deriveTreasuryLedgerPda(),
        )
      )
        return "treasury ledger account is invalid";
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
  if (sponsorshipInstructionCount !== 1 || gamePayloadCount === 0) {
    return "transaction must consume exactly one on-chain sponsorship allowance";
  }
  return null;
}

export async function handlePaymasterRequest(
  method: string,
  payload: unknown,
  dependencies: PaymasterDependencies,
): Promise<PaymasterResult> {
  const startedAt = dependencies.now?.() ?? Date.now();
  const result = await processPaymasterRequest(
    method,
    payload,
    dependencies,
    startedAt,
  );
  try {
    dependencies.telemetry?.({
      event: "paymaster_request",
      method: method.toUpperCase().slice(0, 12),
      status: result.status,
      outcome: paymasterOutcome(result),
      durationMs: Math.max(0, (dependencies.now?.() ?? Date.now()) - startedAt),
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
  transaction.sign([dependencies.keypair]);
  const simulation = await dependencies.connection.simulateTransaction(
    transaction,
    {
      sigVerify: true,
      replaceRecentBlockhash: false,
    },
  );
  if (simulation.value.err) {
    return { status: 422, body: { error: "transaction simulation failed" } };
  }
  try {
    const signature = await dependencies.connection.sendRawTransaction(
      transaction.serialize(),
      {
        maxRetries: 5,
        skipPreflight: false,
      },
    );
    return { status: 200, body: { signature } };
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
  paymaster: PublicKey,
  policy: SponsoredGamePolicy,
  authorities: Set<string>,
): string | null {
  const ownerKeyIndex = accountIndexes[policy.ownerAccountIndex];
  const owner = keys[ownerKeyIndex];
  if (
    !owner ||
    ownerKeyIndex >= requiredSignatures ||
    owner.equals(paymaster)
  ) {
    return "zkube owner must be a non-paymaster transaction signer";
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
  return null;
}

function validateSponsorshipInstruction(
  accountIndexes: readonly number[],
  keys: PublicKey[],
  paymaster: PublicKey,
): string | null {
  if (accountIndexes.length !== 6)
    return "on-chain sponsorship account layout is invalid";
  const owner = keys[accountIndexes[3]];
  if (
    !owner ||
    !keys[accountIndexes[0]]?.equals(deriveProtocolConfigPda()) ||
    !keys[accountIndexes[1]]?.equals(deriveSponsorAllowancePda(owner)) ||
    !keys[accountIndexes[2]]?.equals(paymaster) ||
    !keys[accountIndexes[4]]?.equals(SYSVAR_INSTRUCTIONS_PUBKEY) ||
    !keys[accountIndexes[5]]?.equals(SystemProgram.programId)
  )
    return "on-chain sponsorship accounts are invalid";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
