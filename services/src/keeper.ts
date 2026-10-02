import { CADENCE_FUNDING_TWO_DAY_LAMPORTS } from "./protocolVersions.generated.js";
import { utils } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  cadenceFundingPda,
  type KeeperInstructionPlan,
  KEEPER_PLAN_INSTRUCTION,
} from "./arcadeChain.js";
import {
  discoverReconciliation,
  type ProtocolSnapshot,
} from "./arcadeReconciliation.js";
import {
  type ProtocolInstructionMaterializer,
} from "./arcadeChain.js";

export const KEEPER_SCHEMA_VERSION = 1 as const;

export const KEEPER_LIMITS = Object.freeze({
  // The backstop's largest write prepares a Daily and its two board headers,
  // about 0.0052 SOL of cadence rent; everything else is a fee.
  writes: 6, spendLamports: 10_000_000, reserveLamports: 20_000_000, reconciledWrites: 20,
});

/** The most compute one transaction may request. */
export const MAX_TRANSACTION_COMPUTE_UNITS = 1_400_000;

/**
 * The one owner of a keeper transaction's compute budget: what the
 * instructions used under the transaction maximum, plus a quarter for state
 * that moves before the send. An ordinary 200,000-unit default cannot run a
 * wide finalization, so every keeper message states its limit.
 */
export function keeperComputeUnitLimit(unitsConsumed: number): number {
  if (!Number.isSafeInteger(unitsConsumed) || unitsConsumed <= 0 ||
      unitsConsumed > MAX_TRANSACTION_COMPUTE_UNITS) {
    throw new Error("simulation reported no usable compute consumption");
  }
  return Math.min(MAX_TRANSACTION_COMPUTE_UNITS, Math.ceil(unitsConsumed * 1.25) + 5_000);
}

export interface KeeperLogEvent {
  schemaVersion: typeof KEEPER_SCHEMA_VERSION;
  event:
    | "keeper_pass"
    | "keeper_operation"
    | "keeper_plan"
    | "keeper_readiness";
  traceId: string;
  operation?: string;
  ok: boolean;
  writes?: number;
  plannedWrites?: number;
  writeEnabled?: boolean;
  balanceLamports?: number;
  minimumBalanceLamports?: number;
  cadenceFundingLamports?: number;
  cadenceFundingTargetLamports?: number;
  cadenceFundingLow?: boolean;
  maximumSpendLamports?: number;
  spentLamports?: number;
  error?: string;
}

export interface KeeperPassResult {
  ok: boolean;
  traceId: string;
  writes: number;
  plannedWrites: number;
  writeEnabled: boolean;
  operationFailures: number;
  maxWrites: number;
  backlog: number;
  balanceLamports: number;
  reserveLow: boolean;
  spentLamports: number;
  maximumSpendLamports: number;
}

/** One relayed write as the ledger keeps it. */
export interface KeeperWrite {
  operation: string;
  /** Everything the write may spend: the keeper's own lamports and rent from cadence funding. */
  lamports: number;
  /** The part that leaves the keeper's wallet. */
  payerLamports: number;
  signature: string;
  /** "base", or the rollup endpoint the write was relayed to. */
  endpoint: string;
  lastValidBlockHeight: number;
}

/**
 * The durable record of keeper writes. A write's spend is recorded before it
 * is relayed and stays reserved until its outcome is definite: it landed, or
 * its blockhash is verifiably past and it never will. Elapsed time settles
 * nothing.
 */
export interface KeeperLedger {
  pending(): Promise<Array<KeeperWrite & { id: number }>>;
  reserve(write: KeeperWrite): Promise<number>;
  settle(id: number, outcome: "confirmed" | "failed" | "expired"): Promise<void>;
}

/** How often and how long a relayed write is polled for its outcome. */
export const KEEPER_CONFIRMATION = Object.freeze({ polls: 60, intervalMs: 1_000 });

export interface KeeperDependencies {
  connection: Connection;
  keeper: Pick<Keypair, "publicKey"> & Partial<Pick<Keypair, "secretKey">>;
  writeEnabled?: boolean;
  now?: () => number;
  traceId?: string;
  ledger?: KeeperLedger;
  wait?: (milliseconds: number) => Promise<void>;
  protocolSnapshot?: ProtocolSnapshot;
  protocolMaterializer?: ProtocolInstructionMaterializer;
  resolveEphemeralConnection?: (plan: KeeperInstructionPlan) => Promise<Connection>;
  /** Opens the endpoint an earlier write was relayed to, to learn its outcome. */
  connect?: (endpoint: string) => Connection;
  log?: (event: KeeperLogEvent) => void;
}

