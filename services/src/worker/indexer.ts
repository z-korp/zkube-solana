// The public read model: every scored run, and the keeper's discovery hints.
//
// It is fed by Base transactions of the zKube program, delivered by webhook or
// fetched by bounded catch-up. It is never an authority: the program's boards
// are the leaderboard of record, claims read the chain, and the keeper reads
// every hinted account from the chain before acting on it.

import { BorshEventCoder, BorshInstructionCoder, convertIdlToCamelCase, utils, type Idl } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";

import { IDL } from "../../../tools/chain/idl/index.js";
import { ZKUBE_PROGRAM_ID, arenaDailyPda } from "../arcadeChain.js";
import { ARENA_BOARD_CAPACITY } from "../protocolVersions.generated.js";
import { dayIdAt } from "../zkubeCore.js";
import type { D1Like, D1Statement } from "./d1.js";

export type BoardKind = "score" | "theme";

/** A transaction as `getTransaction` and a raw transaction webhook deliver it. */
export interface RawTransaction {
  slot: number;
  blockTime: number;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: string[];
      instructions: { programIdIndex: number; accounts: number[]; data: string }[];
    };
  };
  meta: {
    err: unknown;
    logMessages: string[];
    innerInstructions: { instructions: { programIdIndex: number; accounts: number[]; data: string }[] }[];
    loadedAddresses?: { writable: string[]; readonly: string[] };
  };
}

export const MAX_WEBHOOK_TRANSACTIONS = 100;
export const MAX_PAGE_ROWS = 100;
const EVENT_PREFIX = "Program data: ";
const camelIdl = convertIdlToCamelCase(IDL as unknown as Idl);
const events = new BorshEventCoder(camelIdl);
const instructions = new BorshInstructionCoder(camelIdl);
const PROGRAM = ZKUBE_PROGRAM_ID.toBase58();

/** Rejects anything that is not the documented transaction shape. */
export function parseTransaction(value: unknown): RawTransaction {
  const fail = (): never => { throw new Error("transaction payload is malformed"); };
  const record = (item: unknown) => item !== null && typeof item === "object" && !Array.isArray(item)
    ? item as Record<string, unknown> : fail();
  const strings = (item: unknown, limit: number) => Array.isArray(item) && item.length <= limit &&
    item.every((entry) => typeof entry === "string" && entry.length <= 2_048) ? item as string[] : fail();
  const root = record(value), transaction = record(root.transaction), message = record(transaction.message);
  const meta = record(root.meta);
  if (!Number.isSafeInteger(root.slot) || Number(root.slot) < 0 ||
      !Number.isSafeInteger(root.blockTime) || Number(root.blockTime) < 0) fail();
  const signatures = strings(transaction.signatures, 16);
  if (signatures.length === 0) fail();
  const calls = (item: unknown, limit: number) => (Array.isArray(item) && item.length <= limit ? item : fail())
    .map((entry) => {
      const call = record(entry);
      const accounts = Array.isArray(call.accounts) && call.accounts.length <= 64 &&
        call.accounts.every((index) => Number.isInteger(index) && Number(index) >= 0 && Number(index) < 256)
        ? call.accounts as number[] : fail();
      if (!Number.isInteger(call.programIdIndex) || typeof call.data !== "string" || call.data.length > 2_048) fail();
      return { programIdIndex: Number(call.programIdIndex), accounts, data: String(call.data) };
    });
  const inner = meta.innerInstructions === undefined || meta.innerInstructions === null ? [] : meta.innerInstructions;
  const loaded = meta.loadedAddresses === undefined || meta.loadedAddresses === null
    ? undefined : record(meta.loadedAddresses);
  return {
    slot: Number(root.slot),
    blockTime: Number(root.blockTime),
    transaction: {
      signatures,
      message: {
        accountKeys: strings(message.accountKeys, 256),
        instructions: calls(message.instructions, 64),
      },
    },
    meta: {
      err: meta.err ?? null,
      logMessages: meta.logMessages === null || meta.logMessages === undefined ? [] : strings(meta.logMessages, 512),
      innerInstructions: (Array.isArray(inner) && inner.length <= 64 ? inner : fail())
        .map((group) => ({ instructions: calls(record(group).instructions, 256) })),
      ...(loaded ? { loadedAddresses: { writable: strings(loaded.writable, 256), readonly: strings(loaded.readonly, 256) } } : {}),
    },
  };
}

