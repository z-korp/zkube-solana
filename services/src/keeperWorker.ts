import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDevnetConnection } from "./serviceReadiness.js";
import {
  AnchorKeeperAdapter,
  KEEPER_EXPECTED_IDL_SHA256,
} from "./anchorIdlAdapter.js";
import {
  boundedKeeperInteger,
  DEFAULT_MAX_KEEPER_SPEND_LAMPORTS,
  DEFAULT_MIN_KEEPER_LAMPORTS,
  keeperKeypairFromEnv,
  keeperPublicKeyFromEnv,
  runKeeperPass,
  type KeeperLogEvent,
} from "./keeper.js";
import {
  checkChainReadiness,
  expectedGenesisHashFromEnv,
} from "./serviceReadiness.js";
import {
  MAGICBLOCK_DEVNET_ROUTER_RPC,
  resolveEphemeralConnectionForPlan,
} from "./router.js";
import { ZKUBE_PROGRAM_ID, protocolPda } from "./arcadeChain.js";
import { keeperReleaseRecord } from "./keeperRelease.js";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_WRITES = 8;
const MAX_MAX_WRITES = 8;

/** SHA-256 of the full padded SBF bytes currently stored in ProgramData. */
export const KEEPER_EXPECTED_DEPLOYED_SBF_SHA256 =
  "754974b0248a9236fe25fde81185649dd73d9b1099d734b9a5029d39750933b4";

/**
 * Writes stay disabled unless Fly exposes an immutable image digest and the
 * complete release material recomputes the explicitly approved fingerprint.
 * The image is therefore built and verified read-only, then the exact same
 * digest is enabled after approval; no post-approval rebuild can drift it.
 */
export function keeperWriteEnabledFromEnv(
  env: Record<string, string | undefined>,
): boolean {
  if (env.KEEPER_WRITE_ENABLED !== "true") return false;
  const approved = env.KEEPER_APPROVED_RELEASE_FINGERPRINT;
  if (!approved || !/^[0-9a-f]{64}$/.test(approved)) return false;
  try {
    return keeperReleaseFromEnv(env).fingerprint === approved;
  } catch {
    return false;
  }
}

export function keeperReleaseFromEnv(
  env: Record<string, string | undefined>,
) {
  const flyImageRef = requiredReleaseValue(env.FLY_IMAGE_REF, "FLY_IMAGE_REF");
  const imageDigest = flyImageRef.match(/@(sha256:[0-9a-f]{64})$/)?.[1];
  if (!imageDigest) {
    throw new Error("FLY_IMAGE_REF must end in an immutable sha256 digest");
  }
  const rawRulesVersion = requiredReleaseValue(
    env.ZKUBE_ARENA_RULES_VERSION,
    "ZKUBE_ARENA_RULES_VERSION",
  );
  if (!/^\d+$/.test(rawRulesVersion)) {
    throw new Error("ZKUBE_ARENA_RULES_VERSION must be a positive u32");
  }
  return keeperReleaseRecord({
    programId: ZKUBE_PROGRAM_ID.toBase58(),
    keeperPublicKey: requiredReleaseValue(
      env.ZKUBE_KEEPER_PUBLIC_KEY,
      "ZKUBE_KEEPER_PUBLIC_KEY",
    ),
    deployedProgramDataSha256: KEEPER_EXPECTED_DEPLOYED_SBF_SHA256,
    keeperImageDigest: imageDigest,
    replayDomainHex: requiredReleaseValue(
      env.ZKUBE_REPLAY_DOMAIN_HEX,
      "ZKUBE_REPLAY_DOMAIN_HEX",
    ),
    rulesHash: requiredReleaseValue(
      env.ZKUBE_ARENA_RULES_CATALOG_SHA256,
      "ZKUBE_ARENA_RULES_CATALOG_SHA256",
    ),
    schemaHash: requiredReleaseValue(
      env.ZKUBE_KEEPER_SCHEMA_SHA256,
      "ZKUBE_KEEPER_SCHEMA_SHA256",
    ),
    idlHash: KEEPER_EXPECTED_IDL_SHA256,
    rulesVersion: Number(rawRulesVersion),
  });
}

export interface KeeperWorkerEvent {
  schemaVersion: 1;
  event: "keeper_worker";
  outcome:
    | "disabled"
    | "bootstrap_pending"
    | "pass_complete"
    | "pass_failed"
    | "stopping";
  durationMs?: number;
  error?: string;
}

export interface KeeperWorkerDependencies {
  env?: Record<string, string | undefined>;
  signal: AbortSignal;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  runPass?: () => Promise<void>;
  log?: (event: KeeperWorkerEvent | KeeperLogEvent) => void;
}