export async function runKeeperPass(input: KeeperDependencies): Promise<KeeperPassResult> {
  const traceId = input.traceId ?? crypto.randomUUID();
  const nowUnix = Math.floor((input.now?.() ?? Date.now()) / 1_000);
  const writeEnabled = input.writeEnabled ?? false;
  const maxWrites = KEEPER_LIMITS.writes;
  const minimumBalanceLamports = KEEPER_LIMITS.reserveLamports;
  const maximumSpendLamports = KEEPER_LIMITS.spendLamports;
  const log = input.log ?? (() => undefined);
  const balanceLamports = await input.connection.getBalance(
    input.keeper.publicKey,
    "confirmed",
  );
  // Cadence funding pays every entrant's board rows before their run is
  // consumed; below its two-day worst case a full day could refuse entries.
  // The keeper only reports it: topping it up is the owner's decision.
  const cadenceFundingLamports = await input.connection.getBalance(cadenceFundingPda(), "confirmed");
  log({
    schemaVersion: KEEPER_SCHEMA_VERSION,
    event: "keeper_readiness",
    traceId,
    ok: balanceLamports >= minimumBalanceLamports,
    balanceLamports,
    minimumBalanceLamports,
    maximumSpendLamports,
    cadenceFundingLamports,
    cadenceFundingTargetLamports: CADENCE_FUNDING_TWO_DAY_LAMPORTS,
    cadenceFundingLow: cadenceFundingLamports < CADENCE_FUNDING_TWO_DAY_LAMPORTS,
  });
  if (writeEnabled && balanceLamports < minimumBalanceLamports) {
    throw new Error(
      `keeper fee reserve ${balanceLamports} is below floor ${minimumBalanceLamports}`,
    );
  }
  if (!input.protocolSnapshot) {
    throw new Error("validated protocol snapshot adapter is not configured");
  }
  if (!input.protocolMaterializer) {
    throw new Error("exact Anchor-IDL instruction materializer is not configured");
  }

  const discovered = discoverReconciliation({
    snapshot: input.protocolSnapshot,
    nowUnix,
  });
  const plans = discovered.sort(
    (left, right) => KEEPER_PLAN_INSTRUCTION[left.operation].priority - KEEPER_PLAN_INSTRUCTION[right.operation].priority,
  );

  let writes = 0;
  let plannedWrites = 0;
  let failures = 0;
  let spentLamports = 0;
  // Earlier writes whose outcome is still unknown count against this pass's
  // ceiling, and their payer spend against the wallet floor, until settled.
  let unsettledLamports = 0;
  let unsettledPayerLamports = 0;
  if (writeEnabled && input.ledger) {
    const connect = input.connect ?? ((endpoint: string) => new Connection(endpoint, "confirmed"));
    for (const [index, write] of (await input.ledger.pending()).entries()) {
      // The oldest are asked about first; any beyond the limit wait for a
      // later pass and count in full meanwhile.
      const outcome = index >= KEEPER_LIMITS.reconciledWrites ? null : await (async () =>
        earlierOutcome(write.endpoint === BASE_ENDPOINT ? input.connection : connect(write.endpoint), write))()
        .catch(() => null);
      if (outcome) await input.ledger.settle(write.id, outcome);
      else {
        unsettledLamports += write.lamports;
        unsettledPayerLamports += write.payerLamports;
      }
    }
  }
  let attemptedWrites = 0;
  let resolvedPlans = 0;
  for (const plan of plans) {
    if (attemptedWrites >= maxWrites) continue;
    // A submitted write owns its slot even when confirmation fails.
    attemptedWrites += 1;
    resolvedPlans += 1;
    const materialized = { ...plan,
      connection: KEEPER_PLAN_INSTRUCTION[plan.operation].connection,
      instructions: await input.protocolMaterializer.materialize({
        operation: plan.operation, context: plan.context!,
        keeper: input.keeper.publicKey,
      }),
    };
    if (!writeEnabled) {
      plannedWrites += 1;
      log({
        schemaVersion: KEEPER_SCHEMA_VERSION,
        event: "keeper_plan",
        traceId,
        operation: plan.operation,
        ok: true,
        writes,
        plannedWrites,
        writeEnabled,
      });
      continue;
    }
    try {
      const connection = materialized.connection === "base"
        ? input.connection
        : await requiredEphemeralConnection(input.resolveEphemeralConnection, materialized);
      const before = await connection.getBalance(input.keeper.publicKey, "confirmed");
      const fundingWritable = materialized.instructions?.some((instruction) =>
        instruction.keys.some((account) =>
          account.isWritable && account.pubkey.equals(cadenceFundingPda())
        )
      ) ?? false;
      const fundingBefore = fundingWritable
        ? await connection.getBalance(cadenceFundingPda(), "confirmed")
        : 0;
      const latest = await connection.getLatestBlockhash("confirmed");
      const compile = (units: number) => new VersionedTransaction(new TransactionMessage({
        payerKey: input.keeper.publicKey,
        recentBlockhash: latest.blockhash,
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ...materialized.instructions!],
      }).compileToV0Message());
      // Size the budget under the transaction maximum, then simulate and
      // send the exact message that carries the sized limit.
      const sizing = await connection.simulateTransaction(
        compile(MAX_TRANSACTION_COMPUTE_UNITS), { sigVerify: false });
      if (sizing.value.err) {
        throw new Error(`simulation failed: ${JSON.stringify(sizing.value.err)}`);
      }
      const transaction = compile(keeperComputeUnitLimit(sizing.value.unitsConsumed ?? 0));
      transaction.sign([requiredKeeperSigner(input.keeper)]);
      const simulation = await connection.simulateTransaction(transaction, {
        sigVerify: true,
        accounts: {
          encoding: "base64",
          addresses: [
            input.keeper.publicKey.toBase58(),
            ...(fundingWritable ? [cadenceFundingPda().toBase58()] : []),
          ],
        },
      });
      if (simulation.value.err) {
        throw new Error(`simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }
      const simulatedPayer = simulation.value.accounts?.[0];
      if (!simulatedPayer) throw new Error("simulation omitted keeper balance");
      const fee = await connection.getFeeForMessage(transaction.message, "confirmed");
      if (fee.value === null) throw new Error("RPC omitted transaction fee");
      const payerPredicted = predictedKeeperSpendLamports(
        before,
        simulatedPayer.lamports,
        fee.value,
      );
      const fundingPredicted = fundingWritable
        ? predictedAccountSpendLamports(
          fundingBefore,
          simulation.value.accounts?.[1]?.lamports,
        )
        : 0;
      // Rent a write takes from cadence funding counts against the pass's
      // spend like the keeper's own lamports.
      const predicted = payerPredicted + fundingPredicted;
      if (!keeperSpendWithinLimit(predicted, maximumSpendLamports - unsettledLamports - spentLamports)) {
        throw new Error("keeper spend ceiling reached");
      }
      if (before - payerPredicted - unsettledPayerLamports < minimumBalanceLamports) {
        throw new Error("keeper simulation crosses the reserve floor");
      }
      // Reserve the simulated spend before submission. An RPC timeout may still mean the write
      // landed, so its budget must never be reused during this pass.
      spentLamports += predicted;
      const reservation = await input.ledger?.reserve({ operation: plan.operation, lamports: predicted,
        payerLamports: payerPredicted, signature: utils.bytes.bs58.encode(transaction.signatures[0]!),
        endpoint: materialized.connection === "base" ? BASE_ENDPOINT : connection.rpcEndpoint,
        lastValidBlockHeight: latest.lastValidBlockHeight });
      // Until the cluster answers, the balance read for the next write may
      // not show this one: its payer spend stays against the floor.
      unsettledPayerLamports += payerPredicted;
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        maxRetries: 5,
        skipPreflight: materialized.connection === "ephemeral-rollup",
      });
      const error = await writeOutcome(connection, signature, input.wait ?? wait);
      unsettledPayerLamports -= payerPredicted;
      if (reservation !== undefined) await input.ledger!.settle(reservation, error === null ? "confirmed" : "failed");
      if (error !== null) throw new Error(`confirmation failed: ${JSON.stringify(error)}`);
      writes += 1;
      log({
        schemaVersion: KEEPER_SCHEMA_VERSION,
        event: "keeper_operation",
        traceId,
        operation: plan.operation,
        ok: true,
        writes,
        spentLamports,
      });
    } catch (error) {
      failures += 1;
      log({
        schemaVersion: KEEPER_SCHEMA_VERSION,
        event: "keeper_operation",
        traceId,
        operation: plan.operation,
        ok: false,
        error: safeError(error),
      });
    }
  }

  const result: KeeperPassResult = {
    ok: failures === 0,
    traceId,
    writes,
    plannedWrites,
    writeEnabled,
    operationFailures: failures,
    maxWrites,
    backlog: Math.max(0, plans.length - resolvedPlans),
    balanceLamports,
    reserveLow: balanceLamports < minimumBalanceLamports,
    spentLamports,
    maximumSpendLamports,
  };
  log({
    schemaVersion: KEEPER_SCHEMA_VERSION,
    event: "keeper_pass",
    traceId,
    ok: result.ok,
    writes,
    plannedWrites,
    writeEnabled,
    spentLamports,
    maximumSpendLamports,
  });
  return result;
}

/**
 * Polls a relayed write until the cluster confirms its outcome: null when it
 * succeeded, its error when it landed and failed. Running out of polls is no
 * outcome at all, and throws.
 */
async function writeOutcome(
  connection: Connection,
  signature: string,
  pause: (milliseconds: number) => Promise<void>,
): Promise<unknown> {
  for (let poll = 0; poll < KEEPER_CONFIRMATION.polls; poll += 1) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    const outcome = clusterOutcome(status);
    if (outcome) return outcome.err;
    await pause(KEEPER_CONFIRMATION.intervalMs);
  }
  throw new Error("the write's outcome is unknown");
}

const BASE_ENDPOINT = "base";

/**
 * The one reading of a signature status, for a write of this pass or an
 * earlier one: an outcome exists only once the cluster has confirmed it. What
 * a single node has processed, success or failure, can still be replaced by
 * another result on the confirmed chain, and settles nothing.
 */
function clusterOutcome(status: { err: unknown; confirmationStatus?: string } | null | undefined): { err: unknown } | null {
  return status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")
    ? { err: status.err ?? null } : null;
}

/**
 * What became of a write an earlier pass relayed: its landed result, or
 * expired once finalized blocks have passed the last one that could hold it
 * and the cluster still has no record of it. Otherwise nothing is known yet.
 */
async function earlierOutcome(
  connection: Connection,
  write: KeeperWrite,
): Promise<"confirmed" | "failed" | "expired" | null> {
  // The height is read first: a status read after it sees every block up to it.
  const height = await connection.getBlockHeight("finalized");
  const status = (await connection.getSignatureStatuses([write.signature], { searchTransactionHistory: true })).value[0];
  const outcome = clusterOutcome(status);
  if (outcome) return outcome.err ? "failed" : "confirmed";
  // Seen by one node only, it is still neither landed nor gone.
  return !status && height > write.lastValidBlockHeight ? "expired" : null;
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function requiredEphemeralConnection(
  resolver: KeeperDependencies["resolveEphemeralConnection"],
  plan: KeeperInstructionPlan,
): Promise<Connection> {
  if (!resolver) {
    throw new Error("Router-resolved Ephemeral Rollup connection is required");
  }
  return resolver(plan);
}

export function keeperKeypairFromEnv(
  env: Record<string, string | undefined> = process.env,
): Keypair {
  const encoded = env.KEEPER_SECRET_KEY;
  if (!encoded) throw new Error("KEEPER_SECRET_KEY is not configured");
  const pinned = keeperPublicKeyFromEnv(env);
  // A parser's error quotes what it read. Nothing of the secret may reach an
  // error, so every decoding failure is this one message.
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); } catch { parsed = undefined; }
  if (!Array.isArray(parsed) || parsed.length !== 64 ||
      !parsed.every((byte) => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255)) {
    throw new Error("KEEPER_SECRET_KEY must be a 64-byte JSON array");
  }
  let keypair: Keypair;
  try { keypair = Keypair.fromSecretKey(Uint8Array.from(parsed as number[])); } catch {
    throw new Error("KEEPER_SECRET_KEY must be a 64-byte JSON array");
  }
  if (!keypair.publicKey.equals(pinned)) {
    throw new Error("KEEPER_SECRET_KEY does not match ZKUBE_KEEPER_PUBLIC_KEY");
  }
  return keypair;
}

export function keeperPublicKeyFromEnv(
  env: Record<string, string | undefined> = process.env,
): PublicKey {
  const expectedPublicKey = env.ZKUBE_KEEPER_PUBLIC_KEY;
  if (!expectedPublicKey) {
    throw new Error("ZKUBE_KEEPER_PUBLIC_KEY is required to pin the keeper signer");
  }
  try {
    return new PublicKey(expectedPublicKey);
  } catch {
    throw new Error("ZKUBE_KEEPER_PUBLIC_KEY is not a valid Solana public key");
  }
}

function requiredKeeperSigner(
  keeper: KeeperDependencies["keeper"],
): Keypair {
  if (!(keeper.secretKey instanceof Uint8Array) || keeper.secretKey.length !== 64) {
    throw new Error("keeper signer is not loaded for a write-enabled pass");
  }
  return keeper as Keypair;
}

export function predictedKeeperSpendLamports(
  before: number,
  after: number,
  fee: number,
): number {
  if (![before, after, fee].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("keeper spend simulation returned invalid lamports");
  }
  return Math.max(0, before - after) + fee;
}

export function predictedAccountSpendLamports(
  before: number,
  after: number | undefined,
): number {
  if (!Number.isSafeInteger(before) || before < 0 ||
      !Number.isSafeInteger(after) || after === undefined || after < 0) {
    throw new Error("keeper spend simulation omitted or returned invalid account lamports");
  }
  return Math.max(0, before - after);
}

export function keeperSpendWithinLimit(spend: number, remaining: number): boolean {
  return Number.isSafeInteger(spend) && Number.isSafeInteger(remaining) &&
    spend >= 0 && remaining >= 0 && spend <= remaining;
}

export function boundedKeeperInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isSafeInteger(parsed) && parsed >= 1
    ? Math.min(parsed, maximum)
    : fallback;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 240);
}