/**
 * Records what one confirmed zKube transaction did. Ingesting the same
 * transaction again, or in another order, leaves the same rows. An
 * instruction counts wherever it ran: sent directly, or called by another
 * program.
 */
export async function ingestTransaction(db: D1Like, raw: RawTransaction): Promise<boolean> {
  const signature = raw.transaction.signatures[0]!;
  if (await db.prepare("SELECT 1 FROM transactions WHERE signature = ?").bind(signature).first()) return false;
  const statements: D1Statement[] = [
    db.prepare("INSERT OR IGNORE INTO transactions (signature, slot) VALUES (?, ?)").bind(signature, raw.slot),
  ];
  if (raw.meta.err === null) {
    const keys = [...raw.transaction.message.accountKeys,
      ...(raw.meta.loadedAddresses?.writable ?? []), ...(raw.meta.loadedAddresses?.readonly ?? [])];
    for (const call of [...raw.transaction.message.instructions,
      ...raw.meta.innerInstructions.flatMap((group) => group.instructions)]) {
      if (keys[call.programIdIndex] !== PROGRAM) continue;
      let decoded: ReturnType<BorshInstructionCoder["decode"]>;
      try { decoded = instructions.decode(Buffer.from(utils.bytes.bs58.decode(call.data))); } catch { continue; }
      if (!decoded) continue;
      const account = (name: string) => {
        const definition = IDL.instructions.find((item) => camel(item.name) === decoded!.name)!;
        const index = definition.accounts.findIndex((item) => item.name === name);
        const key = keys[call.accounts[index] ?? -1];
        if (index < 0 || key === undefined) throw new Error("transaction payload is malformed");
        return key;
      };
      statements.push(...instructionRows(db, decoded.name, account, raw));
    }
    for (const line of programData(raw.meta.logMessages)) {
      let event: ReturnType<BorshEventCoder["decode"]>;
      try { event = events.decode(line); } catch { continue; }
      if (event?.name === "runScored") statements.push(scoredRow(db, event.data as Record<string, unknown>, signature, raw.slot));
    }
  }
  await db.batch(statements);
  return true;
}

/**
 * The data lines the zKube program itself logged. Any program in the
 * transaction can log the same bytes, so a line counts only while zKube is
 * the program running: the runtime writes the invoke and exit lines, and no
 * program can forge them.
 */
function programData(logs: readonly string[]): string[] {
  const running: string[] = [], lines: string[] = [];
  for (const line of logs) {
    const invoked = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoked) running.push(invoked[1]!);
    else if (/^Program \w+ (success|failed)/.test(line)) running.pop();
    else if (line.startsWith(EVENT_PREFIX) && running.at(-1) === PROGRAM) lines.push(line.slice(EVENT_PREFIX.length));
  }
  return lines;
}

function instructionRows(db: D1Like, name: string, account: (name: string) => string, raw: RawTransaction): D1Statement[] {
  switch (name) {
    case "enterArena": {
      const daily = account("current_daily");
      const owner = account("owner_authority");
      return [
        db.prepare(`INSERT INTO daily_players (address, daily, owner, entered_slot) VALUES (?1, ?2, ?3, ?4)
          ON CONFLICT (address) DO UPDATE SET daily = ?2, owner = ?3, entered_slot = MAX(COALESCE(entered_slot, 0), ?4)`)
          .bind(account("arena_player"), daily, owner, raw.slot),
        db.prepare(`INSERT INTO runs (address, owner, daily, entered_slot) VALUES (?1, ?2, ?3, ?4)
          ON CONFLICT (address) DO UPDATE SET owner = ?2, daily = ?3, entered_slot = MAX(COALESCE(entered_slot, 0), ?4)`)
          .bind(account("active_run"), owner, daily, raw.slot),
      ];
    }
    case "consumeArenaRun":
      // The entry may arrive later: keep the tombstone so it cannot revive the hint.
      return [db.prepare(`INSERT INTO runs (address, owner, daily, consumed_slot) VALUES (?1, '', '', ?2)
        ON CONFLICT (address) DO UPDATE SET consumed_slot = MAX(COALESCE(consumed_slot, 0), ?2)`).bind(account("active_run"), raw.slot)];
    case "closeArenaPlayer":
      return [db.prepare(`INSERT INTO daily_players (address, daily, owner, closed_slot) VALUES (?1, '', '', ?2)
        ON CONFLICT (address) DO UPDATE SET closed_slot = MAX(COALESCE(closed_slot, 0), ?2)`).bind(account("arena_player"), raw.slot)];
    case "finalizeArenaDaily":
      // Stored by address: a Daily finalizes whenever its last run resolves, so
      // no window of days around the block bounds which Daily this is.
      return [db.prepare("INSERT OR IGNORE INTO finalized_dailies (daily, slot) VALUES (?, ?)")
        .bind(account("arena_daily"), raw.slot)];
    default:
      return [];
  }
}

