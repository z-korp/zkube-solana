// @vitest-environment node
// The one Worker, offline: the built bundle runs in the Workers runtime under
// Miniflare with a real D1 database, fed transactions made from the Rust
// program's own bytes.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BorshAccountsCoder, convertIdlToCamelCase, utils, type Idl } from "@anchor-lang/core";
import { Keypair, PublicKey, TransactionInstruction, VersionedMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { IDL } from "../../tools/chain/idl/index.js";
import { SOLANA_DEVNET_GENESIS_HASH } from "../../shared/chain.js";
import { ZKUBE_PROGRAM_ID, arenaDailyPda, cadenceFundingPda, protocolPda } from "../src/arcadeChain.js";
import { KEEPER_LIMITS, runKeeperPass } from "../src/keeper.js";
import { keeperReleaseRecord } from "../src/keeperRelease.js";
import { ARENA_BOARD_CAPACITY } from "../src/protocolVersions.generated.js";
import { compareBoardEntries, dailyWindow, dayIdAt } from "../src/zkubeCore.js";
import { CATCH_UP_PAGE, CATCH_UP_PAGES_PER_RUN, catchUp, type JsonRpc } from "../src/worker/catchUp.js";
import type { D1Like } from "../src/worker/d1.js";
import {
  DISCOVERY_FRESH_SECONDS, discoveryHints, ingestTransaction, parseTransaction, rankOf, standings, syncState,
} from "../src/worker/indexer.js";
import {
  KEEPER_CRON, KEEPER_LEASE_SECONDS, KEEPER_SCAN_SECONDS, acquireKeeperLease, keeperLedger, keeperScanDue, keeperWritesApproved,
  releaseKeeperLease,
} from "../src/worker/keeperJob.js";

const root = new URL("../../", import.meta.url);
const programFixtures = JSON.parse(readFileSync(new URL("fixtures/program-unity-v1.json", root), "utf8"));
const fixtures = programFixtures.indexer;
const DAY: number = fixtures.scored[0].dayId;
const NOW = dailyWindow(DAY).opensAt;
const PROGRAM = ZKUBE_PROGRAM_ID.toBase58();
const WEBHOOK_SECRET = "delivery-secret";
const VERSION = "0b8a2f6e-3c1d-4e5f-9a7b-1c2d3e4f5a6b";
const keeper = Keypair.generate();
// The Worker runs on the real clock, so its release launches on the real day.
const LAUNCH_DAY = dayIdAt(BigInt(Math.floor(Date.now() / 1_000)));
const tables = ["transactions", "results", "finalized_dailies", "daily_players", "runs", "keeper_lease", "keeper_writes",
  "keeper_approval", "keeper_scan"];
const MODEL = ["results", "finalized_dailies", "daily_players", "runs"];

/** A fixture message as `getTransaction` returns it, with the given logs. */
function confirmed(fixture: { message: string; decodedAccounts: { address: string; writable: boolean }[] },
  signature: string, blockTime: number, logs: string[] = [], err: unknown = null) {
  const message = VersionedMessage.deserialize(Buffer.from(fixture.message, "base64"));
  const loaded = fixture.decodedAccounts.slice(message.staticAccountKeys.length);
  return {
    slot: blockTime - NOW + 1_000, blockTime,
    transaction: { signatures: [signature], message: {
      accountKeys: message.staticAccountKeys.map((key) => key.toBase58()),
      instructions: message.compiledInstructions.map((call) => ({ programIdIndex: call.programIdIndex,
        accounts: [...call.accountKeyIndexes], data: utils.bytes.bs58.encode(Buffer.from(call.data)) })),
    } },
    // The runtime's own lines: one invocation per instruction, zKube's ending in success.
    meta: { err, innerInstructions: [] as { index: number; instructions: unknown[] }[],
      logMessages: logs.some((line) => line.includes(" invoke [")) ? logs
        : message.compiledInstructions.flatMap((call, index, all) => {
          const program = message.staticAccountKeys[call.programIdIndex]!.toBase58();
          const last = index === all.length - 1;
          return [`Program ${program} invoke [1]`, ...(last ? logs : []), `Program ${program} success`];
        }),
      loadedAddresses: { writable: loaded.filter((key) => key.writable).map((key) => key.address),
        readonly: loaded.filter((key) => !key.writable).map((key) => key.address) } },
  };
}

/** The log a scored consume writes, laid out as the program's RunScored event. */
function scoredLog(row: { dayId: number; runId: bigint; player: PublicKey; score: number; objectiveTotal: bigint;
  finalizedAt: number; replayHash: number }) {
  const data = Buffer.alloc(8 + 4 + 8 + 32 + 4 + 8 + 8 + 32, row.replayHash);
  Buffer.from((IDL.events as readonly { name: string; discriminator: number[] }[]).find((event) => event.name === "RunScored")!.discriminator).copy(data);
  data.writeUInt32LE(row.dayId, 8); data.writeBigUInt64LE(row.runId, 12);
  Buffer.from(row.player.toBytes()).copy(data, 20);
  data.writeUInt32LE(row.score, 52); data.writeBigUInt64LE(row.objectiveTotal, 56);
  data.writeBigInt64LE(BigInt(row.finalizedAt), 64);
  return `Program data: ${data.toString("base64")}`;
}

/**
 * The same transaction with its zKube instructions called by another program
 * instead of sent directly: they move to the inner instructions the runtime
 * records, under a top-level call to a program already in the message.
 */
function viaCpi(transaction: ReturnType<typeof confirmed>) {
  const keys = transaction.transaction.message.accountKeys;
  const direct = transaction.transaction.message.instructions;
  const own = direct.filter((call) => keys[call.programIdIndex] === PROGRAM);
  // Any account that is not zKube stands for the calling program.
  const caller = direct.find((call) => keys[call.programIdIndex] !== PROGRAM)?.programIdIndex ?? 0;
  const others = direct.filter((call) => keys[call.programIdIndex] !== PROGRAM);
  const callerKey = keys[caller]!;
  return { ...transaction,
    transaction: { ...transaction.transaction, message: { accountKeys: keys,
      instructions: [...others, { programIdIndex: caller, accounts: [], data: "" }] } },
    meta: { ...transaction.meta,
      innerInstructions: [{ index: others.length, instructions: own.map((call) => ({ ...call, stackHeight: 2 })) }],
      logMessages: [...others.flatMap((call) => [`Program ${keys[call.programIdIndex]!} invoke [1]`,
        `Program ${keys[call.programIdIndex]!} success`]), `Program ${callerKey} invoke [1]`,
      ...zkubeLines(transaction.meta.logMessages).map((line) => line.replace(" invoke [1]", " invoke [2]")),
      `Program ${callerKey} success`] } };
}

/** The log lines from zKube's first invocation to its last exit. */
const zkubeLines = (logs: string[]) => logs.slice(logs.indexOf(`Program ${PROGRAM} invoke [1]`),
  logs.lastIndexOf(`Program ${PROGRAM} success`) + 1);

/** Only the instruction layout of `viaCpi`, for a transaction whose log is written by hand. */
const viaCpiShape = (transaction: ReturnType<typeof confirmed>) => {
  const nested = viaCpi(transaction);
  return { transaction: nested.transaction, meta: { ...nested.meta, logMessages: transaction.meta.logMessages } };
};

const history = () => [
  confirmed(fixtures.entry, "entry", NOW + 10),
  confirmed(fixtures.consume, "consume-1", NOW + 60, [fixtures.scored[0].log]),
  confirmed(fixtures.consume, "consume-2", NOW + 120, [fixtures.scored[1].log, fixtures.scored[2].log]),
  confirmed(fixtures.consume, "consume-3", NOW + 300, [fixtures.scored[3].log]),
  confirmed(fixtures.finalize, "finalize", NOW + 86_400 + 600),
  confirmed(fixtures.closePlayer, "close", NOW + 86_400 + 660),
];

/** The cluster's signature index over a list of confirmed transactions. */
function cluster(transactions: ReturnType<typeof confirmed>[]) {
  const calls: string[] = [];
  const rpc: JsonRpc = async (method, params) => {
    calls.push(method);
    if (method === "getTransaction") {
      return transactions.find((item) => item.transaction.signatures[0] === params[0]) ?? null;
    }
    const options = params[1] as { limit: number; before?: string; until?: string };
    const newestFirst = [...transactions].reverse().map((item) => item.transaction.signatures[0]!);
    const from = options.before ? newestFirst.indexOf(options.before) + 1 : 0;
    const to = options.until && newestFirst.includes(options.until) ? newestFirst.indexOf(options.until) : newestFirst.length;
    return newestFirst.slice(from, to).slice(0, options.limit).map((signature) => ({ signature }));
  };
  return { rpc, calls };
}

// Every statement crosses into the Workers runtime; a loaded machine must not turn that into a failure.
vi.setConfig({ testTimeout: 120_000 });

const wrangler = readFileSync(new URL("services/worker/wrangler.toml", root), "utf8");
const setting = (pattern: RegExp) => pattern.exec(wrangler)![1]!;

let mf: Miniflare;
let db: D1Like;
let outbound: { url: string; method: string }[] = [];
// The cluster the Worker sees. By default: Devnet, with no protocol yet.
type Cluster = (method: string, params: unknown[]) => unknown;
const emptyCluster: Cluster = (method) => method === "getGenesisHash" ? SOLANA_DEVNET_GENESIS_HASH
  : method === "getSignaturesForAddress" ? [] : { context: { slot: 1 }, value: null };
let answer: Cluster = emptyCluster;
let output = "";

/** The Worker as it deploys, with these bindings over the test's own. */
function workerOptions(bindings: Record<string, string>) {
  const directory = fileURLToPath(new URL("dist/worker/", root));
  return {
    modules: [
      { type: "ESModule", path: `${directory}worker.js` },
      { type: "CompiledWasm", path: `${directory}zkube_core_bg.wasm` },
    ],
    modulesRoot: directory,
    // The deployment's own runtime settings and binding names.
    compatibilityDate: setting(/^compatibility_date = "(.+)"$/m),
    compatibilityFlags: JSON.parse(setting(/^compatibility_flags = (\[.+\])$/m)) as string[],
    d1Databases: { [setting(/\[\[d1_databases\]\]\nbinding = "(.+)"/)]: "zkube-arena-test" },
    bindings: {
      WEBHOOK_SECRET, [setting(/\[version_metadata\]\nbinding = "(.+)"/)]: { id: VERSION },
      SOLANA_DEVNET_RPC_URL: "https://rpc.invalid/", MAGICBLOCK_ROUTER_RPC: "https://router.invalid/",
      ZKUBE_KEEPER_PUBLIC_KEY: keeper.publicKey.toBase58(), ZKUBE_LAUNCH_DAY_ID: String(LAUNCH_DAY),
      KEEPER_SECRET_KEY: JSON.stringify([...keeper.secretKey]), ...bindings,
    },
    // Every request the Worker makes lands here: nothing leaves the machine.
    outboundService: async (request: Request) => {
      const body = await request.json() as { method: string; id: unknown; params: unknown[] };
      outbound.push({ url: request.url, method: body.method });
      return Response.json({ jsonrpc: "2.0", id: body.id, result: answer(body.method, body.params) });
    },
    handleRuntimeStdio: (stdout: NodeJS.ReadableStream, stderr: NodeJS.ReadableStream) => {
      stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    },
  };
}

beforeAll(async () => {
  execFileSync(process.execPath, [fileURLToPath(new URL("tools/build-worker.mjs", root))], { stdio: "pipe" });
  mf = new Miniflare(workerOptions({}));
  db = await mf.getD1Database("DB") as unknown as D1Like;
  const schema = readFileSync(new URL("services/worker/schema.sql", root), "utf8")
    .split("\n").filter((line) => !line.startsWith("--")).join("\n");
  for (const statement of schema.split(";").map((item) => item.trim()).filter(Boolean)) await db.prepare(statement).run();
}, 60_000);

beforeEach(async () => {
  for (const table of tables) await db.prepare(`DELETE FROM ${table}`).run();
  await db.prepare("UPDATE sync SET tip = NULL, gap_before = NULL, gap_tip = NULL, caught_up_at = 0 WHERE id = 1").run();
  outbound = []; output = ""; answer = emptyCluster;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await mf.dispose(); });

const ingest = async (transactions: ReturnType<typeof confirmed>[]) => {
  for (const item of transactions) await ingestTransaction(db, parseTransaction(item));
};
const dump = async (names = tables) => Object.fromEntries(await Promise.all(names.map(async (table) =>
  [table, (await db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all()).results])));
const get = (path: string, init?: RequestInit) => mf.dispatchFetch(`https://arena.invalid${path}`, init as never);

describe("read model", () => {
  it("indexer_records_every_scored_run_and_ranks_each_wallets_best_on_both_boards", async () => {
    await ingest(history());
    const [owner, validator, device] = [0, 1, 2].map((index) => fixtures.scored[index].player as string);
    const score = await standings(db, DAY, "score", 0, 10);
    expect(score.rows.map(({ rank, owner: wallet, metric }) => [rank, wallet, metric]))
      .toEqual([[1, validator, "90"], [2, owner, "75"], [3, device, "40"]]);
    expect(score.total).toBe(3);
    // A zero metric earns no place: the validator's Classic-like run is absent from Theme.
    const theme = await standings(db, DAY, "theme", 0, 10);
    expect(theme.rows.map(({ rank, owner: wallet, metric }) => [rank, wallet, metric]))
      .toEqual([[1, device, "9"], [2, owner, "3"]]);
    expect(await rankOf(db, DAY, "theme", validator)).toBeNull();
    expect(await rankOf(db, DAY, "score", device)).toMatchObject({ total: 3, row: { rank: 3, metric: "40" } });
    expect((await standings(db, DAY, "score", 2, 10)).rows.map(({ rank }) => rank)).toEqual([3]);
    // Every run is kept, with a run ID beyond 53 bits intact.
    expect((await db.prepare("SELECT run_id FROM results ORDER BY slot, run_id").all<{ run_id: string }>()).results
      .map(({ run_id }) => run_id)).toEqual(fixtures.scored.map((row: { runId: string }) => row.runId)
      .sort((left: string, right: string) => fixtures.scored.findIndex((row: { runId: string }) => row.runId === left) -
        fixtures.scored.findIndex((row: { runId: string }) => row.runId === right)));
  });

  it("indexer_ranks_agree_with_the_core_board_order", async () => {
    // The helper writes the same bytes the Rust program logs.
    for (const row of fixtures.scored) expect(scoredLog({ dayId: row.dayId, runId: BigInt(row.runId),
      player: new PublicKey(row.player), score: row.score, objectiveTotal: BigInt(row.objectiveTotal),
      finalizedAt: row.finalizedAt, replayHash: 7 })).toBe(row.log);
    let seed = 7;
    const random = (limit: number) => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed % limit; };
    const wallets = Array.from({ length: 40 }, (_, index) => new PublicKey(Uint8Array.from({ length: 32 }, (_, byte) =>
      byte === 0 ? random(256) : (index * 7 + byte) % 256)));
    const rows = Array.from({ length: 120 }, (_, runId) => ({
      player: wallets[random(wallets.length)]!, runId,
      // Few distinct values, so ties on metric and on time are common.
      score: random(4) === 0 ? 0 : 100 + random(3), objectiveTotal: random(3) === 0 ? 0n : 0xffff_ffff_ffff_fff0n + BigInt(random(3)),
      finalizedAt: NOW + random(4),
    }));
    await ingest(rows.map((row, index) => confirmed(fixtures.consume, `run-${index}`, NOW + 500 + index,
      [scoredLog({ ...row, dayId: DAY, runId: BigInt(row.runId), replayHash: 1 })])));
    for (const kind of ["score", "theme"] as const) {
      const metric = (row: typeof rows[number]) => kind === "score" ? BigInt(row.score) : row.objectiveTotal;
      const order = (left: typeof rows[number], right: typeof rows[number]) => compareBoardEntries(
        metric(left), left.finalizedAt, left.player.toBytes(), metric(right), right.finalizedAt, right.player.toBytes());
      const best = new Map<string, typeof rows[number]>();
      for (const row of rows.filter((item) => metric(item) > 0n)) {
        const held = best.get(row.player.toBase58());
        if (!held || order(row, held) < 0) best.set(row.player.toBase58(), row);
      }
      const expected = [...best.values()].sort(order);
      const page = await standings(db, DAY, kind, 0, 100);
      expect(page.total).toBe(expected.length);
      expect(page.rows.map((row) => [row.owner, row.metric, row.finalizedAt]))
        .toEqual(expected.map((row) => [row.player.toBase58(), metric(row).toString(), row.finalizedAt]));
    }
  });

  it("a_result_counts_only_when_the_zkube_program_logged_it", async () => {
    const other = Keypair.generate().publicKey.toBase58();
    const forged = scoredLog({ dayId: DAY, runId: 99n, player: Keypair.generate().publicKey, score: 4_000_000_000,
      objectiveTotal: 1n, finalizedAt: NOW, replayHash: 9 });
    const real = fixtures.scored[0].log as string;
    const run = (signature: string, logs: string[]) => ingest([confirmed(fixtures.consume, signature, NOW + 60, logs)]);
    // Another program in a zKube transaction, before it, after it, or called by it, logs the event's bytes.
    await run("beside", [`Program ${other} invoke [1]`, forged, `Program ${other} success`,
      `Program ${PROGRAM} invoke [1]`, `Program ${PROGRAM} success`, `Program ${other} invoke [1]`, forged, `Program ${other} failed: custom program error: 0x1`]);
    await run("inside", [`Program ${PROGRAM} invoke [1]`, `Program ${other} invoke [2]`, forged, `Program ${other} success`, `Program ${PROGRAM} success`]);
    expect((await dump(["results"])).results).toEqual([]);
    // A message a program writes is prefixed by the runtime and cannot pose as an invoke line; a
    // transaction whose log shows no zKube invocation for its zKube instruction is not readable.
    await expect(run("posed", [`Program ${other} invoke [1]`, `Program log: Program ${PROGRAM} invoke [1]`, forged,
      `Program ${other} success`])).rejects.toThrow("unreadable");
    expect((await dump(["results"])).results).toEqual([]);
    // zKube's own line counts, at any depth, and after a program it called has returned.
    await run("own", [`Program ${other} invoke [1]`, `Program ${PROGRAM} invoke [2]`, `Program ${other} invoke [3]`,
      `Program ${other} success`, real, `Program ${PROGRAM} success`, `Program ${other} success`]);
    expect((await dump(["results"])).results).toMatchObject([{ owner: fixtures.scored[0].player, run_id: fixtures.scored[0].runId }]);
  });

  it("ingesting_again_or_in_another_order_leaves_the_same_rows", async () => {
    await ingest(history());
    const first = await dump(MODEL);
    await ingest(history());
    expect(await dump(MODEL)).toEqual(first);
    for (const table of tables) await db.prepare(`DELETE FROM ${table}`).run();
    await ingest(history().reverse());
    expect(await dump(MODEL)).toEqual(first);
    // A failed transaction changed nothing on chain, so it records nothing.
    await ingest([confirmed(fixtures.consume, "failed", NOW + 70, [fixtures.scored[0].log.replace("AQAAAAAAIAC", "CQAAAAAAIAC")],
      { InstructionError: [0, "Custom"] })]);
    expect(await dump(MODEL)).toEqual(first);
  });

  it("discovery_hints_follow_entry_consume_and_close_and_are_withheld_until_the_model_is_complete", async () => {
    const all = history();
    // Without a completed catch-up the model cannot vouch for what it has not seen.
    await ingest(all.slice(0, 1));
    expect(await discoveryHints(db, NOW + 20, DAY)).toBeNull();
    await catchUp(db, cluster(all.slice(0, 1)).rpc, NOW + 20);
    const entered = await discoveryHints(db, NOW + 20, DAY);
    const names = (IDL.instructions as readonly { name: string; accounts: readonly { name: string }[] }[])
      .find((item) => item.name === "enter_arena")!.accounts.map((item) => item.name);
    const account = (name: string) => fixtures.entry.decodedInstructions.at(-1).accounts[names.indexOf(name)].address as string;
    expect(entered?.arenaPlayers.map(String)).toEqual([account("arena_player")]);
    expect(entered?.runOwners.map(String)).toEqual([account("owner_authority")]);
    // Stale: the last complete walk is too old to trust.
    expect(await discoveryHints(db, NOW + 20 + DISCOVERY_FRESH_SECONDS + 1, DAY)).toBeNull();
    // The run is consumed while its daily player account stays open until it closes.
    await catchUp(db, cluster(all.slice(0, 4)).rpc, NOW + 400);
    expect(await discoveryHints(db, NOW + 400, DAY)).toMatchObject({ arenaPlayers: [{}], runOwners: [] });
    await catchUp(db, cluster(all).rpc, NOW + 90_000);
    expect(await discoveryHints(db, NOW + 90_000, DAY)).toEqual({ arenaPlayers: [], runOwners: [] });
    // Days behind the keeper's window are not hinted at all.
    await db.prepare("UPDATE daily_players SET closed_slot = NULL").run();
    expect((await discoveryHints(db, NOW + 90_000, DAY))?.arenaPlayers).toHaveLength(1);
    expect((await discoveryHints(db, NOW + 90_000, DAY + 1))?.arenaPlayers).toEqual([]);
  });

  it("discovery_and_results_count_an_instruction_however_it_was_invoked", async () => {
    // Every lifecycle instruction is reached through another program: nothing is sent directly.
    const nested = history().map(viaCpi);
    for (const item of nested) {
      expect(item.transaction.message.instructions.some((call) =>
        item.transaction.message.accountKeys[call.programIdIndex] === PROGRAM)).toBe(false);
    }
    await catchUp(db, cluster(nested.slice(0, 1)).rpc, NOW + 20);
    const direct = await (async () => {
      const hints = await discoveryHints(db, NOW + 20, DAY);
      return { players: hints?.arenaPlayers.map(String), owners: hints?.runOwners.map(String) };
    })();
    expect(direct.players).toHaveLength(1);
    expect(direct.owners).toEqual([fixtures.scored[0].player]);
    await catchUp(db, cluster(nested).rpc, NOW + 90_000);
    const nestedRows = await dump(MODEL);
    expect(nestedRows.results).toHaveLength(4);
    expect(await discoveryHints(db, NOW + 90_000, DAY)).toEqual({ arenaPlayers: [], runOwners: [] });
    // Direct or nested, the same history leaves the same rows.
    for (const table of tables) await db.prepare(`DELETE FROM ${table}`).run();
    await ingest(history());
    const strip = (rows: Record<string, unknown>) => JSON.parse(JSON.stringify(rows)) as unknown;
    expect(strip(await dump(MODEL))).toEqual(strip(nestedRows));
  });

  it("an_instruction_counts_only_where_the_programs_own_log_shows_it_succeeded", async () => {
    const wrapper = Keypair.generate().publicKey.toBase58();
    const frames = (inner: string[]) => [`Program ${wrapper} invoke [1]`, ...inner, `Program ${wrapper} success`];
    const failed = [`Program ${PROGRAM} invoke [2]`, "Program log: AnchorError occurred. Error Code: InvalidPeriod.",
      `Program ${PROGRAM} failed: custom program error: 0x1788`];
    // A wrapper reports success after the zKube call inside it was rejected. The outer transaction
    // succeeded; the entry, the consume with its result, the finalization and the close did not.
    const rejected = [
      { ...viaCpi(confirmed(fixtures.entry, "caught-entry", NOW + 10)) },
      { ...viaCpi(confirmed(fixtures.consume, "caught-consume", NOW + 60)) },
      { ...viaCpi(confirmed(fixtures.finalize, "caught-finalize", NOW + 90_000)) },
      { ...viaCpi(confirmed(fixtures.closePlayer, "caught-close", NOW + 90_060)) },
    ];
    for (const item of rejected) {
      const before = item.meta.logMessages.slice(0, item.meta.logMessages.indexOf(`Program ${PROGRAM} invoke [2]`));
      item.meta.logMessages = [...before, ...failed.slice(0, 1), fixtures.scored[0].log, ...failed.slice(1),
        ...item.meta.logMessages.slice(-1)];
    }
    await ingest(rejected);
    expect(await dump(MODEL)).toEqual({ results: [], finalized_dailies: [], daily_players: [], runs: [] });
    expect((await dump(["transactions"])).transactions).toHaveLength(4);
    // A call that succeeded inside a caller that then failed changed nothing either.
    const undone = confirmed(fixtures.finalize, "undone", NOW + 90_100, [`Program ${wrapper} invoke [1]`,
      `Program ${wrapper} invoke [2]`, `Program ${PROGRAM} invoke [3]`, `Program ${PROGRAM} success`,
      `Program ${wrapper} failed: custom program error: 0x1`, `Program ${wrapper} success`]);
    await ingest([{ ...undone, ...viaCpiShape(undone) }]);
    expect((await dump(MODEL)).finalized_dailies).toEqual([]);
    // The same calls, succeeding, count; so the rule is the log's, not the instruction's position.
    await ingest([viaCpi(confirmed(fixtures.finalize, "real-finalize", NOW + 90_200))]);
    expect((await dump(MODEL)).finalized_dailies).toHaveLength(1);
    // A log that does not account for every zKube instruction (truncated, or stripped) is not read at all.
    for (const logs of [frames([`Program ${PROGRAM} invoke [2]`, "Log truncated"]), [], frames([])]) {
      const cut = viaCpi(confirmed(fixtures.entry, `cut-${logs.length}`, NOW + 20));
      cut.meta.logMessages = logs;
      await expect(ingest([cut])).rejects.toThrow("unreadable");
    }
    expect((await dump(MODEL)).daily_players).toEqual([]);
  });

  it("a_storage_failure_is_retried_and_never_recorded_as_an_unreadable_transaction", async () => {
    const all = history().slice(0, 2);
    // The database refuses one write, then recovers.
    let failures = 1;
    const flaky: D1Like = { prepare: (query) => db.prepare(query),
      batch: async (statements) => {
        if (failures > 0) { failures -= 1; throw new Error("D1_ERROR: storage is overloaded"); }
        return db.batch(statements);
      } };
    await expect(catchUp(flaky, cluster(all).rpc, NOW + 100)).rejects.toThrow("storage is overloaded");
    // Nothing was skipped: no marker, no advanced cursor, and the next walk reads the same transaction.
    expect((await dump(["transactions"])).transactions).toEqual([]);
    expect(await syncState(db)).toMatchObject({ tip: null, caughtUpAt: 0, unreadable: 0 });
    expect(await catchUp(flaky, cluster(all).rpc, NOW + 160)).toEqual({ ingested: 2, complete: true });
    expect((await dump(MODEL)).runs).toHaveLength(1);
    // A webhook delivery that meets the same failure is refused, so its sender delivers it again.
    failures = 1;
    const third = history().slice(2, 3);
    await expect(ingestTransaction(flaky, parseTransaction(third[0]))).rejects.toThrow("storage is overloaded");
    expect(await ingestTransaction(flaky, parseTransaction(third[0]))).toBe(true);

    // A transaction once kept as unreadable is replaced when a readable copy arrives: nothing
    // has to be deleted by hand.
    const entry = history()[0]!;
    const broken = { ...entry, transaction: { ...entry.transaction, signatures: ["once-broken"] },
      meta: { ...entry.meta, logMessages: [] as string[] } };
    for (const table of tables) await db.prepare(`DELETE FROM ${table}`).run();
    await db.prepare("UPDATE sync SET tip = NULL, gap_before = NULL, gap_tip = NULL, caught_up_at = 0 WHERE id = 1").run();
    await catchUp(db, cluster([broken]).rpc, NOW + 20);
    expect(await syncState(db)).toMatchObject({ unreadable: 1 });
    const readable = { ...broken, meta: entry.meta };
    const delivered = await get("/v1/webhook", { method: "POST", headers: { authorization: WEBHOOK_SECRET },
      body: JSON.stringify([readable]) });
    expect(await delivered.json()).toEqual({ ingested: 1 });
    expect(await syncState(db)).toMatchObject({ unreadable: 0 });
    expect((await dump(MODEL)).daily_players).toHaveLength(1);
    expect((await dump(["transactions"])).transactions).toEqual([{ signature: "once-broken", slot: readable.slot, unreadable: 0 }]);
  });

  it("a_finalization_however_late_is_recorded_and_one_unreadable_transaction_never_stops_the_walk", async () => {
    const all = history();
    // The Daily's last run resolves a hundred days on: its finalization is as valid then as on the day.
    const late = confirmed(fixtures.finalize, "late-finalize", NOW + 100 * 86_400);
    // A transaction of the program this model cannot interpret: an entry naming too few accounts.
    const broken = confirmed(fixtures.entry, "broken", NOW + 100 * 86_400 + 60);
    const entry = broken.transaction.message.instructions.find((call) =>
      broken.transaction.message.accountKeys[call.programIdIndex] === PROGRAM)!;
    entry.accounts = entry.accounts.slice(0, 2);
    const after = confirmed(fixtures.consume, "after", NOW + 100 * 86_400 + 120, [fixtures.scored[1].log]);
    const { rpc, calls } = cluster([...all.slice(0, 4), late, broken, after]);
    expect(await catchUp(db, rpc, NOW + 100 * 86_400 + 180)).toEqual({ ingested: 6, complete: true });
    expect((await get(`/v1/days/${DAY}/boards/score`).then((response) => response.json()) as { final: boolean }).final).toBe(true);
    // The walk went past it, kept it, and the model says it is not complete.
    expect((await db.prepare("SELECT signature FROM transactions WHERE unreadable = 1").all()).results).toEqual([{ signature: "broken" }]);
    expect((await db.prepare("SELECT run_id FROM results WHERE signature = 'after'").all()).results).toHaveLength(1);
    expect(await syncState(db)).toMatchObject({ tip: "after", gapBefore: null, unreadable: 1 });
    expect(await (await get("/v1/health")).json()).toMatchObject({ complete: false, unreadable: 1 });
    expect(await discoveryHints(db, NOW + 100 * 86_400 + 180, DAY + 100)).toBeNull();
    expect((await get(`/v1/days/${DAY}/boards/score`).then((response) => response.json()) as { complete: boolean }).complete).toBe(false);
    // It is not fetched again, and a delivery of it by webhook is left to the walk as well.
    calls.length = 0;
    expect(await catchUp(db, rpc, NOW + 100 * 86_400 + 240)).toEqual({ ingested: 0, complete: true });
    expect(calls).toEqual(["getSignaturesForAddress"]);
    const delivered = await get("/v1/webhook", { method: "POST", headers: { authorization: WEBHOOK_SECRET },
      body: JSON.stringify([{ ...broken, transaction: { ...broken.transaction, signatures: ["broken-again"] } }]) });
    expect(await delivered.json()).toEqual({ ingested: 0 });
    expect(await (await get("/v1/health")).json()).toMatchObject({ complete: false, unreadable: 1 });
  });

  it("catch_up_walks_bounded_pages_and_reports_itself_incomplete_until_the_gap_closes", async () => {
    const backlog = Array.from({ length: CATCH_UP_PAGE * CATCH_UP_PAGES_PER_RUN + 30 }, (_, index) =>
      confirmed(fixtures.finalize, `old-${index}`, NOW + 86_400 + index));
    const { rpc, calls } = cluster(backlog);
    expect(await catchUp(db, rpc, NOW)).toEqual({ ingested: CATCH_UP_PAGE * CATCH_UP_PAGES_PER_RUN, complete: false });
    expect(calls.filter((method) => method === "getSignaturesForAddress")).toHaveLength(CATCH_UP_PAGES_PER_RUN);
    expect((await syncState(db)).gapBefore).not.toBeNull();
    expect(await discoveryHints(db, NOW, DAY)).toBeNull();
    expect(await (await get("/v1/health")).json()).toEqual({ complete: false, caughtUpAt: 0, unreadable: 0 });
    expect(await catchUp(db, rpc, NOW + 60)).toEqual({ ingested: 30, complete: true });
    expect(await syncState(db)).toEqual({ tip: `old-${backlog.length - 1}`, gapBefore: null, gapTip: null, caughtUpAt: NOW + 60, unreadable: 0 });
    // Caught up: one page, nothing to fetch, and new transactions extend the tip.
    calls.length = 0;
    expect(await catchUp(db, rpc, NOW + 120)).toEqual({ ingested: 0, complete: true });
    expect(calls).toEqual(["getSignaturesForAddress"]);
    backlog.push(confirmed(fixtures.entry, "new", NOW + 90_000));
    expect(await catchUp(db, rpc, NOW + 180)).toEqual({ ingested: 1, complete: true });
    expect((await syncState(db)).tip).toBe("new");
    // A transaction the webhook already delivered is not fetched again.
    backlog.push(confirmed(fixtures.entry, "delivered", NOW + 90_010));
    await ingest(backlog.slice(-1));
    calls.length = 0;
    await catchUp(db, rpc, NOW + 240);
    expect(calls).toEqual(["getSignaturesForAddress"]);
    await expect(catchUp(db, async () => [{ signature: 7 }], NOW)).rejects.toThrow("malformed");
  });
});

