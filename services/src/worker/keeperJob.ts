// The keeper pass as one scheduled job. It is reached only from the Worker's
// Cron Trigger: nothing on the request path imports this module.

import { launchDayFromEnv } from "../../../shared/chain.js";
import { AnchorKeeperAdapter } from "../anchorIdlAdapter.js";
import { KEEPER_RECENT_DAILY_CADENCES, ZKUBE_PROGRAM_ID, protocolPda } from "../arcadeChain.js";
import {
  KEEPER_SCHEMA_VERSION, keeperKeypairFromEnv, keeperPublicKeyFromEnv, runKeeperPass, type KeeperLedger,
  type KeeperLogEvent,
} from "../keeper.js";
import { keeperReleaseRecord } from "../keeperRelease.js";
import { MAGICBLOCK_DEVNET_ROUTER_RPC, resolveEphemeralConnectionForPlan } from "../router.js";
import { checkChainReadiness, createDevnetConnection } from "../serviceReadiness.js";
import { dayIdAt } from "../zkubeCore.js";
import type { D1Like } from "./d1.js";
import { discoveryHints } from "./indexer.js";

export interface KeeperJobEnv {
  db: D1Like;
  workerVersionId: string | undefined;
  variables: Record<string, string | undefined>;
}

export interface KeeperJobEvent {
  schemaVersion: typeof KEEPER_SCHEMA_VERSION;
  event: "keeper_worker";
  outcome: "disabled" | "busy" | "bootstrap_pending" | "staged_launch_ready" | "pass_complete" | "pass_failed";
  fingerprint?: string;
  writeEnabled?: boolean;
  discovery?: "read_model" | "scan";
  error?: string;
}

/** Longer than any invocation can live, so only a dead pass loses its lease. */
export const KEEPER_LEASE_SECONDS = 900;
/** A relayed write can still land while its blockhash lives. */
export const KEEPER_UNSETTLED_SECONDS = 150;

export async function acquireKeeperLease(db: D1Like, holder: string, nowUnix: number): Promise<boolean> {
  const result = await db.prepare(`INSERT INTO keeper_lease (id, holder, expires_at) VALUES (1, ?1, ?2)
    ON CONFLICT (id) DO UPDATE SET holder = ?1, expires_at = ?2 WHERE keeper_lease.expires_at <= ?3`)
    .bind(holder, nowUnix + KEEPER_LEASE_SECONDS, nowUnix).run();
  return result.meta.changes === 1;
}

export async function releaseKeeperLease(db: D1Like, holder: string): Promise<void> {
  await db.prepare("DELETE FROM keeper_lease WHERE holder = ?").bind(holder).run();
}

export function keeperLedger(db: D1Like, pass: string): KeeperLedger {
  return {
    async unsettledLamports(nowUnix) {
      const row = await db.prepare(`SELECT COALESCE(SUM(reserved_lamports), 0) AS lamports FROM keeper_writes
        WHERE state = 'reserved' AND created_at > ?`).bind(nowUnix - KEEPER_UNSETTLED_SECONDS).first<{ lamports: number }>();
      return row?.lamports ?? 0;
    },
    async reserve(write) {
      const row = await db.prepare(`INSERT INTO keeper_writes (pass, operation, reserved_lamports, signature, state, created_at)
        VALUES (?, ?, ?, ?, 'reserved', ?)`).bind(pass, write.operation, write.lamports, write.signature, write.nowUnix).run();
      return async (outcome) => {
        await db.prepare("UPDATE keeper_writes SET state = ? WHERE id = ?").bind(outcome, row.meta.last_row_id).run();
      };
    },
  };
}

/** Writes are on only while the owner's stored approval names this exact release. */
export async function keeperWritesApproved(db: D1Like, fingerprint: string): Promise<boolean> {
  const row = await db.prepare("SELECT fingerprint FROM keeper_approval WHERE id = 1").first<{ fingerprint: string }>();
  return row?.fingerprint === fingerprint;
}

export async function runKeeperJob(
  env: KeeperJobEnv,
  nowMilliseconds: number,
  log: (event: KeeperJobEvent | KeeperLogEvent) => void,
): Promise<void> {
  const event = (outcome: KeeperJobEvent["outcome"], more: Partial<KeeperJobEvent> = {}) =>
    log({ schemaVersion: KEEPER_SCHEMA_VERSION, event: "keeper_worker", outcome, ...more });
  const variables = env.variables;
  if (!variables.ZKUBE_KEEPER_PUBLIC_KEY) return event("disabled");
  const pass = crypto.randomUUID();
  const nowUnix = Math.floor(nowMilliseconds / 1_000);
  let held = false;
  try {
    const release = keeperReleaseRecord({
      keeperPublicKey: keeperPublicKeyFromEnv(variables).toBase58(),
      workerVersionId: env.workerVersionId ?? "",
      launchDayId: launchDayFromEnv(variables),
    });
    held = await acquireKeeperLease(env.db, pass, nowUnix);
    if (!held) return event("busy");
    const connection = createDevnetConnection(variables);
    const readiness = await checkChainReadiness(connection);
    if (!readiness.ok) throw new Error(readiness.error ?? "chain is not ready");
    const writeEnabled = await keeperWritesApproved(env.db, release.fingerprint);
    const described = { fingerprint: release.fingerprint, writeEnabled };
    if (!await connection.getAccountInfo(protocolPda(), "confirmed")) return event("bootstrap_pending", described);

    const routerEndpoint = variables.MAGICBLOCK_ROUTER_RPC ?? MAGICBLOCK_DEVNET_ROUTER_RPC;
    const firstDay = Math.max(release.record.launchDayId, dayIdAt(BigInt(nowUnix)) - KEEPER_RECENT_DAILY_CADENCES);
    const discovery = await discoveryHints(env.db, nowUnix, firstDay);
    const adapter = await AnchorKeeperAdapter.create({
      connection, nowUnix, routerEndpoint, launchDayId: release.record.launchDayId,
      ...(discovery ? { discovery } : {}),
    });
    if (await adapter.inspectLaunchState() === "staged_launch_ready") return event("staged_launch_ready", described);
    const result = await runKeeperPass({
      connection,
      keeper: writeEnabled ? keeperKeypairFromEnv(variables) : { publicKey: keeperPublicKeyFromEnv(variables) },
      writeEnabled,
      now: () => nowMilliseconds,
      traceId: pass,
      ledger: keeperLedger(env.db, pass),
      protocolSnapshot: await adapter.loadProtocolSnapshot(),
      protocolMaterializer: adapter,
      resolveEphemeralConnection: (plan) => resolveEphemeralConnectionForPlan({
        plan, programId: ZKUBE_PROGRAM_ID, routerEndpoint,
      }),
      log,
    });
    event(result.ok ? "pass_complete" : "pass_failed", { ...described, discovery: discovery ? "read_model" : "scan" });
  } catch (error) {
    event("pass_failed", { error: (error instanceof Error ? error.message : String(error)).slice(0, 240) });
  } finally {
    if (held) await releaseKeeperLease(env.db, pass);
  }
}
