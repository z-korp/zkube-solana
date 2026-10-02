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
    innerInstructions: { index: number; instructions: { programIdIndex: number; accounts: number[]; data: string }[] }[];
    loadedAddresses?: { writable: string[]; readonly: string[] };
  };
}

/**
 * A transaction this model cannot interpret, whatever is tried again: its
 * payload is not the documented shape, or its log does not account for its
 * instructions. A storage failure is never this error: it is retried.
 */
export class UnreadableTransaction extends Error {
  constructor(reason: string) { super(`unreadable transaction: ${reason}`); }
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
  const fail = (): never => { throw new UnreadableTransaction("payload is malformed"); };
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
        .map((group) => {
          const index = record(group).index;
          if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= 64) fail();
          return { index: Number(index), instructions: calls(record(group).instructions, 256) };
        }),
      ...(loaded ? { loadedAddresses: { writable: strings(loaded.writable, 256), readonly: strings(loaded.readonly, 256) } } : {}),
    },
  };
}

/**
 * Records what one confirmed zKube transaction did. Ingesting the same
 * transaction again, or in another order, leaves the same rows, and a
 * readable copy replaces a marker left when it could not be read.
 *
 * An instruction counts wherever it ran, sent directly or called by another
 * program, and only where the runtime's log shows that call and every caller
 * above it succeeding. The outer transaction's status says nothing about one
 * inner call.
 */
export async function ingestTransaction(db: D1Like, raw: RawTransaction): Promise<boolean> {
  const signature = raw.transaction.signatures[0]!;
  if (await db.prepare("SELECT 1 FROM transactions WHERE signature = ? AND unreadable = 0").bind(signature).first()) return false;
  const statements = [
    db.prepare(`INSERT INTO transactions (signature, slot, unreadable) VALUES (?1, ?2, 0)
      ON CONFLICT (signature) DO UPDATE SET slot = ?2, unreadable = 0`).bind(signature, raw.slot),
    ...interpret(db, raw, signature),
  ];
  await db.batch(statements);
  return true;
}

/** Every row a transaction adds. It throws only UnreadableTransaction, and touches no storage. */
function interpret(db: D1Like, raw: RawTransaction, signature: string): D1Statement[] {
  if (raw.meta.err !== null) return [];
  const statements: D1Statement[] = [];
  const keys = [...raw.transaction.message.accountKeys,
    ...(raw.meta.loadedAddresses?.writable ?? []), ...(raw.meta.loadedAddresses?.readonly ?? [])];
  // Execution order: each top-level instruction, then what it called.
  const executed = raw.transaction.message.instructions.flatMap((call, index) => [call,
    ...raw.meta.innerInstructions.filter((group) => group.index === index).flatMap((group) => group.instructions)])
    .filter((call) => keys[call.programIdIndex] === PROGRAM);
  const invocations = programInvocations(raw.meta.logMessages);
  if (invocations.length !== executed.length) {
    throw new UnreadableTransaction("its log does not account for every zKube instruction");
  }
  for (const [index, call] of executed.entries()) {
    if (!invocations[index]!.succeeded) continue;
    let decoded: ReturnType<BorshInstructionCoder["decode"]>;
    try { decoded = instructions.decode(Buffer.from(utils.bytes.bs58.decode(call.data))); } catch { continue; }
    if (!decoded) continue;
    const account = (name: string) => {
      const definition = IDL.instructions.find((item) => camel(item.name) === decoded!.name)!;
      const position = definition.accounts.findIndex((item) => item.name === name);
      const key = keys[call.accounts[position] ?? -1];
      if (position < 0 || key === undefined) throw new UnreadableTransaction("an instruction names too few accounts");
      return key;
    };
    statements.push(...instructionRows(db, decoded.name, account, raw));
  }
  for (const line of invocations.filter(({ succeeded }) => succeeded).flatMap(({ data }) => data)) {
    let event: ReturnType<BorshEventCoder["decode"]>;
    try { event = events.decode(line); } catch { continue; }
    if (event?.name === "runScored") {
      try { statements.push(scoredRow(db, event.data as Record<string, unknown>, signature, raw.slot)); }
      catch { throw new UnreadableTransaction("a result event is malformed"); }
    }
  }
  return statements;
}

/**
 * Each zKube invocation the runtime logged, in the order it ran: whether it
 * and every caller above it ended in success, and the data it logged itself.
 * The runtime writes the invoke and exit lines and no program can forge them,
 * so another program logging the same bytes, or reporting success over a
 * rejected call, changes nothing here.
 */
function programInvocations(logs: readonly string[]): { succeeded: boolean; data: string[] }[] {
  interface Frame { program: string; failed: boolean; own: { succeeded: boolean; data: string[] } | null }
  const running: Frame[] = [], found: { succeeded: boolean; data: string[] }[] = [];
  // A frame that fails undoes everything that ran inside it.
  const undo: { succeeded: boolean }[][] = [];
  for (const line of logs) {
    const invoked = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    const exited = /^Program (\w+) (success|failed)/.exec(line);
    if (invoked) {
      const own = invoked[1] === PROGRAM ? { succeeded: false, data: [] } : null;
      if (own) found.push(own);
      running.push({ program: invoked[1]!, failed: false, own });
      undo.push(own ? [own] : []);
    } else if (exited && running.at(-1)?.program === exited[1]) {
      const frame = running.pop()!, inside = undo.pop()!;
      if (exited[2] === "success") {
        if (frame.own) frame.own.succeeded = true;
        undo.at(-1)?.push(...inside);
      } else {
        for (const call of inside) call.succeeded = false;
      }
    } else if (line.startsWith(EVENT_PREFIX) && running.at(-1)?.own) {
      running.at(-1)!.own!.data.push(line.slice(EVENT_PREFIX.length));
    }
  }
  // A call with no exit line is a log cut short: what it did is not known.
  if (running.length > 0) throw new UnreadableTransaction("its log is cut short");
  return found;
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
