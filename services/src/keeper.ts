import { randomUUID } from "node:crypto";
import {
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";

import { discoverOpeningPlans } from "./arcadeChain.js";
import { discoverReconciliationPlans } from "./arcadeReconciliation.js";
import { discoverExpiredSessionPlans } from "./sessionCleanup.js";
import { assertKeeperPlanPolicy } from "./keeperPolicy.js";

export const DEFAULT_MIN_KEEPER_LAMPORTS = 100_000_000;
export const DEFAULT_MAX_KEEPER_SPEND_LAMPORTS = 50_000_000;
const MAX_WRITES = 8;
const MAX_EXPIRED_SESSION_REVOKES = 2;

export interface KeeperLogEvent {
  schemaVersion: 1;
  event: "keeper_pass" | "keeper_operation" | "keeper_plan" | "keeper_readiness";
  traceId: string;
  operation?: string;
  ok: boolean;
  writes?: number;
  plannedWrites?: number;
  writeEnabled?: boolean;
  balanceLamports?: number;
  minimumBalanceLamports?: number;
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

export interface KeeperDependencies {
  connection: Connection;
  keeper: Keypair;
  writeEnabled?: boolean;
  now?: () => number;
  maxWrites?: number;
  minimumBalanceLamports?: number;
  maximumSpendLamports?: number;
  rulesVersion?: number;
  log?: (event: KeeperLogEvent) => void;
}

export async function runKeeperPass(input: KeeperDependencies): Promise<KeeperPassResult> {
  const traceId = randomUUID();
  const nowUnix = Math.floor((input.now?.() ?? Date.now()) / 1_000);
  const writeEnabled = input.writeEnabled ?? false;
  const maxWrites = Math.min(MAX_WRITES, Math.max(1, input.maxWrites ?? MAX_WRITES));
  const minimumBalanceLamports = input.minimumBalanceLamports ?? DEFAULT_MIN_KEEPER_LAMPORTS;
  const maximumSpendLamports = Math.min(
    DEFAULT_MAX_KEEPER_SPEND_LAMPORTS,
    Math.max(1, input.maximumSpendLamports ?? DEFAULT_MAX_KEEPER_SPEND_LAMPORTS),
  );
  const log = input.log ?? (() => undefined);
  const balanceLamports = await input.connection.getBalance(input.keeper.publicKey, "confirmed");
  log({ schemaVersion: 1, event: "keeper_readiness", traceId, ok: balanceLamports >= minimumBalanceLamports, balanceLamports, minimumBalanceLamports, maximumSpendLamports });
  if (writeEnabled && balanceLamports < minimumBalanceLamports) {
    throw new Error(`keeper fee reserve ${balanceLamports} is below floor ${minimumBalanceLamports}`);
  }

  const [reconciliationPlans, openingPlans, expiredSessionPlans] = await Promise.all([
    discoverReconciliationPlans({
      connection: input.connection,
      keeper: input.keeper.publicKey,
      nowUnix,
    }),
    discoverOpeningPlans({
    connection: input.connection,
    keeper: input.keeper.publicKey,
    nowUnix,
    rulesVersion: input.rulesVersion ?? 1,
    }),
    discoverExpiredSessionPlans({
      connection: input.connection,
      keeper: input.keeper.publicKey,
      nowUnix,
    }),
  ]);
  // Money safety and late settlement come before cadence creation. Cleanup and
  // profile synchronization trail both so they cannot starve a closing pot.
  const plans = [...reconciliationPlans, ...openingPlans, ...expiredSessionPlans].sort(
    (left, right) => operationPriority(left.operation) - operationPriority(right.operation),
  );
  let writes = 0;
  let plannedWrites = 0;
  let failures = 0;
  let spentLamports = 0;
  const selectedPlans = selectBoundedPlans(plans, maxWrites);
  for (const plan of selectedPlans) {
    assertKeeperPlanPolicy({ plan, keeper: input.keeper.publicKey, connection: input.connection, nowUnix, rulesVersion: input.rulesVersion ?? 1 });
    if (!writeEnabled) {
      plannedWrites += 1;
      log({ schemaVersion: 1, event: "keeper_plan", traceId, operation: plan.operation, ok: true, writes, plannedWrites, writeEnabled });
      continue;
    }
    try {
      const before = await input.connection.getBalance(input.keeper.publicKey, "confirmed");
      const latest = await input.connection.getLatestBlockhash("confirmed");
      const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: input.keeper.publicKey, recentBlockhash: latest.blockhash, instructions: [plan.instruction] }).compileToV0Message());
      transaction.sign([input.keeper]);
      const simulation = await input.connection.simulateTransaction(transaction, {
        sigVerify: true,
        accounts: {
          encoding: "base64",
          addresses: [input.keeper.publicKey.toBase58()],
        },
      });
      if (simulation.value.err) throw new Error(`simulation failed: ${JSON.stringify(simulation.value.err)}`);
      const simulatedPayer = simulation.value.accounts?.[0];
      if (!simulatedPayer) throw new Error("simulation omitted keeper balance");
      const fee = await input.connection.getFeeForMessage(transaction.message, "confirmed");
      if (fee.value === null) throw new Error("RPC omitted transaction fee");
      const predicted = predictedKeeperSpendLamports(before, simulatedPayer.lamports, fee.value);
      if (!keeperSpendWithinLimit(predicted, maximumSpendLamports - spentLamports)) throw new Error("keeper spend ceiling reached");
      if (before - predicted < minimumBalanceLamports) throw new Error("keeper simulation crosses the reserve floor");
      const signature = await input.connection.sendRawTransaction(transaction.serialize(), { maxRetries: 5, skipPreflight: false });
      await input.connection.confirmTransaction({ ...latest, signature }, "confirmed");
      const after = await input.connection.getBalance(input.keeper.publicKey, "confirmed");
      const actualSpend = Math.max(0, before - after);
      if (!keeperSpendWithinLimit(actualSpend, maximumSpendLamports - spentLamports)) {
        throw new Error("keeper actual spend exceeded the pass ceiling");
      }
      if (after < minimumBalanceLamports) {
        throw new Error("keeper write crossed the reserve floor");
      }
      spentLamports += actualSpend;
      writes += 1;
      log({ schemaVersion: 1, event: "keeper_operation", traceId, operation: plan.operation, ok: true, writes, spentLamports });
    } catch (error) {
      failures += 1;
      log({ schemaVersion: 1, event: "keeper_operation", traceId, operation: plan.operation, ok: false, error: safeError(error) });
    }
  }
  const result: KeeperPassResult = { ok: failures === 0, traceId, writes, plannedWrites, writeEnabled, operationFailures: failures, maxWrites, backlog: Math.max(0, plans.length - maxWrites), balanceLamports, reserveLow: balanceLamports < minimumBalanceLamports, spentLamports, maximumSpendLamports };
  log({ schemaVersion: 1, event: "keeper_pass", traceId, ok: result.ok, writes, plannedWrites, writeEnabled, spentLamports, maximumSpendLamports });
  return result;
}