describe("public surface", () => {
  it("public_reads_serve_full_standings_and_any_wallets_rank_without_claiming_authority", async () => {
    await ingest(history());
    const device = fixtures.scored[2].player as string;
    const board = await (await get(`/v1/days/${DAY}/boards/score?limit=2`)).json() as Record<string, unknown>;
    expect(board).toMatchObject({ dayId: DAY, kind: "score", final: true, complete: false, authority: "none", total: 3, offset: 0 });
    expect((board.rows as unknown[]).length).toBe(2);
    const mine = await (await get(`/v1/days/${DAY}/boards/score/players/${device}`)).json() as { row: Record<string, unknown> };
    // Below the board's retained rows nobody is paid; above them only the chain says.
    expect(mine.row).toEqual({ rank: 3, owner: device, metric: "40", finalizedAt: fixtures.scored[2].finalizedAt, paying: null });
    expect(ARENA_BOARD_CAPACITY).toBeGreaterThan(3);
    expect((await get(`/v1/days/${DAY}/boards/theme/players/${fixtures.scored[1].player}`)).status).toBe(404);
    expect(await (await get(`/v1/days/${DAY + 1}/boards/score`)).json()).toMatchObject({ final: false, total: 0, rows: [] });
    for (const path of ["/", "/v1/days/x/boards/score", `/v1/days/${DAY}/boards/other`, "/v1/days/99999999999/boards/score",
      `/v1/days/${DAY}/boards/score/players`, "/v1/keeper", "/v1/webhook"]) expect((await get(path)).status).toBe(404);
    for (const path of [`/v1/days/${DAY}/boards/score?limit=0`, `/v1/days/${DAY}/boards/score?limit=101`,
      `/v1/days/${DAY}/boards/score?offset=-1`, `/v1/days/${DAY}/boards/score/players/not-a-wallet`]) {
      expect((await get(path)).status, path).toBe(400);
    }
  });

  it("the_webhook_needs_its_secret_and_only_adds_what_catch_up_would", async () => {
    const body = JSON.stringify(history());
    for (const authorization of [undefined, "", "wrong", WEBHOOK_SECRET + "x", WEBHOOK_SECRET.slice(0, -1)]) {
      const response = await get("/v1/webhook", { method: "POST", body, ...(authorization === undefined ? {} : { headers: { authorization } }) });
      expect(response.status).toBe(401);
    }
    expect((await dump()).transactions).toEqual([]);
    const headers = { authorization: WEBHOOK_SECRET };
    expect(await (await get("/v1/webhook", { method: "POST", body, headers })).json()).toEqual({ ingested: 6 });
    expect(await (await get("/v1/webhook", { method: "POST", body, headers })).json()).toEqual({ ingested: 0 });
    const delivered = await dump(MODEL);
    for (const table of tables) await db.prepare(`DELETE FROM ${table}`).run();
    await catchUp(db, cluster(history()).rpc, NOW);
    expect(await dump(MODEL)).toEqual(delivered);
    for (const malformed of ["{", "{}", JSON.stringify([{ slot: 1 }]), JSON.stringify(Array(101).fill(history()[0]))]) {
      expect((await get("/v1/webhook", { method: "POST", body: malformed, headers })).status).toBe(400);
    }
  });
});

