import { randomUUID } from "node:crypto";

import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";

import {
  ZKUBE_PROGRAM_ID,
  activeRunPda,
  cadenceFundingPda,
  arenaDailyPda,
  arenaPlayerPda,
  seasonPda,
  seasonPlayerPda,
  weeklyJackpotPda,
  type CompetitionKind,
  type KeeperInstructionPlan,
} from "./arcadeChain.js";
import {
  ArchiveIntegrityError,
  type KeeperArchiveStore,
} from "./archiveStore.js";
import {
  discoverReconciliation,
  type ProtocolSnapshot,
} from "./arcadeReconciliation.js";
import { assertKeeperPlanPolicy } from "./keeperPolicy.js";
import {
  materializeKeeperPlan,
  type ProtocolInstructionMaterializer,
} from "./planMaterializer.js";
import { discoverExpiredSessionPlans } from "./sessionCleanup.js";

export const DEFAULT_MIN_KEEPER_LAMPORTS = 100_000_000;
export const DEFAULT_MAX_KEEPER_SPEND_LAMPORTS = 100_000_000;
const MAX_WRITES = 8;
const MAX_EXPIRED_SESSION_REVOKES = 2;
const MAX_PARTICIPANT_CLOSURES = 2;

export interface KeeperLogEvent {
  schemaVersion: 1;
  event:
    | "keeper_pass"
    | "keeper_operation"
    | "keeper_plan"
    | "keeper_readiness"
    | "keeper_domain_quarantine"
    | "keeper_archive_quarantine"
    | "keeper_dependency_suppressed";
  traceId: string;
  operation?: string;
  competition?: "daily" | "weekly" | "season";
  cadenceId?: number;
  archiveIntegrityCode?: string;
  archiveFailureStage?: "preparation" | "transaction";
  archiveQuarantines?: number;
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
  archiveQuarantines: number;
  maxWrites: number;
  backlog: number;
  balanceLamports: number;
  reserveLow: boolean;
  spentLamports: number;
  maximumSpendLamports: number;
}

export interface KeeperDependencies {
  connection: Connection;
  keeper: Pick<Keypair, "publicKey"> & Partial<Pick<Keypair, "secretKey">>;
  writeEnabled?: boolean;
  now?: () => number;
  maxWrites?: number;
  minimumBalanceLamports?: number;
  maximumSpendLamports?: number;
  protocolSnapshot?: ProtocolSnapshot;
  protocolMaterializer?: ProtocolInstructionMaterializer;
  archiveStore?: KeeperArchiveStore;
  resolveEphemeralConnection?: (plan: KeeperInstructionPlan) => Promise<Connection>;
  verifyAfterWrite?: (
    plan: KeeperInstructionPlan,
    connection: Connection,
    signature: string,
  ) => Promise<void>;
  log?: (event: KeeperLogEvent) => void;
}