export function keeperKeypairFromEnv(env: Record<string, string | undefined> = process.env): Keypair {
  const encoded = env.KEEPER_SECRET_KEY;
  if (!encoded) throw new Error("KEEPER_SECRET_KEY is not configured");
  const parsed = JSON.parse(encoded) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every((byte) => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255)) throw new Error("KEEPER_SECRET_KEY must be a 64-byte JSON array");
  const keypair = Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
  if (env.ZKUBE_KEEPER_PUBLIC_KEY && keypair.publicKey.toBase58() !== env.ZKUBE_KEEPER_PUBLIC_KEY) throw new Error("KEEPER_SECRET_KEY does not match ZKUBE_KEEPER_PUBLIC_KEY");
  return keypair;
}

export function predictedKeeperSpendLamports(before: number, after: number, fee: number): number {
  if (![before, after, fee].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error("keeper spend simulation returned invalid lamports");
  return Math.max(0, before - after) + fee;
}
export function keeperSpendWithinLimit(spend: number, remaining: number): boolean { return Number.isSafeInteger(spend) && Number.isSafeInteger(remaining) && spend >= 0 && remaining >= 0 && spend <= remaining; }
export function expiredSessionCleanupAllowance(writes: number, maxWrites: number): number { return Math.min(MAX_EXPIRED_SESSION_REVOKES, Math.max(0, maxWrites - writes)); }
export function boundedKeeperInteger(value: string | undefined, fallback: number, maximum: number): number { const parsed = value ? Number(value) : fallback; return Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback; }
function safeError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 240); }
function operationPriority(operation: string): number {
  const priority: Record<string, number> = {
    consume_terminal_run: 0,
    expire_stuck_arena_entry: 1,
    finalize_arena_daily: 2,
    rollup_arena_to_weekly: 3,
    finalize_weekly_jackpot: 4,
    open_weekly_jackpot: 5,
    open_arena_daily: 6,
    sync_daily_finish: 7,
    sync_weekly_finish: 8,
    cleanup_resolved_run: 9,
    close_arena_player: 10,
    close_weekly_player: 11,
    revoke_expired_session: 12,
  };
  return priority[operation] ?? Number.MAX_SAFE_INTEGER;
}
function selectBoundedPlans<T extends { operation: string }>(plans: T[], maximum: number): T[] {
  let sessionRevokes = 0;
  const selected: T[] = [];
  for (const plan of plans) {
    if (selected.length >= maximum) break;
    if (plan.operation === "revoke_expired_session") {
      if (sessionRevokes >= MAX_EXPIRED_SESSION_REVOKES) continue;
      sessionRevokes += 1;
    }
    selected.push(plan);
  }
  return selected;
}