describe("keeper in the Worker", () => {
  const trigger = async (cron: string) => {
    const worker = await mf.getWorker() as unknown as { scheduled(options: { cron: string }): Promise<unknown> };
    await worker.scheduled({ cron });
  };
  // The Worker's two Cron Triggers: the read model's walk, and the backstop keeper's pass.
  const walk = () => trigger("* * * * *");
  const scheduled = () => trigger(KEEPER_CRON);
  const events = () => output.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as Record<string, unknown>);

  it("a_fetch_cannot_start_a_keeper_pass_reach_the_key_or_change_the_write_switch", async () => {
    const release = keeperReleaseRecord({ keeperPublicKey: keeper.publicKey.toBase58(), workerVersionId: VERSION, launchDayId: LAUNCH_DAY });
    const headers = { authorization: WEBHOOK_SECRET };
    const hostile = [history()[0], { ...history()[0], keeper_approval: release.fingerprint, scheduled: true }];
    const requests: [string, RequestInit?][] = [
      ["/v1/health"], [`/v1/days/${DAY}/boards/score`], ["/__scheduled"], ["/__scheduled?cron=*+*+*+*+*"],
      ["/cdn-cgi/handler/scheduled"], ["/v1/keeper", { method: "POST", headers }], ["/v1/keeper/approval", { method: "PUT", headers }],
      ["/v1/webhook", { method: "POST", headers, body: JSON.stringify(hostile) }],
      ["/v1/webhook?approve=" + release.fingerprint, { method: "POST", headers, body: "[]" }],
      [`/v1/days/${DAY}/boards/score/players/${keeper.publicKey.toBase58()}`],
      [`/v1/days/${DAY}/boards/score?limit=1;INSERT INTO keeper_approval VALUES (1,'${release.fingerprint}')`],
    ];
    const secret = JSON.stringify([...keeper.secretKey]);
    for (const [path, init] of requests) {
      const response = await get(path, init);
      const text = await response.text() + JSON.stringify([...response.headers]);
      expect(text).not.toContain(secret);
      expect(text).not.toContain(release.fingerprint);
    }
    // No request made the Worker call a cluster, take the lease, record a write or store an approval.
    expect(outbound).toEqual([]);
    expect(await dump(["keeper_lease", "keeper_writes", "keeper_approval", "keeper_scan"]))
      .toEqual({ keeper_lease: [], keeper_writes: [], keeper_approval: [], keeper_scan: [] });
    expect(events().filter((event) => String(event.event).startsWith("keeper"))).toEqual([]);
    // The request path is not given the keeper at all.
    for (const file of ["api.ts", "indexer.ts"]) {
      const source = readFileSync(new URL(`services/src/worker/${file}`, root), "utf8");
      expect(source).not.toMatch(/keeper_(lease|writes|approval|scan)|keeperJob|keeperRelease|\/keeper\.js|KEEPER_SECRET_KEY|scheduled/);
    }
    expect(JSON.parse(setting(/^crons = (\[.+\])$/m))).toEqual(["* * * * *", KEEPER_CRON]);
    expect(wrangler).not.toMatch(/KEEPER_SECRET_KEY\s*=|WEBHOOK_SECRET\s*=|SOLANA_DEVNET_RPC_URL\s*=/);
    // The Cron Triggers are the one way in: the same Worker now reads the chain and reports its release.
    await walk();
    expect(outbound.map(({ method }) => method)).toEqual(["getGenesisHash", "getSignaturesForAddress"]);
    expect(events().filter((event) => String(event.event).startsWith("keeper"))).toEqual([]);
    outbound = [];
    await scheduled();
    expect(outbound.map(({ method }) => method)).toEqual(["getGenesisHash", "getAccountInfo"]);
    expect(events().find((event) => event.event === "keeper_worker")).toEqual({ schemaVersion: 1, event: "keeper_worker",
      outcome: "bootstrap_pending", fingerprint: release.fingerprint, writeEnabled: false });
    expect((await dump(["keeper_lease"])).keeper_lease).toEqual([]);
    expect(output).not.toContain(secret);
  });

  it("keeps writes fail-closed unless explicitly enabled", async () => {
    const input = { keeperPublicKey: keeper.publicKey.toBase58(), workerVersionId: VERSION, launchDayId: LAUNCH_DAY };
    const release = keeperReleaseRecord(input);
    const approve = (fingerprint: string) =>
      db.prepare("INSERT OR REPLACE INTO keeper_approval (id, fingerprint) VALUES (1, ?)").bind(fingerprint).run();
    expect(await keeperWritesApproved(db, release.fingerprint)).toBe(false);
    for (const wrong of ["", "true", release.fingerprint.slice(1), release.fingerprint.toUpperCase()]) {
      await approve(wrong);
      expect(await keeperWritesApproved(db, release.fingerprint)).toBe(false);
    }
    await approve(release.fingerprint);
    expect(await keeperWritesApproved(db, release.fingerprint)).toBe(true);
    // The approval names one release: a new deployment, key or launch day plans only.
    for (const changed of [{ ...input, workerVersionId: VERSION.replace("0b8a", "0b8b") },
      { ...input, keeperPublicKey: Keypair.generate().publicKey.toBase58() }, { ...input, launchDayId: LAUNCH_DAY + 1 }]) {
      expect(await keeperWritesApproved(db, keeperReleaseRecord(changed).fingerprint)).toBe(false);
    }
    // The running Worker reads the same switch, and reports an unidentified deployment as a failed pass.
    await scheduled();
    expect(events().find((event) => event.event === "keeper_worker")).toMatchObject({ writeEnabled: true, fingerprint: release.fingerprint });
    await db.prepare("DELETE FROM keeper_approval").run();
    output = "";
    await scheduled();
    expect(events().find((event) => event.event === "keeper_worker")).toMatchObject({ writeEnabled: false });
  });

  it("the_scheduled_pass_simulates_reserves_relays_and_settles_a_write_inside_the_worker", async () => {
    // Launch day prepared, then a suspension: the day it ends is the one Daily anyone can prepare,
    // and nobody has yet. One plan: prepare_arena_daily.
    const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL as unknown as Idl));
    const decode = (name: string, row: { data: string }) => coder.decode(name, Buffer.from(row.data, "base64"));
    const protocol = decode("protocolConfig", programFixtures.plans.accounts.protocol);
    protocol.launchDayId = LAUNCH_DAY; protocol.lastPreparedDay = LAUNCH_DAY; protocol.lastDailyId = 0;
    protocol.suspendedUntilDay = LAUNCH_DAY + 3;
    const daily = decode("arenaDaily", programFixtures.plans.accounts.daily);
    daily.dayId = LAUNCH_DAY; daily.predecessorDay = 0;
    const account = (data: Buffer, owner = ZKUBE_PROGRAM_ID, lamports = 1_000_000_000) => ({
      data: [data.toString("base64"), "base64"], executable: false, lamports, owner: owner.toBase58(), rentEpoch: 0, space: data.length });
    const accounts = new Map([
      [protocolPda().toBase58(), account(await coder.encode("protocolConfig", protocol))],
      [arenaDailyPda(LAUNCH_DAY).toBase58(), account(await coder.encode("arenaDaily", daily))],
    ]);
    const system = new PublicKey(new Uint8Array(32));
    const balances = new Map([[keeper.publicKey.toBase58(), 1_000_000_000], [cadenceFundingPda().toBase58(), 5_000_000_000]]);
    const value = (result: unknown) => ({ context: { slot: 9 }, value: result });
    let relayed: VersionedTransaction | undefined;
    answer = (method, params) => {
      switch (method) {
        case "getGenesisHash": return SOLANA_DEVNET_GENESIS_HASH;
        case "getSignaturesForAddress": return [];
        case "getAccountInfo": return value(accounts.get(params[0] as string) ?? null);
        case "getMultipleAccounts": return value((params[0] as string[]).map((address) => accounts.get(address) ?? null));
        case "getProgramAccounts": return [];
        case "getBalance": return value(balances.get(params[0] as string) ?? 0);
        case "getLatestBlockhash": return value({ blockhash: keeper.publicKey.toBase58(), lastValidBlockHeight: 500 });
        case "getFeeForMessage": return value(5_000);
        case "simulateTransaction": return value({ err: null, logs: [], unitsConsumed: 60_000, returnData: null, accounts: [
          account(Buffer.alloc(0), system, 1_000_000_000 - 5_000), account(Buffer.alloc(0), system, 5_000_000_000 - 4_000_000)] });
        case "sendTransaction":
          relayed = VersionedTransaction.deserialize(Buffer.from(params[0] as string, "base64"));
          return utils.bytes.bs58.encode(relayed.signatures[0]!);
        case "getBlockHeight": return 400;
        case "getSignatureStatuses": return value([{ slot: 9, confirmations: 1, err: null, confirmationStatus: "confirmed" }]);
        default: throw new Error(`unexpected RPC ${method}`);
      }
    };
    const release = keeperReleaseRecord({ keeperPublicKey: keeper.publicKey.toBase58(), workerVersionId: VERSION, launchDayId: LAUNCH_DAY });
    const writes = () => db.prepare(`SELECT operation, reserved_lamports, payer_lamports, signature, endpoint,
      last_valid_block_height, state FROM keeper_writes`).all();

    // Unapproved, the same pass only plans: no signature, no simulation, no relay, no ledger row.
    await scheduled();
    expect(events().filter((event) => event.event === "keeper_plan")).toMatchObject([{ operation: "prepare_arena_daily", writeEnabled: false }]);
    expect(outbound.map(({ method }) => method)).not.toContain("simulateTransaction");
    expect(relayed).toBeUndefined();
    expect((await writes()).results).toEqual([]);
    // No scan has been recorded yet, so this pass scanned the chain and said so.
    expect(events().find((event) => event.event === "keeper_worker")).toMatchObject({ discovery: "scan" });
    expect(outbound.map(({ method }) => method)).toContain("getProgramAccounts");

    await db.prepare("INSERT INTO keeper_approval (id, fingerprint) VALUES (1, ?)").bind(release.fingerprint).run();
    await walk();
    outbound = []; output = "";
    await scheduled();
    expect(events().find((event) => event.event === "keeper_operation")).toMatchObject({ operation: "prepare_arena_daily", ok: true, writes: 1 });
    expect(events().find((event) => event.event === "keeper_worker")).toMatchObject({ outcome: "pass_complete", writeEnabled: true, discovery: "read_model" });
    // Two simulations precede the one relay, and the relayed bytes carry the keeper's own valid signature.
    const order = outbound.map(({ method }) => method).filter((method) => ["simulateTransaction", "sendTransaction", "getSignatureStatuses"].includes(method));
    expect(order).toEqual(["simulateTransaction", "simulateTransaction", "sendTransaction", "getSignatureStatuses"]);
    expect(relayed!.message.staticAccountKeys[0]!.equals(keeper.publicKey)).toBe(true);
    expect(utils.bytes.bs58.encode(relayed!.signatures[0]!)).not.toBe(utils.bytes.bs58.encode(Buffer.alloc(64)));
    // Fee, simulated payer spend and the rent taken from cadence funding are all reserved, then settled.
    expect((await writes()).results).toEqual([{ operation: "prepare_arena_daily", reserved_lamports: 5_000 + 5_000 + 4_000_000,
      payer_lamports: 5_000 + 5_000, signature: utils.bytes.bs58.encode(relayed!.signatures[0]!), endpoint: "base",
      last_valid_block_height: 500, state: "confirmed" }]);
    expect(outbound.map(({ method }) => method)).not.toContain("getProgramAccounts");
    // An hour after the last scan the keeper scans again, whatever the read model says.
    await db.prepare("UPDATE keeper_scan SET scanned_at = scanned_at - ?").bind(KEEPER_SCAN_SECONDS).run();
    expect(await keeperScanDue(db, Math.floor(Date.now() / 1_000))).toBe(true);
    outbound = []; output = "";
    await scheduled();
    expect(events().find((event) => event.event === "keeper_worker")).toMatchObject({ discovery: "scan" });
    expect(outbound.map(({ method }) => method)).toContain("getProgramAccounts");
    expect(await keeperScanDue(db, Math.floor(Date.now() / 1_000))).toBe(false);
    expect((await dump(["keeper_lease"])).keeper_lease).toEqual([]);
    expect(output).not.toContain(JSON.stringify([...keeper.secretKey]));
  });

  it("a_malformed_credential_or_a_failing_endpoint_puts_no_secret_in_the_workers_log", async () => {
    const marker = "MARKER-7f3a9c";
    const malformed = `[${[...keeper.secretKey].slice(0, 40).join(",")},"${marker}"`;
    const rpc = `https://rpc.invalid/v2/${marker}-path?api-key=${marker}-query`;
    await mf.setOptions(workerOptions({ KEEPER_SECRET_KEY: malformed, SOLANA_DEVNET_RPC_URL: rpc }));
    try {
      db = await mf.getD1Database("DB") as unknown as D1Like;
      const release = keeperReleaseRecord({ keeperPublicKey: keeper.publicKey.toBase58(), workerVersionId: VERSION, launchDayId: LAUNCH_DAY });
      await db.prepare("INSERT OR REPLACE INTO keeper_approval (id, fingerprint) VALUES (1, ?)").bind(release.fingerprint).run();
      // A protocol exists, so the approved pass goes on to load its key; and the cluster then fails
      // with an error that quotes the endpoint it was asked on.
      const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL as unknown as Idl));
      const protocol = coder.decode("protocolConfig", Buffer.from(programFixtures.plans.accounts.protocol.data, "base64"));
      protocol.launchDayId = LAUNCH_DAY; protocol.lastPreparedDay = LAUNCH_DAY + 1;
      const data = await coder.encode("protocolConfig", protocol);
      answer = (method, params) => method === "getGenesisHash" ? SOLANA_DEVNET_GENESIS_HASH
        : method === "getSignaturesForAddress" ? (() => { throw new Error(`upstream ${rpc} refused`); })()
        : method === "getAccountInfo" && params[0] === protocolPda().toBase58()
          ? { context: { slot: 1 }, value: { data: [data.toString("base64"), "base64"], executable: false, lamports: 1,
            owner: PROGRAM, rentEpoch: 0, space: data.length } }
        : method === "getProgramAccounts" ? [] : method === "getMultipleAccounts"
          ? { context: { slot: 1 }, value: (params[0] as string[]).map(() => null) } : { context: { slot: 1 }, value: 1_000_000_000 };
      await walk();
      await scheduled();
      expect(events().find((event) => event.event === "keeper_worker")).toMatchObject({ outcome: "pass_failed",
        error: "KEEPER_SECRET_KEY must be a 64-byte JSON array" });
      expect(events().find((event) => event.event === "indexer_catch_up")).toMatchObject({ ok: false });
      expect(output).not.toContain(marker);
      for (let start = 0; start + 12 <= malformed.length; start += 6) expect(output).not.toContain(malformed.slice(start, start + 12));
    } finally {
      await mf.setOptions(workerOptions({}));
      db = await mf.getD1Database("DB") as unknown as D1Like;
    }
  });

  it("keeper_lease_admits_one_pass_at_a_time_and_only_a_dead_pass_loses_it", async () => {
    expect(await acquireKeeperLease(db, "first", NOW)).toBe(true);
    expect(await acquireKeeperLease(db, "second", NOW + KEEPER_LEASE_SECONDS - 1)).toBe(false);
    // A pass that holds the lease stops the Worker's own scheduled pass before it reads the chain.
    await db.prepare("UPDATE keeper_lease SET expires_at = ?").bind(Math.floor(Date.now() / 1_000) + 600).run();
    await scheduled();
    expect(outbound).toEqual([]);
    expect(output).toContain('"outcome":"busy"');
    // Another cluster's history is never ingested.
    answer = (method) => method === "getGenesisHash" ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" : emptyCluster(method, []);
    outbound = []; output = "";
    await walk();
    expect(outbound.map(({ method }) => method)).toEqual(["getGenesisHash"]);
    expect(output).toContain("RPC genesis does not match Devnet");
    await db.prepare("UPDATE keeper_lease SET expires_at = ?").bind(NOW + KEEPER_LEASE_SECONDS).run();
    // Releasing someone else's lease does nothing; the holder's release frees it.
    await releaseKeeperLease(db, "second");
    expect(await acquireKeeperLease(db, "second", NOW + 1)).toBe(false);
    await releaseKeeperLease(db, "first");
    expect(await acquireKeeperLease(db, "second", NOW + 1)).toBe(true);
    expect(await acquireKeeperLease(db, "third", NOW + 1 + KEEPER_LEASE_SECONDS)).toBe(true);
    expect((await dump(["keeper_lease"])).keeper_lease).toMatchObject([{ holder: "third" }]);
  });

  it("keeper_ledger_reserves_before_relay_and_an_unsettled_write_counts_until_its_outcome_is_definite", async () => {
    vi.spyOn(VersionedTransaction.prototype, "sign").mockImplementation(() => undefined);
    const order: string[] = [];
    const writes = () => db.prepare(`SELECT pass, operation, reserved_lamports, payer_lamports, endpoint,
      last_valid_block_height, state, created_at FROM keeper_writes ORDER BY id`).all<Record<string, unknown>>();
    const confirmedStatus = { value: [{ err: null, confirmationStatus: "confirmed" }] };
    let balance = 1_000_000_000, payerSpend = 6_000_000, clock = NOW;
    const connection = {
      getBalance: vi.fn(async () => balance),
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: keeper.publicKey.toBase58(), lastValidBlockHeight: 500 }),
      getFeeForMessage: vi.fn().mockResolvedValue({ value: 5_000 }),
      simulateTransaction: vi.fn(async () => { order.push("simulate");
        return { value: { err: null, unitsConsumed: 40_000, accounts: [{ lamports: balance - payerSpend }] } }; }),
      sendRawTransaction: vi.fn(async () => {
        // The reservation is durable before the bytes leave.
        order.push(`send:${(await writes()).results.at(-1)!.state as string}`);
        return "signature";
      }),
      getSignatureStatuses: vi.fn(async (): Promise<unknown> => confirmedStatus),
      getBlockHeight: vi.fn(async () => 400),
    };
    const pass = (traceId: string, log?: (event: unknown) => void) => runKeeperPass({
      connection: connection as unknown as Connection, keeper, writeEnabled: true, now: () => NOW * 1_000,
      traceId, ledger: keeperLedger(db, traceId, () => clock), wait: async () => undefined, ...(log ? { log } : {}),
      protocolSnapshot: { paused: true, launchDayId: DAY, suspendedUntilDay: 0, lastPreparedDay: DAY + 1, dailies: [], runs: [],
        closedArenaPlayers: [{ dayId: DAY - 1, owner: Keypair.generate().publicKey, rentPayer: keeper.publicKey }] },
      protocolMaterializer: { materialize: async () => [new TransactionInstruction({
        programId: ZKUBE_PROGRAM_ID, keys: [], data: Buffer.alloc(8) })] },
    });
    const refusal = async (traceId: string) => {
      const log = vi.fn(), sent = connection.sendRawTransaction.mock.calls.length;
      expect(await pass(traceId, log)).toMatchObject({ writes: 0, operationFailures: 1 });
      expect(connection.sendRawTransaction).toHaveBeenCalledTimes(sent);
      return (log.mock.calls.map(([event]) => event as { error?: string }).find((event) => event.error))!.error;
    };
    const spend = 6_005_000;
    expect(await pass("confirmed")).toMatchObject({ writes: 1, spentLamports: spend });
    expect(order).toEqual(["simulate", "simulate", "send:reserved"]);
    // A write that landed and failed is settled; one whose outcome never arrived stays reserved,
    // stamped when it was made rather than when its pass began.
    connection.getSignatureStatuses.mockResolvedValueOnce({ value: [{ err: { InstructionError: [1, "Custom"] }, confirmationStatus: "confirmed" }] });
    expect(await pass("failed")).toMatchObject({ writes: 0, operationFailures: 1 });
    clock = NOW + 777;
    connection.getSignatureStatuses.mockRejectedValueOnce(new Error("timeout"));
    expect(await pass("uncertain")).toMatchObject({ writes: 0, operationFailures: 1, spentLamports: spend });
    expect((await writes()).results).toEqual([
      { pass: "confirmed", operation: "close_arena_player", reserved_lamports: spend, payer_lamports: spend, endpoint: "base",
        last_valid_block_height: 500, state: "confirmed", created_at: NOW },
      { pass: "failed", operation: "close_arena_player", reserved_lamports: spend, payer_lamports: spend, endpoint: "base",
        last_valid_block_height: 500, state: "failed", created_at: NOW },
      { pass: "uncertain", operation: "close_arena_player", reserved_lamports: spend, payer_lamports: spend, endpoint: "base",
        last_valid_block_height: 500, state: "reserved", created_at: NOW + 777 },
    ]);

    // A failure seen only by one node, not yet confirmed by the cluster, is no outcome: on the
    // confirmed chain the same signature can still land. It stays reserved and nothing more is relayed.
    const processedFailure = { value: [{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "processed" }] };
    connection.getSignatureStatuses.mockResolvedValue(processedFailure);
    expect(await refusal("processed-failure")).toBe("keeper spend ceiling reached");
    expect((await writes()).results.at(-1)).toMatchObject({ pass: "uncertain", state: "reserved" });

    // The cluster has no record of it and its blockhash may still be live: it counts against the
    // next pass's ceiling, and no amount of elapsed time changes that.
    expect(KEEPER_LIMITS.spendLamports - spend).toBeLessThan(spend);
    connection.getSignatureStatuses.mockResolvedValue({ value: [null] });
    for (const later of [NOW + 1, NOW + 151, NOW + 30 * 86_400]) {
      clock = later;
      expect(await refusal(`ceiling-${later}`)).toBe("keeper spend ceiling reached");
    }
    // It also counts against the wallet floor: a stale balance of 27m with 6m still out cannot
    // take another 3m, which the ceiling would allow but which would end below the 20m floor.
    balance = 27_000_000; payerSpend = 3_000_000;
    expect(KEEPER_LIMITS.spendLamports - spend).toBeGreaterThanOrEqual(payerSpend + 5_000);
    expect(balance - payerSpend).toBeGreaterThanOrEqual(KEEPER_LIMITS.reserveLamports);
    expect(await refusal("floor")).toBe("keeper simulation crosses the reserve floor");
    expect((await writes()).results.at(-1)).toMatchObject({ pass: "uncertain", state: "reserved" });

    // Finalized blocks pass the last one that could hold it and the cluster still has no record:
    // only then is it expired, and its spend released.
    connection.getBlockHeight.mockResolvedValue(500);
    expect(await refusal("still-live")).toBe("keeper simulation crosses the reserve floor");
    connection.getBlockHeight.mockResolvedValue(501);
    connection.getSignatureStatuses.mockResolvedValueOnce({ value: [null] }).mockResolvedValue(confirmedStatus);
    expect(await pass("after-expiry")).toMatchObject({ writes: 1 });
    expect((await writes()).results.map(({ pass: name, state }) => [name, state])).toEqual([["confirmed", "confirmed"],
      ["failed", "failed"], ["uncertain", "expired"], ["after-expiry", "confirmed"]]);

    // A write that did land is settled as confirmed by the next pass that asks, never expired,
    // even though its blockhash is past.
    balance = 1_000_000_000; payerSpend = 2_000_000;
    connection.getSignatureStatuses.mockRejectedValueOnce(new Error("timeout"));
    expect(await pass("landed-late")).toMatchObject({ writes: 0, operationFailures: 1 });
    expect((await writes()).results.at(-1)).toMatchObject({ pass: "landed-late", state: "reserved" });
    expect(await pass("reconciles")).toMatchObject({ writes: 1 });
    expect((await writes()).results.slice(-2).map(({ pass: name, state }) => [name, state]))
      .toEqual([["landed-late", "confirmed"], ["reconciles", "confirmed"]]);
  });

  it("a_failure_only_one_node_has_processed_does_not_settle_a_write", async () => {
    vi.spyOn(VersionedTransaction.prototype, "sign").mockImplementation(() => undefined);
    const connection = {
      getBalance: vi.fn(async () => 1_000_000_000),
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: keeper.publicKey.toBase58(), lastValidBlockHeight: 500 }),
      getFeeForMessage: vi.fn().mockResolvedValue({ value: 5_000 }),
      simulateTransaction: vi.fn(async () => ({ value: { err: null, unitsConsumed: 40_000, accounts: [{ lamports: 994_000_000 }] } })),
      sendRawTransaction: vi.fn(async () => "signature"),
      // Every poll of this pass sees the failure at processed only.
      getSignatureStatuses: vi.fn(async () => ({ value: [{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "processed" }] })),
      getBlockHeight: vi.fn(async () => 400),
    };
    const log = vi.fn();
    const result = await runKeeperPass({
      connection: connection as unknown as Connection, keeper, writeEnabled: true, now: () => NOW * 1_000, log,
      ledger: keeperLedger(db, "processed", () => NOW), wait: async () => undefined,
      protocolSnapshot: { paused: true, launchDayId: DAY, suspendedUntilDay: 0, lastPreparedDay: DAY + 1, dailies: [], runs: [],
        closedArenaPlayers: [1, 2].map(() => ({ dayId: DAY - 1, owner: Keypair.generate().publicKey, rentPayer: keeper.publicKey })) },
      protocolMaterializer: { materialize: async () => [new TransactionInstruction({
        programId: ZKUBE_PROGRAM_ID, keys: [], data: Buffer.alloc(8) })] },
    });
    // The first write is neither confirmed nor failed; its spend holds, so the second is not relayed.
    expect(result).toMatchObject({ writes: 0, operationFailures: 2 });
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.map(([event]) => (event as { error?: string }).error).filter(Boolean))
      .toEqual(["the write's outcome is unknown", "keeper spend ceiling reached"]);
    expect((await db.prepare("SELECT state FROM keeper_writes").all()).results).toEqual([{ state: "reserved" }]);
    // Once the cluster confirms the failure, it is settled as failed.
    connection.getSignatureStatuses.mockResolvedValue({ value: [{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }] });
    await runKeeperPass({ connection: connection as unknown as Connection, keeper, writeEnabled: true, now: () => NOW * 1_000,
      ledger: keeperLedger(db, "after", () => NOW), wait: async () => undefined,
      protocolSnapshot: { paused: true, launchDayId: DAY, suspendedUntilDay: 0, lastPreparedDay: DAY + 1, dailies: [], runs: [], closedArenaPlayers: [] },
      protocolMaterializer: { materialize: async () => [] } });
    expect((await db.prepare("SELECT state FROM keeper_writes").all()).results).toEqual([{ state: "failed" }]);
  });

  it("an_uncertain_write_holds_the_floor_for_the_rest_of_its_own_pass", async () => {
    vi.spyOn(VersionedTransaction.prototype, "sign").mockImplementation(() => undefined);
    // Two closes in one pass. The first is relayed and never answers; the balance the second
    // reads does not show it yet.
    const connection = {
      getBalance: vi.fn(async () => 27_000_000),
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: keeper.publicKey.toBase58(), lastValidBlockHeight: 500 }),
      getFeeForMessage: vi.fn().mockResolvedValue({ value: 5_000 }),
      simulateTransaction: vi.fn(async () => ({ value: { err: null, unitsConsumed: 40_000, accounts: [{ lamports: 23_000_000 }] } })),
      sendRawTransaction: vi.fn(async () => "signature"),
      getSignatureStatuses: vi.fn(async () => ({ value: [null] })),
      getBlockHeight: vi.fn(async () => 400),
    };
    const log = vi.fn();
    const result = await runKeeperPass({
      connection: connection as unknown as Connection, keeper, writeEnabled: true, now: () => NOW * 1_000, log,
      ledger: keeperLedger(db, "one-pass", () => NOW), wait: async () => undefined,
      protocolSnapshot: { paused: true, launchDayId: DAY, suspendedUntilDay: 0, lastPreparedDay: DAY + 1, dailies: [], runs: [],
        closedArenaPlayers: [1, 2].map(() => ({ dayId: DAY - 1, owner: Keypair.generate().publicKey, rentPayer: keeper.publicKey })) },
      protocolMaterializer: { materialize: async () => [new TransactionInstruction({
        programId: ZKUBE_PROGRAM_ID, keys: [], data: Buffer.alloc(8) })] },
    });
    expect(result).toMatchObject({ writes: 0, operationFailures: 2 });
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.map(([event]) => (event as { error?: string }).error).filter(Boolean))
      .toEqual(["the write's outcome is unknown", "keeper simulation crosses the reserve floor"]);
  });
});