export function keeperIntervalFromEnv(
  env: Record<string, string | undefined>,
): number {
  return boundedKeeperInteger(
    env.KEEPER_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
    60 * 60 * 1_000,
  );
}

export async function runKeeperWorker(
  dependencies: KeeperWorkerDependencies,
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? abortableDelay;
  const log = dependencies.log ?? jsonLog;
  const intervalMs = keeperIntervalFromEnv(env);

  while (!dependencies.signal.aborted) {
    const startedAt = now();
    if (env.KEEPER_ENABLED !== "true") {
      log({ schemaVersion: 1, event: "keeper_worker", outcome: "disabled" });
    } else {
      try {
        if (dependencies.runPass) {
          await dependencies.runPass();
        } else {
          await runConfiguredKeeperPass(env, log);
        }
        log({
          schemaVersion: 1,
          event: "keeper_worker",
          outcome: "pass_complete",
          durationMs: Math.max(0, now() - startedAt),
        });
      } catch (error) {
        log({
          schemaVersion: 1,
          event: "keeper_worker",
          outcome: "pass_failed",
          durationMs: Math.max(0, now() - startedAt),
          error: safeError(error),
        });
      }
    }

    const remaining = Math.max(0, intervalMs - (now() - startedAt));
    try {
      await sleep(remaining, dependencies.signal);
    } catch (error) {
      if (!dependencies.signal.aborted) throw error;
    }
  }
  log({ schemaVersion: 1, event: "keeper_worker", outcome: "stopping" });
}

async function runConfiguredKeeperPass(
  env: Record<string, string | undefined>,
  log: (event: KeeperWorkerEvent | KeeperLogEvent) => void,
): Promise<void> {
  const connection = createDevnetConnection(env);
  const readiness = await checkChainReadiness({
    connection,
    expectedGenesisHash: expectedGenesisHashFromEnv(env),
    expectedDeployedSbfSha256: KEEPER_EXPECTED_DEPLOYED_SBF_SHA256,
  });
  if (!readiness.ok) throw new Error(readiness.error ?? "chain is not ready");

  const writeEnabled = keeperWriteEnabledFromEnv(env);
  const protocolInfo = await connection.getAccountInfo(protocolPda(), "confirmed");
  if (!protocolInfo) {
    if (writeEnabled) {
      throw new Error("write-enabled keeper cannot run before protocol bootstrap");
    }
    log({
      schemaVersion: 1,
      event: "keeper_worker",
      outcome: "bootstrap_pending",
    });
    return;
  }

  const nowMilliseconds = Date.now();
  const routerEndpoint = env.MAGICBLOCK_ROUTER_RPC ??
    MAGICBLOCK_DEVNET_ROUTER_RPC;
  const adapter = await AnchorKeeperAdapter.create({
    connection,
    nowUnix: Math.floor(nowMilliseconds / 1_000),
    routerEndpoint,
  });
  const protocolSnapshot = await adapter.loadProtocolSnapshot();
  await runKeeperPass({
    connection,
    keeper: writeEnabled
      ? keeperKeypairFromEnv(env)
      : { publicKey: keeperPublicKeyFromEnv(env) },
    writeEnabled,
    now: () => nowMilliseconds,
    maxWrites: boundedKeeperInteger(
      env.KEEPER_MAX_WRITES,
      DEFAULT_MAX_WRITES,
      MAX_MAX_WRITES,
    ),
    minimumBalanceLamports: boundedKeeperInteger(
      env.MIN_KEEPER_LAMPORTS,
      DEFAULT_MIN_KEEPER_LAMPORTS,
      Number.MAX_SAFE_INTEGER,
    ),
    maximumSpendLamports: boundedKeeperInteger(
      env.KEEPER_MAX_SPEND_LAMPORTS_PER_PASS,
      DEFAULT_MAX_KEEPER_SPEND_LAMPORTS,
      DEFAULT_MAX_KEEPER_SPEND_LAMPORTS,
    ),
    protocolSnapshot,
    protocolMaterializer: adapter,
    resolveEphemeralConnection: (plan) => resolveEphemeralConnectionForPlan({
      plan,
      programId: ZKUBE_PROGRAM_ID,
      routerEndpoint,
    }),
    log,
  });
}

function requiredReleaseValue(
  value: string | undefined,
  label: string,
): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required for keeper release`);
  return normalized;
}

async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  await delay(milliseconds, undefined, { signal });
}

function jsonLog(event: KeeperWorkerEvent | KeeperLogEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 240);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  runKeeperWorker({ signal: controller.signal }).catch((error: unknown) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
}
