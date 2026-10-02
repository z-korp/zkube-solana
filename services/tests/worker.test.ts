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
  KEEPER_LEASE_SECONDS, KEEPER_UNSETTLED_SECONDS, acquireKeeperLease, keeperLedger, keeperWritesApproved,
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
const tables = ["transactions", "results", "finalized_days", "daily_players", "runs", "keeper_lease", "keeper_writes", "keeper_approval"];

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
    meta: { err, logMessages: logs.some((line) => line.includes(" invoke [")) ? logs
      : [`Program ${PROGRAM} invoke [1]`, "Program log: Instruction: ConsumeArenaRun", ...logs, `Program ${PROGRAM} success`],
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

beforeAll(async () => {
  execFileSync(process.execPath, [fileURLToPath(new URL("tools/build-worker.mjs", root))], { stdio: "pipe" });
  const directory = fileURLToPath(new URL("dist/worker/", root));
  mf = new Miniflare({
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
      KEEPER_SECRET_KEY: JSON.stringify([...keeper.secretKey]),
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
  });
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
    // A message a program writes is prefixed by the runtime and cannot pose as an invoke line.
    await run("posed", [`Program ${other} invoke [1]`, `Program log: Program ${PROGRAM} invoke [1]`, forged, `Program ${other} success`]);
    expect((await dump(["results"])).results).toEqual([]);
    // zKube's own line counts, at any depth, and after a program it called has returned.
    await run("own", [`Program ${other} invoke [1]`, `Program ${PROGRAM} invoke [2]`, `Program ${other} invoke [3]`,
      `Program ${other} success`, real, `Program ${PROGRAM} success`, `Program ${other} success`]);
    expect((await dump(["results"])).results).toMatchObject([{ owner: fixtures.scored[0].player, run_id: fixtures.scored[0].runId }]);
  });

  it("ingesting_again_or_in_another_order_leaves_the_same_rows", async () => {
    await ingest(history());
    const first = await dump(["results", "finalized_days", "daily_players", "runs"]);
    await ingest(history());
    expect(await dump(["results", "finalized_days", "daily_players", "runs"])).toEqual(first);
    for (const table of tables) await db.prepare(`DELETE FROM ${table}`).run();
    await ingest(history().reverse());
    expect(await dump(["results", "finalized_days", "daily_players", "runs"])).toEqual(first);
    // A failed transaction changed nothing on chain, so it records nothing.
    await ingest([confirmed(fixtures.consume, "failed", NOW + 70, [fixtures.scored[0].log.replace("AQAAAAAAIAC", "CQAAAAAAIAC")],
      { InstructionError: [0, "Custom"] })]);
    expect(await dump(["results", "finalized_days", "daily_players", "runs"])).toEqual(first);
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

  it("catch_up_walks_bounded_pages_and_reports_itself_incomplete_until_the_gap_closes", async () => {
    const backlog = Array.from({ length: CATCH_UP_PAGE * CATCH_UP_PAGES_PER_RUN + 30 }, (_, index) =>
      confirmed(fixtures.finalize, `old-${index}`, NOW + 86_400 + index));
    const { rpc, calls } = cluster(backlog);
    expect(await catchUp(db, rpc, NOW)).toEqual({ ingested: CATCH_UP_PAGE * CATCH_UP_PAGES_PER_RUN, complete: false });
    expect(calls.filter((method) => method === "getSignaturesForAddress")).toHaveLength(CATCH_UP_PAGES_PER_RUN);
    expect((await syncState(db)).gapBefore).not.toBeNull();
    expect(await discoveryHints(db, NOW, DAY)).toBeNull();
    expect(await (await get("/v1/health")).json()).toEqual({ complete: false, caughtUpAt: 0 });
    expect(await catchUp(db, rpc, NOW + 60)).toEqual({ ingested: 30, complete: true });
    expect(await syncState(db)).toEqual({ tip: `old-${backlog.length - 1}`, gapBefore: null, gapTip: null, caughtUpAt: NOW + 60 });
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
    const delivered = await dump(["results", "finalized_days", "daily_players", "runs"]);
    for (const table of tables) await db.prepare(`DELETE FROM ${table}`).run();
    await catchUp(db, cluster(history()).rpc, NOW);
    expect(await dump(["results", "finalized_days", "daily_players", "runs"])).toEqual(delivered);
    for (const malformed of ["{", "{}", JSON.stringify([{ slot: 1 }]), JSON.stringify(Array(101).fill(history()[0]))]) {
      expect((await get("/v1/webhook", { method: "POST", body: malformed, headers })).status).toBe(400);
    }
  });
});

describe("keeper in the Worker", () => {
  const scheduled = async () => {
    const worker = await mf.getWorker() as unknown as { scheduled(options: { cron: string }): Promise<unknown> };
    await worker.scheduled({ cron: "* * * * *" });
  };
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
    expect(await dump(["keeper_lease", "keeper_writes", "keeper_approval"]))
      .toEqual({ keeper_lease: [], keeper_writes: [], keeper_approval: [] });
    expect(events().filter((event) => String(event.event).startsWith("keeper"))).toEqual([]);
    // The request path is not given the keeper at all.
    for (const file of ["api.ts", "indexer.ts"]) {
      const source = readFileSync(new URL(`services/src/worker/${file}`, root), "utf8");
      expect(source).not.toMatch(/keeper_(lease|writes|approval)|keeperJob|keeperRelease|\/keeper\.js|KEEPER_SECRET_KEY|scheduled/);
    }
    expect(setting(/^crons = (\[.+\])$/m)).toBe('["* * * * *"]');
    expect(wrangler).not.toMatch(/KEEPER_SECRET_KEY\s*=|WEBHOOK_SECRET\s*=|SOLANA_DEVNET_RPC_URL\s*=/);
    // The Cron Trigger is the one way in: the same Worker now reads the chain and reports its release.
    await scheduled();
    expect(outbound.map(({ method }) => method)).toEqual(["getSignaturesForAddress", "getGenesisHash", "getAccountInfo"]);
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
    // Launch day, open and funded, with tomorrow not yet prepared: one plan, prepare_arena_daily.
    const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL as unknown as Idl));
    const decode = (name: string, row: { data: string }) => coder.decode(name, Buffer.from(row.data, "base64"));
    const protocol = decode("protocolConfig", programFixtures.plans.accounts.protocol);
    protocol.launchDayId = LAUNCH_DAY; protocol.lastPreparedDay = LAUNCH_DAY; protocol.lastDailyId = 0;
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
        case "getSignatureStatuses": return value([{ slot: 9, confirmations: 1, err: null, confirmationStatus: "confirmed" }]);
        default: throw new Error(`unexpected RPC ${method}`);
      }
    };
    const release = keeperReleaseRecord({ keeperPublicKey: keeper.publicKey.toBase58(), workerVersionId: VERSION, launchDayId: LAUNCH_DAY });
    const writes = () => db.prepare("SELECT operation, reserved_lamports, signature, state FROM keeper_writes").all();

    // Unapproved, the same pass only plans: no signature, no simulation, no relay, no ledger row.
    await scheduled();
    expect(events().filter((event) => event.event === "keeper_plan")).toMatchObject([{ operation: "prepare_arena_daily", writeEnabled: false }]);
    expect(outbound.map(({ method }) => method)).not.toContain("simulateTransaction");
    expect(relayed).toBeUndefined();
    expect((await writes()).results).toEqual([]);

    await db.prepare("INSERT INTO keeper_approval (id, fingerprint) VALUES (1, ?)").bind(release.fingerprint).run();
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
      signature: utils.bytes.bs58.encode(relayed!.signatures[0]!), state: "confirmed" }]);
    expect((await dump(["keeper_lease"])).keeper_lease).toEqual([]);
    expect(output).not.toContain(JSON.stringify([...keeper.secretKey]));
  });

  it("keeper_lease_admits_one_pass_at_a_time_and_only_a_dead_pass_loses_it", async () => {
    expect(await acquireKeeperLease(db, "first", NOW)).toBe(true);
    expect(await acquireKeeperLease(db, "second", NOW + KEEPER_LEASE_SECONDS - 1)).toBe(false);
    // A pass that holds the lease stops the Worker's own scheduled pass before it reads the chain.
    await db.prepare("UPDATE keeper_lease SET expires_at = ?").bind(Math.floor(Date.now() / 1_000) + 600).run();
    await scheduled();
    expect(outbound.map(({ method }) => method)).toEqual(["getSignaturesForAddress"]);
    expect(output).toContain('"outcome":"busy"');
    await db.prepare("UPDATE keeper_lease SET expires_at = ?").bind(NOW + KEEPER_LEASE_SECONDS).run();
    // Releasing someone else's lease does nothing; the holder's release frees it.
    await releaseKeeperLease(db, "second");
    expect(await acquireKeeperLease(db, "second", NOW + 1)).toBe(false);
    await releaseKeeperLease(db, "first");
    expect(await acquireKeeperLease(db, "second", NOW + 1)).toBe(true);
    expect(await acquireKeeperLease(db, "third", NOW + 1 + KEEPER_LEASE_SECONDS)).toBe(true);
    expect((await dump(["keeper_lease"])).keeper_lease).toMatchObject([{ holder: "third" }]);
  });

  it("keeper_ledger_reserves_before_relay_and_an_unsettled_write_counts_against_the_next_pass", async () => {
    vi.spyOn(VersionedTransaction.prototype, "sign").mockImplementation(() => undefined);
    const order: string[] = [];
    const writes = () => db.prepare("SELECT pass, operation, reserved_lamports, state FROM keeper_writes ORDER BY id").all();
    const connection = {
      getBalance: vi.fn().mockResolvedValue(1_000_000_000),
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: keeper.publicKey.toBase58(), lastValidBlockHeight: 500 }),
      getFeeForMessage: vi.fn().mockResolvedValue({ value: 5_000 }),
      simulateTransaction: vi.fn(async () => { order.push("simulate");
        return { value: { err: null, unitsConsumed: 40_000, accounts: [{ lamports: 940_000_000 }] } }; }),
      sendRawTransaction: vi.fn(async () => {
        // The reservation is durable before the bytes leave.
        order.push(`send:${(await writes()).results.at(-1)!.state as string}`);
        return "signature";
      }),
      getSignatureStatuses: vi.fn(async () => ({ value: [{ err: null, confirmationStatus: "confirmed" }] })),
    };
    const pass = (traceId: string, nowUnix: number, log?: (event: unknown) => void) => runKeeperPass({
      connection: connection as unknown as Connection, keeper, writeEnabled: true, now: () => nowUnix * 1_000,
      traceId, ledger: keeperLedger(db, traceId), wait: async () => undefined, ...(log ? { log } : {}),
      protocolSnapshot: { paused: true, launchDayId: DAY, suspendedUntilDay: 0, lastPreparedDay: DAY + 1, dailies: [], runs: [],
        closedArenaPlayers: [{ dayId: DAY - 1, owner: Keypair.generate().publicKey, rentPayer: keeper.publicKey }] },
      protocolMaterializer: { materialize: async () => [new TransactionInstruction({
        programId: ZKUBE_PROGRAM_ID, keys: [], data: Buffer.alloc(8) })] },
    });
    const spend = 60_005_000;
    expect(await pass("confirmed", NOW)).toMatchObject({ writes: 1, spentLamports: spend });
    expect(order).toEqual(["simulate", "simulate", "send:reserved"]);
    // A write that landed and failed is settled; one whose outcome never arrived stays reserved.
    connection.getSignatureStatuses.mockResolvedValueOnce({ value: [{ err: { InstructionError: [1, "Custom"] }, confirmationStatus: "confirmed" }] } as never);
    expect(await pass("failed", NOW)).toMatchObject({ writes: 0, operationFailures: 1 });
    connection.getSignatureStatuses.mockRejectedValueOnce(new Error("timeout"));
    expect(await pass("uncertain", NOW)).toMatchObject({ writes: 0, operationFailures: 1, spentLamports: spend });
    expect((await writes()).results).toEqual([
      { pass: "confirmed", operation: "close_arena_player", reserved_lamports: spend, state: "confirmed" },
      { pass: "failed", operation: "close_arena_player", reserved_lamports: spend, state: "failed" },
      { pass: "uncertain", operation: "close_arena_player", reserved_lamports: spend, state: "reserved" },
    ]);
    // While that write can still land, its spend is taken from the next pass's ceiling: no relay.
    expect(KEEPER_LIMITS.spendLamports - spend).toBeLessThan(spend);
    const sent = connection.sendRawTransaction.mock.calls.length;
    const log = vi.fn();
    expect(await pass("next", NOW + 1, log)).toMatchObject({ writes: 0, operationFailures: 1 });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ error: "keeper spend ceiling reached" }));
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(sent);
    expect(await pass("later", NOW + KEEPER_UNSETTLED_SECONDS)).toMatchObject({ writes: 1 });
    // A poll that never reports an outcome leaves the reservation in place too.
    connection.getSignatureStatuses.mockResolvedValue({ value: [null] } as never);
    expect(await pass("silent", NOW + 1_000)).toMatchObject({ writes: 0, operationFailures: 1 });
    expect((await writes()).results.at(-1)).toMatchObject({ pass: "silent", state: "reserved" });
  });
});
