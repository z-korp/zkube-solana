import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDevnetConnection } from "./serviceReadiness.js";
import {
  boundedKeeperInteger,
  DEFAULT_MAX_KEEPER_SPEND_LAMPORTS,
  DEFAULT_MIN_KEEPER_LAMPORTS,
  keeperKeypairFromEnv,
  runKeeperPass,
  type KeeperLogEvent,
} from "./keeper.js";
import {
  checkChainReadiness,
  expectedGenesisHashFromEnv,
} from "./serviceReadiness.js";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_WRITES = 8;
const MAX_MAX_WRITES = 16;

/** SHA-256 of the full padded SBF bytes currently stored in ProgramData. */
export const KEEPER_EXPECTED_DEPLOYED_SBF_SHA256 =
  "2f345f3b1cfef82fdb32c7e8e913783cd33af555c9f8afcddc3fc1baf0d90e0d";
/** Operator-facing release binding derived from the full deployed fingerprint. */
export const KEEPER_WRITE_RELEASE_FINGERPRINT =
  KEEPER_EXPECTED_DEPLOYED_SBF_SHA256.slice(0, 16);

/**
 * Writes stay disabled unless Fly injects both the case-sensitive opt-in and
 * the fingerprint compiled into this keeper release. A stale write secret from
 * an older image therefore cannot authorize a newly deployed image.
 */
export function keeperWriteEnabledFromEnv(
  env: Record<string, string | undefined>,
): boolean {
  return env.KEEPER_WRITE_ENABLED === "true"
    && env.KEEPER_APPROVED_RELEASE_FINGERPRINT === KEEPER_WRITE_RELEASE_FINGERPRINT;
}

export interface KeeperWorkerEvent {
  schemaVersion: 1;
  event: "keeper_worker";
  outcome: "disabled" | "pass_complete" | "pass_failed" | "stopping";
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

  await runKeeperPass({
    connection,
    keeper: keeperKeypairFromEnv(env),
    writeEnabled: keeperWriteEnabledFromEnv(env),
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
    log,
  });
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