function scoredRow(db: D1Like, data: Record<string, unknown>, signature: string, slot: number): D1Statement {
  const row = data.row as Record<string, unknown>;
  const owner = new PublicKey(String(row.player));
  return db.prepare(`INSERT OR REPLACE INTO results
    (day_id, owner, owner_hex, run_id, score_key, objective_key, finalized_at, replay_hash, signature, slot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    Number(data.dayId), owner.toBase58(), Buffer.from(owner.toBytes()).toString("hex"), String(data.runId),
    key(String(row.score), 10), key(String(row.objectiveTotal), 20), Number(row.finalizedAt),
    Buffer.from(row.replayHash as number[]).toString("hex"), signature, slot);
}

const key = (decimal: string, width: number) => {
  if (!/^\d+$/.test(decimal) || decimal.length > width) throw new Error("metric is out of range");
  return decimal.padStart(width, "0");
};
const camel = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

const METRIC = { score: ["score_key", 10], theme: ["objective_key", 20] } as const;

// One row per wallet: its best run, then ranked as the program orders a board
// (metric, earliest finalized achievement, wallet bytes).
const ranked = (kind: BoardKind) => {
  const [column, width] = METRIC[kind];
  return `WITH best AS (
    SELECT owner, owner_hex, metric, finalized_at FROM (
      SELECT owner, owner_hex, ${column} AS metric, finalized_at,
        ROW_NUMBER() OVER (PARTITION BY owner ORDER BY ${column} DESC, finalized_at ASC) AS choice
      FROM results WHERE day_id = ?1 AND ${column} > '${"0".repeat(width)}') WHERE choice = 1),
  ranked AS (
    SELECT owner, metric, finalized_at,
      ROW_NUMBER() OVER (ORDER BY metric DESC, finalized_at ASC, owner_hex ASC) AS rank,
      COUNT(*) OVER () AS total
    FROM best)`;
};

export interface StandingRow { rank: number; owner: string; metric: string; finalizedAt: number; paying: boolean | null }

/** A page of a day's full standings, including the ranks below the paying rows. */
export async function standings(db: D1Like, dayId: number, kind: BoardKind, offset: number, limit: number) {
  const rows = (await db.prepare(`${ranked(kind)}
    SELECT owner, metric, finalized_at, rank, total FROM ranked WHERE rank > ?2 ORDER BY rank LIMIT ?3`)
    .bind(dayId, offset, limit).all<{ owner: string; metric: string; finalized_at: number; rank: number; total: number }>()).results;
  const total = rows[0]?.total ?? (await db.prepare(`${ranked(kind)} SELECT COUNT(*) AS total FROM ranked`)
    .bind(dayId).first<{ total: number }>())?.total ?? 0;
  return { total, rows: rows.map(present) };
}

/** One wallet's rank on a day's board, wherever it stands. */
export async function rankOf(db: D1Like, dayId: number, kind: BoardKind, owner: string) {
  const row = await db.prepare(`${ranked(kind)}
    SELECT owner, metric, finalized_at, rank, total FROM ranked WHERE owner = ?2`)
    .bind(dayId, owner).first<{ owner: string; metric: string; finalized_at: number; rank: number; total: number }>();
  return row ? { total: row.total, row: present(row) } : null;
}

const present = (row: { owner: string; metric: string; finalized_at: number; rank: number }): StandingRow => ({
  rank: row.rank, owner: row.owner, metric: BigInt(row.metric).toString(), finalizedAt: row.finalized_at,
  // Only the chain says who is paid; a rank the board cannot retain never is.
  paying: row.rank > ARENA_BOARD_CAPACITY ? false : null,
});

export interface SyncState {
  tip: string | null; gapBefore: string | null; gapTip: string | null; caughtUpAt: number; unreadable: number;
}

/**
 * Keeps a transaction of the program that could not be interpreted, so the
 * walk continues past it and the model says it is incomplete.
 */
export async function recordUnreadable(db: D1Like, signature: string, slot: number): Promise<void> {
  await db.prepare(`INSERT INTO transactions (signature, slot, unreadable) VALUES (?1, ?2, 1)
    ON CONFLICT (signature) DO NOTHING`).bind(signature, slot).run();
}

export async function syncState(db: D1Like): Promise<SyncState> {
  const row = await db.prepare(`SELECT tip, gap_before, gap_tip, caught_up_at,
    (SELECT COUNT(*) FROM transactions WHERE unreadable = 1) AS unreadable FROM sync WHERE id = 1`)
    .first<{ tip: string | null; gap_before: string | null; gap_tip: string | null; caught_up_at: number; unreadable: number }>();
  if (!row) throw new Error("the read model's schema has not been applied");
  return { tip: row.tip, gapBefore: row.gap_before, gapTip: row.gap_tip, caughtUpAt: row.caught_up_at,
    unreadable: row.unreadable };
}

/**
 * Whether a catch-up walk has reached the last complete point with no page
 * left to read and no transaction it could not interpret.
 */
export const modelComplete = (state: SyncState) =>
  state.caughtUpAt > 0 && state.gapBefore === null && state.unreadable === 0;

export async function dayIsFinal(db: D1Like, dayId: number): Promise<boolean> {
  return !!await db.prepare("SELECT 1 FROM finalized_dailies WHERE daily = ?")
    .bind(arenaDailyPda(dayId).toBase58()).first();
}

/** How long the keeper trusts hints after the last complete catch-up. */
export const DISCOVERY_FRESH_SECONDS = 300;

/**
 * The keeper's discovery hints for the Dailies from `firstDay` to today, or
 * null when the model cannot vouch that it has seen everything. A hint is
 * never proof of absence: the keeper checks the set against the chain.
 */
export async function discoveryHints(db: D1Like, nowUnix: number, firstDay: number):
Promise<{ arenaPlayers: PublicKey[]; runOwners: PublicKey[] } | null> {
  const state = await syncState(db);
  if (!modelComplete(state) || nowUnix - state.caughtUpAt > DISCOVERY_FRESH_SECONDS) return null;
  const dailies: string[] = [];
  for (let day = Math.max(0, firstDay); day <= dayIdAt(BigInt(nowUnix)); day += 1) dailies.push(arenaDailyPda(day).toBase58());
  if (dailies.length === 0 || dailies.length > MAX_HINTED_DAILIES) return null;
  const within = `daily IN (${dailies.map(() => "?").join(", ")})`;
  const players = await db.prepare(
    `SELECT address FROM daily_players WHERE closed_slot IS NULL AND entered_slot IS NOT NULL AND ${within}`)
    .bind(...dailies).all<{ address: string }>();
  const runs = await db.prepare(
    `SELECT DISTINCT owner FROM runs WHERE consumed_slot IS NULL AND entered_slot IS NOT NULL AND ${within}`)
    .bind(...dailies).all<{ owner: string }>();
  return {
    arenaPlayers: players.results.map(({ address }) => new PublicKey(address)),
    runOwners: runs.results.map(({ owner }) => new PublicKey(owner)),
  };
}

/** One query binds each hinted Daily's address; D1 allows a hundred. */
const MAX_HINTED_DAILIES = 100;
