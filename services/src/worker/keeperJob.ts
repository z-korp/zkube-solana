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
/** The keeper discovers by scanning the chain at least this often, whatever the read model says. */
export const KEEPER_SCAN_SECONDS = 3_600;
export async function acquireKeeperLease(db: D1Like, holder: string, nowUnix: number): Promise<boolean> {
  const result = await db.prepare(`INSERT INTO keeper_lease (id, holder, expires_at) VALUES (1, ?1, ?2)
    ON CONFLICT (id) DO UPDATE SET holder = ?1, expires_at = ?2 WHERE keeper_lease.expires_at <= ?3`)
    .bind(holder, nowUnix + KEEPER_LEASE_SECONDS, nowUnix).run();
  return result.meta.changes === 1;
}

export async function releaseKeeperLease(db: D1Like, holder: string): Promise<void> {
  await db.prepare("DELETE FROM keeper_lease WHERE holder = ?").bind(holder).run();
}

export function keeperLedger(db: D1Like, pass: string, clock: () => number = () => Math.floor(Date.now() / 1_000)): KeeperLedger {
  return {
    async pending() {
      const open = await db.prepare(`SELECT id, operation, reserved_lamports, payer_lamports, signature, endpoint,
        last_valid_block_height FROM keeper_writes WHERE state = 'reserved' ORDER BY id`).all<{ id: number;
        operation: string; reserved_lamports: number; payer_lamports: number; signature: string; endpoint: string;
        last_valid_block_height: number }>();
      return open.results.map((row) => ({ id: row.id, operation: row.operation, lamports: row.reserved_lamports,
        payerLamports: row.payer_lamports, signature: row.signature, endpoint: row.endpoint,
        lastValidBlockHeight: row.last_valid_block_height }));
    },
    async reserve(write) {
      // Stamped when the write is made, not when its pass began.
      const row = await db.prepare(`INSERT INTO keeper_writes (pass, operation, reserved_lamports, payer_lamports,
        signature, endpoint, last_valid_block_height, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?)`)
        .bind(pass, write.operation, write.lamports, write.payerLamports, write.signature, write.endpoint,
          write.lastValidBlockHeight, clock()).run();
      return row.meta.last_row_id;
    },
    async settle(id, outcome) {
      await db.prepare("UPDATE keeper_writes SET state = ? WHERE id = ? AND state = 'reserved'").bind(outcome, id).run();
    },
  };
}

/** Whether this pass must scan the chain rather than start from hints. */
export async function keeperScanDue(db: D1Like, nowUnix: number): Promise<boolean> {
  const row = await db.prepare("SELECT scanned_at FROM keeper_scan WHERE id = 1").first<{ scanned_at: number }>();
  return !row || nowUnix - row.scanned_at >= KEEPER_SCAN_SECONDS;
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
    // Hints only shorten a pass. The adapter checks them against the chain's
    // own count of unresolved entries, and a full scan runs every hour anyway.
    const discovery = await keeperScanDue(env.db, nowUnix) ? null : await discoveryHints(env.db, nowUnix, firstDay);
    const adapter = await AnchorKeeperAdapter.create({
      connection, nowUnix, routerEndpoint, launchDayId: release.record.launchDayId,
      ...(discovery ? { discovery } : {}),
    });
    if (await adapter.inspectLaunchState() === "staged_launch_ready") return event("staged_launch_ready", described);
    const protocolSnapshot = await adapter.loadProtocolSnapshot();
    if (adapter.discovered === "scan") {
      await env.db.prepare(`INSERT INTO keeper_scan (id, scanned_at) VALUES (1, ?1)
        ON CONFLICT (id) DO UPDATE SET scanned_at = ?1`).bind(nowUnix).run();
    }
    const result = await runKeeperPass({
      connection,
      keeper: writeEnabled ? keeperKeypairFromEnv(variables) : { publicKey: keeperPublicKeyFromEnv(variables) },
      writeEnabled,
      now: () => nowMilliseconds,
      traceId: pass,
      ledger: keeperLedger(env.db, pass),
      protocolSnapshot,
      protocolMaterializer: adapter,
      resolveEphemeralConnection: (plan) => resolveEphemeralConnectionForPlan({
        plan, programId: ZKUBE_PROGRAM_ID, routerEndpoint,
      }),
      log,
    });
    event(result.ok ? "pass_complete" : "pass_failed", { ...described, discovery: adapter.discovered });
  } catch (error) {
    event("pass_failed", { error: (error instanceof Error ? error.message : String(error)).slice(0, 240) });
  } finally {
    if (held) await releaseKeeperLease(env.db, pass);
  }
}