export async function runKeeperPass(input: KeeperDependencies): Promise<KeeperPassResult> {
  const traceId = randomUUID();
  const nowUnix = Math.floor((input.now?.() ?? Date.now()) / 1_000);
  const writeEnabled = input.writeEnabled ?? false;
  const maxWrites = boundedRuntimeInteger(input.maxWrites, MAX_WRITES, 1, MAX_WRITES);
  const minimumBalanceLamports = boundedRuntimeInteger(
    input.minimumBalanceLamports,
    DEFAULT_MIN_KEEPER_LAMPORTS,
    DEFAULT_MIN_KEEPER_LAMPORTS,
    Number.MAX_SAFE_INTEGER,
  );
  const maximumSpendLamports = boundedRuntimeInteger(
    input.maximumSpendLamports,
    DEFAULT_MAX_KEEPER_SPEND_LAMPORTS,
    1,
    DEFAULT_MAX_KEEPER_SPEND_LAMPORTS,
  );
  const log = input.log ?? (() => undefined);
  const balanceLamports = await input.connection.getBalance(
    input.keeper.publicKey,
    "confirmed",
  );
  log({
    schemaVersion: 1,
    event: "keeper_readiness",
    traceId,
    ok: balanceLamports >= minimumBalanceLamports,
    balanceLamports,
    minimumBalanceLamports,
    maximumSpendLamports,
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

  const reconciliation = discoverReconciliation({
    snapshot: input.protocolSnapshot,
    nowUnix,
  });
  for (const quarantine of reconciliation.quarantines) {
    log({
      schemaVersion: 1,
      event: "keeper_domain_quarantine",
      traceId,
      competition: quarantine.kind,
      cadenceId: quarantine.id,
      ok: false,
      error: quarantine.reason,
    });
  }
  const expiredSessionPlans = await discoverExpiredSessionPlans({
    connection: input.connection,
    keeper: input.keeper.publicKey,
    targetProgramId: ZKUBE_PROGRAM_ID,
    nowUnix,
  });
  const plans = [...reconciliation.plans, ...expiredSessionPlans].sort(
    (left, right) => operationPriority(left.operation) - operationPriority(right.operation),
  );

  let writes = 0;
  let plannedWrites = 0;
  let failures = 0;
  let archiveQuarantines = 0;
  let spentLamports = 0;
  let attemptedWrites = 0;
  let resolvedPlans = 0;
  let sessionRevokes = 0;
  let participantClosures = 0;
  const quarantinedArchiveDependencies = new Set<string>();
  for (const plan of plans) {
    if (attemptedWrites >= maxWrites) break;
    assertKeeperPlanPolicy({
      plan,
      keeper: input.keeper.publicKey,
      programId: ZKUBE_PROGRAM_ID,
      connection: input.connection,
      nowUnix,
    });
    const dependentCadence = dependentArchiveCadence(plan);
    if (dependentCadence &&
        quarantinedArchiveDependencies.has(cadenceDependencyKey(dependentCadence))) {
      log({
        schemaVersion: 1,
        event: "keeper_dependency_suppressed",
        traceId,
        operation: plan.operation,
        competition: dependentCadence.competition,
        cadenceId: dependentCadence.cadenceId,
        ok: false,
        error: "suppressed after same-cadence archive failure",
      });
      resolvedPlans += 1;
      continue;
    }
    if (plan.operation === "revoke_expired_session" &&
        sessionRevokes >= MAX_EXPIRED_SESSION_REVOKES) {
      continue;
    }
    if (isParticipantClosure(plan.operation) &&
        participantClosures >= MAX_PARTICIPANT_CLOSURES) {
      continue;
    }
    if (usesArchiveStorage(plan.operation)) {
      if (!input.archiveStore) {
        throw new Error("verified cadence archive storage is not configured");
      }
      try {
        await input.archiveStore.prepare(plan);
      } catch (error) {
        if (!(error instanceof ArchiveIntegrityError)) throw error;
        const cadence = requiredArchiveStorageCadence(plan);
        if (cadence.competition !== error.competition ||
            cadence.cadenceId !== error.cadenceId) {
          throw new Error("archive integrity failure identity does not match its plan");
        }
        failures += 1;
        const dependencyKey = cadenceDependencyKey(cadence);
        if (!quarantinedArchiveDependencies.has(dependencyKey)) {
          quarantinedArchiveDependencies.add(dependencyKey);
          archiveQuarantines += 1;
        }
        log({
          schemaVersion: 1,
          event: "keeper_archive_quarantine",
          traceId,
          operation: plan.operation,
          competition: error.competition,
          cadenceId: error.cadenceId,
          archiveIntegrityCode: error.code,
          archiveFailureStage: "preparation",
          ok: false,
          error: safeError(error),
        });
        resolvedPlans += 1;
        continue;
      }
    }
    // Charge every bound only after runtime quarantine and archive preparation
    // establish that this plan is eligible. A submitted write still owns its
    // slot even when confirmation or post-write verification later fails.
    attemptedWrites += 1;
    resolvedPlans += 1;
    if (plan.operation === "revoke_expired_session") {
      sessionRevokes += 1;
    }
    if (isParticipantClosure(plan.operation)) {
      participantClosures += 1;
    }
    const materialized = await materializeKeeperPlan(plan, {
      programId: ZKUBE_PROGRAM_ID,
      keeper: input.keeper.publicKey,
      protocol: input.protocolMaterializer,
    });
    if (!writeEnabled) {
      plannedWrites += 1;
      log({
        schemaVersion: 1,
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
      const transaction = new VersionedTransaction(new TransactionMessage({
        payerKey: input.keeper.publicKey,
        recentBlockhash: latest.blockhash,
        instructions: [...materialized.instructions!],
      }).compileToV0Message());
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
      const predicted = predictedKeeperSpendLamports(
        before,
        simulatedPayer.lamports,
        fee.value,
      ) + (fundingWritable
        ? predictedAccountSpendLamports(
          fundingBefore,
          simulation.value.accounts?.[1]?.lamports,
        )
        : 0);
      if (!keeperSpendWithinLimit(predicted, maximumSpendLamports - spentLamports)) {
        throw new Error("keeper spend ceiling reached");
      }
      if (before - predicted < minimumBalanceLamports) {
        throw new Error("keeper simulation crosses the reserve floor");
      }
      // Reserve the simulated spend before submission. An RPC timeout or a
      // post-confirmation verification failure may still mean the write
      // landed, so its budget must never be reused during this pass.
      spentLamports += predicted;
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        maxRetries: 5,
        skipPreflight: materialized.connection === "ephemeral-rollup",
      });
      await connection.confirmTransaction({ ...latest, signature }, "confirmed");
      await (input.verifyAfterWrite ?? verifyConfirmedWrite)(
        materialized,
        connection,
        signature,
      );
      const after = await connection.getBalance(input.keeper.publicKey, "confirmed");
      const fundingAfter = fundingWritable
        ? await connection.getBalance(cadenceFundingPda(), "confirmed")
        : 0;
      const actualSpend =
        Math.max(0, before - after) +
        Math.max(0, fundingBefore - fundingAfter);
      if (actualSpend > predicted) {
        throw new Error("keeper actual spend exceeded its simulated reservation");
      }
      if (after < minimumBalanceLamports) {
        throw new Error("keeper write crossed the reserve floor");
      }
      writes += 1;
      log({
        schemaVersion: 1,
        event: "keeper_operation",
        traceId,
        operation: plan.operation,
        ok: true,
        writes,
        spentLamports,
      });
    } catch (error) {
      failures += 1;
      const archiveCadence = archiveTransactionCadence(plan);
      if (archiveCadence) {
        const dependencyKey = cadenceDependencyKey(archiveCadence);
        if (!quarantinedArchiveDependencies.has(dependencyKey)) {
          quarantinedArchiveDependencies.add(dependencyKey);
          archiveQuarantines += 1;
        }
        log({
          schemaVersion: 1,
          event: "keeper_archive_quarantine",
          traceId,
          operation: plan.operation,
          competition: archiveCadence.competition,
          cadenceId: archiveCadence.cadenceId,
          archiveFailureStage: "transaction",
          ok: false,
          error: safeError(error),
        });
      }
      log({
        schemaVersion: 1,
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
    archiveQuarantines,
    maxWrites,
    backlog: Math.max(0, plans.length - resolvedPlans),
    balanceLamports,
    reserveLow: balanceLamports < minimumBalanceLamports,
    spentLamports,
    maximumSpendLamports,
  };
  log({
    schemaVersion: 1,
    event: "keeper_pass",
    traceId,
    ok: result.ok,
    writes,
    plannedWrites,
    writeEnabled,
    archiveQuarantines,
    spentLamports,
    maximumSpendLamports,
  });
  return result;
}

async function requiredEphemeralConnection(
  resolver: KeeperDependencies["resolveEphemeralConnection"],
  plan: KeeperInstructionPlan,
): Promise<Connection> {
  if (!resolver) {
    throw new Error("Router-resolved Ephemeral Rollup connection is required");
  }
  return resolver(plan);
}

export async function verifyConfirmedWrite(
  plan: KeeperInstructionPlan,
  connection: Connection,
  signature: string,
): Promise<void> {
  const status = await connection.getSignatureStatus(signature, {
    searchTransactionHistory: true,
  });
  if (!status.value || status.value.err ||
      (status.value.confirmationStatus !== "confirmed" &&
        status.value.confirmationStatus !== "finalized")) {
    throw new Error("confirmed keeper write could not be re-verified");
  }
  const touched = [...new Map(
    plan.instructions?.flatMap((instruction) => instruction.keys)
      .filter((account) => account.isWritable)
      .map((account) => [account.pubkey.toBase58(), account.pubkey]) ?? [],
  ).values()];
  if (touched.length > 0) {
    const reread = await connection.getMultipleAccountsInfo(touched, "confirmed");
    if (reread.length !== touched.length) {
      throw new Error("keeper post-write account re-read was incomplete");
    }
    const closed = expectedClosedAccounts(plan);
    for (let index = 0; index < touched.length; index += 1) {
      const address = touched[index]!;
      const info = reread[index];
      const shouldBeClosed = closed.has(address.toBase58());
      if ((shouldBeClosed && info) || (!shouldBeClosed && !info)) {
        throw new Error("keeper post-write account state does not match the operation");
      }
    }
  }
}

function expectedClosedAccounts(plan: KeeperInstructionPlan): ReadonlySet<string> {
  const closed = new Set<string>();
  if (plan.operation === "revoke_expired_session") {
    if (!plan.context?.sessionAddress) {
      throw new Error("session cleanup verification is missing its account");
    }
    closed.add(plan.context.sessionAddress.toBase58());
    return closed;
  }
  if (plan.operation === "consume_campaign_run" ||
      plan.operation === "consume_arena_run" ||
      plan.operation === "consume_practice_run" ||
      plan.operation === "cleanup_orphan_active_run") {
    const owner = plan.context?.owner;
    const runId = plan.context?.runId;
    if (!owner || runId === undefined) {
      throw new Error("run cleanup verification is missing its ActiveRun identity");
    }
    const activeRun = plan.instructions?.[0]?.keys.find((account) =>
      account.isWritable && !account.isSigner &&
      account.pubkey.equals(activeRunPda(owner, runId))
    );
    if (!activeRun) {
      throw new Error("run cleanup verification is missing its ActiveRun account");
    }
    closed.add(activeRun.pubkey.toBase58());
  }
  if (plan.operation === "close_arena_player") {
    const owner = plan.context?.owner;
    const dayId = plan.context?.dayId;
    if (!owner || dayId === undefined) {
      throw new Error("ArenaPlayer cleanup verification is missing its identity");
    }
    closed.add(arenaPlayerPda(arenaDailyPda(dayId), owner).toBase58());
  }
  if (plan.operation === "close_season_player") {
    const owner = plan.context?.owner;
    const seasonId = plan.context?.seasonId;
    if (!owner || seasonId === undefined) {
      throw new Error("SeasonPlayer cleanup verification is missing its identity");
    }
    closed.add(seasonPlayerPda(seasonPda(seasonId), owner).toBase58());
  }
  if (plan.operation === "close_arena_daily") {
    if (plan.context?.dayId === undefined) {
      throw new Error("Daily closure verification is missing its identity");
    }
    closed.add(arenaDailyPda(plan.context.dayId).toBase58());
  }
  if (plan.operation === "close_weekly_jackpot") {
    if (plan.context?.weekId === undefined) {
      throw new Error("Weekly closure verification is missing its identity");
    }
    closed.add(weeklyJackpotPda(plan.context.weekId).toBase58());
  }
  if (plan.operation === "close_season") {
    if (plan.context?.seasonId === undefined) {
      throw new Error("Season closure verification is missing its identity");
    }
    closed.add(seasonPda(plan.context.seasonId).toBase58());
  }
  return closed;
}

export function keeperKeypairFromEnv(
  env: Record<string, string | undefined> = process.env,
): Keypair {
  const encoded = env.KEEPER_SECRET_KEY;
  if (!encoded) throw new Error("KEEPER_SECRET_KEY is not configured");
  const pinned = keeperPublicKeyFromEnv(env);
  const parsed = JSON.parse(encoded) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 64 ||
      !parsed.every((byte) => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255)) {
    throw new Error("KEEPER_SECRET_KEY must be a 64-byte JSON array");
  }
  const keypair = Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
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

export function expiredSessionCleanupAllowance(writes: number, maxWrites: number): number {
  return Math.min(MAX_EXPIRED_SESSION_REVOKES, Math.max(0, maxWrites - writes));
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

function boundedRuntimeInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Number.isSafeInteger(value) && value !== undefined &&
    value >= minimum && value <= maximum
    ? value
    : fallback;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 240);
}

export function operationPriority(operation: string): number {
  const priority: Record<string, number> = {
    prepare_arena_daily: 0,
    prepare_weekly_jackpot: 0,
    prepare_season: 0,
    activate_arena_daily: 1,
    activate_weekly_jackpot: 1,
    activate_season: 1,
    force_finish_deadline: 2,
    commit_run: 3,
    consume_campaign_run: 4,
    consume_arena_run: 4,
    consume_practice_run: 4,
    expire_unresolved_arena_run: 5,
    expire_unresolved_practice_run: 5,
    finalize_arena_daily: 6,
    finalize_weekly_jackpot: 6,
    finalize_season: 6,
    initialize_season_player: 7,
    rollup_arena_to_season: 8,
    seal_arena_season_rollups: 9,
    archive_arena_daily: 10,
    archive_weekly_jackpot: 10,
    archive_season: 10,
    sync_daily_profile: 13,
    sync_weekly_profile: 13,
    sync_season_profile: 13,
    close_arena_daily: 14,
    close_weekly_jackpot: 14,
    close_season: 14,
    cleanup_orphan_active_run: 15,
    close_arena_player: 16,
    close_season_player: 16,
    revoke_expired_session: 17,
  };
  return priority[operation] ?? Number.MAX_SAFE_INTEGER;
}

function usesArchiveStorage(operation: string): boolean {
  return operation.startsWith("archive_") ||
    operation === "close_arena_daily" ||
    operation === "close_weekly_jackpot" ||
    operation === "close_season";
}

interface CadenceDependency {
  competition: CompetitionKind;
  cadenceId: number;
}

function cadenceDependencyKey(dependency: CadenceDependency): string {
  return `${dependency.competition}:${dependency.cadenceId}`;
}

function requiredArchiveStorageCadence(
  plan: KeeperInstructionPlan,
): CadenceDependency {
  const dependency = archiveStorageCadence(plan);
  if (!dependency) {
    throw new Error("archive storage operation is missing its cadence identity");
  }
  return dependency;
}

function archiveStorageCadence(
  plan: KeeperInstructionPlan,
): CadenceDependency | undefined {
  switch (plan.operation) {
    case "archive_arena_daily":
    case "close_arena_daily":
      return exactCadence(plan, "daily", plan.context?.dayId);
    case "archive_weekly_jackpot":
    case "close_weekly_jackpot":
      return exactCadence(plan, "weekly", plan.context?.weekId);
    case "archive_season":
    case "close_season":
      return exactCadence(plan, "season", plan.context?.seasonId);
    default:
      return undefined;
  }
}

function archiveTransactionCadence(
  plan: KeeperInstructionPlan,
): CadenceDependency | undefined {
  switch (plan.operation) {
    case "archive_arena_daily":
      return exactCadence(plan, "daily", plan.context?.dayId);
    case "archive_weekly_jackpot":
      return exactCadence(plan, "weekly", plan.context?.weekId);
    case "archive_season":
      return exactCadence(plan, "season", plan.context?.seasonId);
    default:
      return undefined;
  }
}

function dependentArchiveCadence(
  plan: KeeperInstructionPlan,
): CadenceDependency | undefined {
  switch (plan.operation) {
    case "sync_daily_profile":
    case "close_arena_daily":
    case "close_arena_player":
      return exactCadence(plan, "daily", plan.context?.dayId);
    case "sync_weekly_profile":
    case "close_weekly_jackpot":
      return exactCadence(plan, "weekly", plan.context?.weekId);
    case "sync_season_profile":
    case "close_season":
    case "close_season_player":
      return exactCadence(plan, "season", plan.context?.seasonId);
    default:
      return undefined;
  }
}

function exactCadence(
  plan: KeeperInstructionPlan,
  competition: CompetitionKind,
  cadenceId: number | undefined,
): CadenceDependency {
  if (!Number.isSafeInteger(cadenceId) || cadenceId === undefined ||
      cadenceId < 0 || cadenceId > 0xffff_ffff ||
      (plan.context?.competition !== undefined &&
        plan.context.competition !== competition)) {
    throw new Error(`${plan.operation} has an invalid cadence dependency`);
  }
  return { competition, cadenceId };
}

function isParticipantClosure(operation: string): boolean {
  return operation === "close_arena_player" ||
    operation === "close_season_player";
}
