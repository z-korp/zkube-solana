// @vitest-environment node
import { readFileSync } from "node:fs";
import { BorshAccountsCoder, convertIdlToCamelCase, type Idl } from "@anchor-lang/core";

import { Keypair, PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import BN from "bn.js";

import {
  AnchorKeeperAdapter,
} from "../src/anchorIdlAdapter.js";
import {
  ZKUBE_PROGRAM_ID,
  KEEPER_PLAN_INSTRUCTION,
  arenaDailyPda,
  arenaPlayerPda,
  playerStatePda,
  cadenceFundingPda,
  protocolPda,
  type KeeperOperation,
  type KeeperPlanContext,
} from "../src/arcadeChain.js";
import { discoverReconciliation } from "../src/arcadeReconciliation.js";
import { dailyWindow } from "../src/zkubeCore.js";
// The instant a day opens; the core owns the boundary (07:00 UTC).
const opens = (day: number) => dailyWindow(day).opensAt;

const DAY = 20_651;
const RUN_ID = 42n;

type ProtocolOperation = KeeperOperation;

describe("exact v5 Anchor IDL keeper adapter", () => {
  it("staged_launch_ready_requires_the_paused_protocol_and_no_launch_daily", async () => {
    const fixture = JSON.parse(readFileSync(new URL("../../fixtures/program-unity-v1.json", import.meta.url), "utf8"));
    const coder = new BorshAccountsCoder(convertIdlToCamelCase(readIdl() as Idl));
    const protocol = coder.decode("protocolConfig", Buffer.from(fixture.plans.accounts.protocol.data, "base64"));
    protocol.paused = true; protocol.launchDayId = 0;
    const values = new Map<string, Buffer>([[protocolPda().toBase58(), await coder.encode("protocolConfig", protocol)]]);
    const adapter = await AnchorKeeperAdapter.create({ nowUnix: opens(DAY), launchDayId: DAY,
      connection: { getAccountInfo: async (address: PublicKey) => {
        const data = values.get(address.toBase58());
        return data ? { data, owner: ZKUBE_PROGRAM_ID, executable: false, lamports: 1_000_000_000 } : null;
      } } as unknown as Connection,
    });
    // The launch transaction prepares its own Daily: a staged protocol has none.
    expect(await adapter.inspectLaunchState()).toBe("staged_launch_ready");
    values.set(arenaDailyPda(DAY).toBase58(), Buffer.from(fixture.plans.accounts.daily.data, "base64"));
    await expect(adapter.inspectLaunchState()).rejects.toThrow("incomplete or active");
    values.delete(arenaDailyPda(DAY).toBase58());
    protocol.paused = false;
    values.set(protocolPda().toBase58(), await coder.encode("protocolConfig", protocol));
    await expect(adapter.inspectLaunchState()).rejects.toThrow("incomplete or active");
  });

  it("keeper_rpc_decoding_rejects_foreign_and_malformed_accounts", async () => {
    const fixture = JSON.parse(readFileSync(new URL("../../fixtures/program-unity-v1.json", import.meta.url), "utf8")).closedPlayer;
    const valid = { owner: new PublicKey(fixture.protocol.owner), executable: false,
      data: Buffer.from(fixture.protocol.data, "base64"), lamports: 1_000_000_000, rentEpoch: 0 };
    const badVersion = Buffer.from(valid.data); badVersion[8] = 0;
    const adapter = (info = valid, count = 0) => AnchorKeeperAdapter.create({
      nowUnix: fixture.inputs.now, launchDayId: fixture.inputs.day - 100,
      connection: { getAccountInfo: async () => info,
        getMultipleAccountsInfo: async (addresses: PublicKey[]) => addresses.map(() => null),
        getProgramAccounts: async () => new Array(count).fill(null),
      } as unknown as Connection,
    });
    for (const bad of [{ ...valid, owner: Keypair.generate().publicKey }, { ...valid, executable: true },
      { ...valid, data: Buffer.alloc(0) }, { ...valid, data: badVersion },
      { ...valid, data: Buffer.alloc(129_538) }, { ...valid, data: valid.data.subarray(0, 9) }]) {
      await expect((await adapter(bad)).loadProtocolSnapshot()).rejects.toThrow();
    }
  });

  it("keeper_discovery_follows_play_in_flight_and_defers_one_unreachable_run", async () => {
    const fixtures = JSON.parse(readFileSync(new URL("../../fixtures/program-unity-v1.json", import.meta.url), "utf8"));
    const coder = new BorshAccountsCoder(convertIdlToCamelCase(readIdl() as Idl));
    const decode = (name: string, row: { data: string }) => coder.decode(name, Buffer.from(row.data, "base64"));
    const { day, runId } = fixtures.plans.inputs;
    const owner = new PublicKey(fixtures.plans.inputs.owner);
    const closesAt = opens(day) + 86_340;
    const protocol = decode("protocolConfig", fixtures.plans.accounts.protocol);
    protocol.lastPreparedDay = day;
    const daily = decode("arenaDaily", fixtures.plans.accounts.daily);
    daily.entriesPaid = new BN(1);
    const profile = decode("playerState", fixtures.plans.accounts.player);
    profile.activeRunId = new BN(runId); profile.activeRunDaily = arenaDailyPda(day);
    profile.activeRunDeadlineAt = new BN(closesAt);
    const entrant = decode("arenaPlayer", fixtures.closedPlayer.player);
    entrant.challenge = arenaDailyPda(day); entrant.player = owner;
    entrant.paidEntries = 1; entrant.resolvedEntries = 0; entrant.activePaidRunId = new BN(runId);
    const info = (data: Buffer) => ({ data, owner: ZKUBE_PROGRAM_ID, executable: false, lamports: 1_000_000_000, rentEpoch: 0 });
    const entrantInfo = info(await coder.encode("arenaPlayer", entrant));
    // Another 10,000 players of days outside the keeper's window, and any
    // number of lifetime profiles, which discovery never asks for.
    const unrelated = decode("arenaPlayer", fixtures.closedPlayer.player);
    unrelated.challenge = arenaDailyPda(day - 200);
    const unrelatedInfo = info(await coder.encode("arenaPlayer", unrelated));
    const values = new Map([
      [protocolPda().toBase58(), info(await coder.encode("protocolConfig", protocol))],
      [arenaDailyPda(day).toBase58(), info(await coder.encode("arenaDaily", daily))],
      [playerStatePda(owner).toBase58(), info(await coder.encode("playerState", profile))],
      [arenaPlayerPda(arenaDailyPda(day), owner).toBase58(), entrantInfo],
    ]);
    const outside = Keypair.generate().publicKey;
    const scanned: string[] = [];
    const connection = {
      getAccountInfo: async (address: PublicKey) => values.get(address.toBase58()) ?? null,
      getMultipleAccountsInfo: async (addresses: PublicKey[]) =>
        addresses.map((address) => values.get(address.toBase58()) ?? null),
      getProgramAccounts: async (_program: PublicKey, options: { filters: Array<{ memcmp: { bytes: string } }> }) => {
        const filter = options.filters[0]!.memcmp.bytes;
        scanned.push(filter);
        return filter !== coder.memcmp("arenaPlayer").bytes ? [] : [
          { pubkey: arenaPlayerPda(arenaDailyPda(day), owner), account: entrantInfo },
          ...new Array(10_000).fill({ pubkey: outside, account: unrelatedInfo }),
        ];
      },
    } as unknown as Connection;
    const plansAt = async (nowUnix: number) => {
      const adapter = await AnchorKeeperAdapter.create({ connection, nowUnix, launchDayId: protocol.launchDayId,
        fetcher: (async () => { throw new Error("Router unreachable"); }) as unknown as typeof fetch });
      const snapshot = await adapter.loadProtocolSnapshot();
      expect(snapshot.runs).toMatchObject([{ owner, runId: BigInt(runId), dayId: day,
        lifecycle: "unavailable", location: "unavailable", reservationActive: true }]);
      return discoverReconciliation({ snapshot, nowUnix }).map(({ operation }) => operation);
    };

    // The unreachable run stops nothing: today's Daily exists, so nothing is due, and the next day's
    // Daily is still prepared. Nothing expires the run: its Daily finalizes by the clock.
    expect(await plansAt(fixtures.plans.inputs.now)).toEqual([]);
    expect(await plansAt(closesAt + 21_600)).toEqual(["prepare_arena_daily"]);
    expect(new Set(scanned)).toEqual(new Set([coder.memcmp("arenaPlayer").bytes, coder.memcmp("activeRun").bytes]));

    // Hints are checked against the Daily's own count of unresolved entries. Hints that reach the
    // run are used as they are; hints that miss it (an entry made out of the read model's sight)
    // send the keeper to the chain, and the run is found all the same.
    const withHints = async (arenaPlayers: PublicKey[]) => {
      scanned.length = 0;
      const adapter = await AnchorKeeperAdapter.create({ connection, nowUnix: fixtures.plans.inputs.now,
        launchDayId: protocol.launchDayId, discovery: { arenaPlayers, runOwners: [] },
        fetcher: (async () => { throw new Error("Router unreachable"); }) as unknown as typeof fetch });
      const snapshot = await adapter.loadProtocolSnapshot();
      expect(snapshot.runs).toMatchObject([{ owner, runId: BigInt(runId), dayId: day, reservationActive: true }]);
      return adapter.discovered;
    };
    expect(await withHints([arenaPlayerPda(arenaDailyPda(day), owner)])).toBe("read_model");
    expect(scanned).toEqual([]);
    expect(await withHints([])).toBe("scan");
    expect(new Set(scanned)).toEqual(new Set([coder.memcmp("arenaPlayer").bytes, coder.memcmp("activeRun").bytes]));
    expect(await withHints([Keypair.generate().publicKey])).toBe("scan");
  });

  it("keeper_reads_hinted_accounts_from_the_chain_and_drops_every_hint_it_cannot_verify", async () => {
    const fixtures = JSON.parse(readFileSync(new URL("../../fixtures/program-unity-v1.json", import.meta.url), "utf8"));
    const coder = new BorshAccountsCoder(convertIdlToCamelCase(readIdl() as Idl));
    const decode = (name: string, row: { data: string }) => coder.decode(name, Buffer.from(row.data, "base64"));
    const { day, now } = fixtures.plans.inputs;
    const protocol = decode("protocolConfig", fixtures.plans.accounts.protocol);
    protocol.lastPreparedDay = day + 1;
    const daily = decode("arenaDaily", fixtures.plans.accounts.daily);
    const info = (data: Buffer, owner = ZKUBE_PROGRAM_ID) => ({ data, owner, executable: false, lamports: 1_000_000_000, rentEpoch: 0 });
    const finished = decode("arenaPlayer", fixtures.closedPlayer.player);
    const owner = finished.player as PublicKey;
    finished.challenge = arenaDailyPda(day - 1);
    const finishedData = await coder.encode("arenaPlayer", finished);
    const real = arenaPlayerPda(arenaDailyPda(day - 1), owner);
    const foreign = Keypair.generate().publicKey, closed = Keypair.generate().publicKey;
    const values = new Map([
      [protocolPda().toBase58(), info(await coder.encode("protocolConfig", protocol))],
      [arenaDailyPda(day).toBase58(), info(await coder.encode("arenaDaily", daily))],
      [real.toBase58(), info(finishedData)],
      // The same bytes under another program: a forged hint.
      [foreign.toBase58(), info(finishedData, SystemProgram.programId)],
    ]);
    const connection = {
      getAccountInfo: async (address: PublicKey) => values.get(address.toBase58()) ?? null,
      getMultipleAccountsInfo: async (addresses: PublicKey[]) =>
        addresses.map((address) => values.get(address.toBase58()) ?? null),
      getProgramAccounts: async () => { throw new Error("a complete read model replaces the scan"); },
    } as unknown as Connection;
    const adapter = await AnchorKeeperAdapter.create({ connection, nowUnix: now, launchDayId: protocol.launchDayId,
      discovery: { arenaPlayers: [foreign, closed, real], runOwners: [Keypair.generate().publicKey] } });
    const snapshot = await adapter.loadProtocolSnapshot();
    expect(snapshot.closedArenaPlayers).toMatchObject([{ dayId: day - 1, owner }]);
    expect(snapshot.runs).toEqual([]);
  });

  it("a_closed_arena_player_returns_rent_to_its_payer", async () => {
    const fixtures = JSON.parse(readFileSync(new URL("../../fixtures/program-unity-v1.json", import.meta.url), "utf8"));
    const fixture = fixtures.closedPlayer;
    const coder = new BorshAccountsCoder(convertIdlToCamelCase(readIdl() as Idl));
    const protocolRow = fixture.protocol;
    const protocol = coder.decode("protocolConfig", Buffer.from(protocolRow.data, "base64"));
    const info = (row: { owner: string; executable: boolean; data: string }) => ({
      owner: new PublicKey(row.owner), executable: row.executable, lamports: 1_000_000_000,
      data: Buffer.from(row.data, "base64"), rentEpoch: 0,
    });
    const values = new Map([
      [protocolRow.address, { ...info(protocolRow), data: await coder.encode("protocolConfig", protocol) }],
      [cadenceFundingPda().toBase58(), { owner: SystemProgram.programId, executable: false,
        lamports: 1_000_000_000, data: Buffer.alloc(0), rentEpoch: 0 }],
    ]);
    const playerData: Buffer = Buffer.from(fixture.player.data, "base64");
    const connection = {
      getAccountInfo: async (address: PublicKey) => values.get(address.toBase58()) ?? null,
      getMultipleAccountsInfo: async (addresses: PublicKey[]) => addresses.map(() => null),
      getProgramAccounts: async (_program: PublicKey, options: { filters: Array<{ memcmp: { bytes: string } }> }) =>
        options.filters[0]?.memcmp.bytes === coder.memcmp("arenaPlayer").bytes
          ? [{ pubkey: new PublicKey(fixture.player.address), account: { ...info(fixture.player), data: playerData } }] : [],
    } as unknown as Connection;
    const nowUnix = fixture.inputs.now;
    const adapter = await AnchorKeeperAdapter.create({ connection, nowUnix,
      launchDayId: fixture.inputs.day - 100 });
    const snapshot = await adapter.loadProtocolSnapshot();
    const plans = discoverReconciliation({ snapshot, nowUnix });
    const closure = plans.find(({ operation }) => operation === "close_arena_player");
    expect(closure).toBeDefined();
    const [call] = await adapter.materialize({ operation: closure!.operation, context: closure!.context,
      keeper: new PublicKey(fixture.inputs.validator) });
    const expected = fixture.transaction.instructions[0];
    expect(call!.data.toString("base64")).toBe(expected.data);
    expect(call!.keys.map((key) => ({ address: key.pubkey.toBase58(), signer: key.isSigner,
      writable: key.isWritable }))).toEqual(expected.accounts);


  });

  it("materializes every surviving keeper protocol operation", async () => {
    const adapter = await createAdapter();
    const keeper = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const cases: Array<[ProtocolOperation, KeeperPlanContext, string]> = [
      ["prepare_arena_daily", { dayId: DAY }, "prepare_arena_daily"],
      ["finish_run", arcade(owner), "finish_run"],
      ["commit_run", arcade(owner), "commit_run"],
      ["consume_arena_run", arcade(owner), "consume_arena_run"],
      ["finalize_arena_daily", { dayId: DAY, followingDayId: DAY + 1 }, "finalize_arena_daily"],
      ["close_arena_daily", { dayId: DAY }, "close_arena_daily"],
      ["close_arena_daily", { dayId: DAY, followingDayId: DAY + 40 }, "close_arena_daily"],
      ["close_arena_player", { dayId: DAY, owner, rentRecipient: keeper }, "close_arena_player"],
    ];
    expect(new Set(cases.map(([operation]) => operation))).toEqual(new Set(Object.keys(KEEPER_PLAN_INSTRUCTION)));
    const idl = readIdl();
    for (const [operation, context, expectedName] of cases) {
      expect(KEEPER_PLAN_INSTRUCTION[operation].instruction).toBe(expectedName);
      const [instruction] = await adapter.materialize({
        operation,
        context,

        keeper,
      });
      expect(instruction?.programId.equals(ZKUBE_PROGRAM_ID)).toBe(true);
      const definition = idl.instructions.find(({ name }) => name === expectedName);
      expect([...instruction!.data.subarray(0, 8)]).toEqual(definition?.discriminator);
      expect(instruction?.keys.filter(({ isSigner }) => isSigner)
        .every(({ pubkey }) => pubkey.equals(keeper))).toBe(true);
    }
  });

  it("fails closed for an operation outside the exact keeper plans", async () => {
    const adapter = await createAdapter();
    await expect(adapter.materialize({
      operation: "unknown_keeper_write" as KeeperOperation,
      context: {},

      keeper: Keypair.generate().publicKey,
    })).rejects.toThrow("outside the exact allowlist");
  });

  it("materializes Arena consumption with its Daily account", async () => {
    const adapter = await createAdapter();
    const keeper = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const [instruction] = await adapter.materialize({
      operation: "consume_arena_run",
      context: arcade(owner),

      keeper,
    });
    expect(instruction?.keys).toHaveLength(7);
    expect(instruction?.keys.some(({ pubkey }) => pubkey.equals(arenaDailyPda(DAY))))
      .toBe(true);
  });

  it("materializes orphan consumption without period accounts", async () => {
    const adapter = await createAdapter();
    const keeper = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const [instruction] = await adapter.materialize({
      operation: "consume_arena_run",
      context: { ...arcade(owner), includeArenaPlayer: false },

      keeper,
    });
    const definition = readIdl().instructions.find(({ name }) => name === "consume_arena_run")!;
    expect([...instruction!.data]).toEqual(definition.discriminator);
    for (const name of ["arena_daily", "arena_player"]) {
      const index = definition.accounts.findIndex((account) => account.name === name);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(instruction!.keys[index]!.pubkey.equals(ZKUBE_PROGRAM_ID)).toBe(true);
    }
  });
});

async function createAdapter(): Promise<AnchorKeeperAdapter> {
  return AnchorKeeperAdapter.create({
    connection: {} as Connection,
    nowUnix: opens(DAY), launchDayId: DAY,
  });
}
function arcade(
  owner: PublicKey,

): KeeperPlanContext {
  return {
    owner,
    rentRecipient: Keypair.generate().publicKey,
    runId: RUN_ID,

    includeArenaPlayer: true,
    dayId: DAY,

  };
}

function readIdl(): {
  instructions: Array<{
    name: string;
    discriminator: number[];
    accounts: Array<{
      name: string;
      address?: string;
      pda?: {
        seeds: Array<{ kind: string; path?: string; value?: number[] }>;
        program?: { kind: string; value?: number[] };
      };
    }>;
  }>;
  accounts: Array<{ name: string }>;
} {
  return JSON.parse(readFileSync(
    new URL("../../tools/chain/idl/solana.json", import.meta.url),
    "utf8",
  ));
}
