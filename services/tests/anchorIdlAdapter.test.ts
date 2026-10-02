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

const DAY = 20_651;
const RUN_ID = 42n;

type ProtocolOperation = KeeperOperation;

describe("exact v5 Anchor IDL keeper adapter", () => {
  it("staged_launch_ready_requires_the_paused_protocol_and_both_unfunded_days", async () => {
    const fixture = JSON.parse(readFileSync(new URL("../../fixtures/program-unity-v1.json", import.meta.url), "utf8"));
    const coder = new BorshAccountsCoder(convertIdlToCamelCase(readIdl() as Idl));
    const protocol = coder.decode("protocolConfig", Buffer.from(fixture.plans.accounts.protocol.data, "base64"));
    protocol.paused = true; protocol.launchDayId = 0;
    const daily = coder.decode("arenaDaily", Buffer.from(fixture.plans.accounts.daily.data, "base64"));
    daily.status = { funding: {} }; daily.predecessorRolloverApplied = false;
    for (const key of Object.keys(daily.ledger)) daily.ledger[key] = daily.ledger[key].sub(daily.ledger[key]);
    const values = new Map<string, Buffer>([[protocolPda().toBase58(), await coder.encode("protocolConfig", protocol)]]);
    for (const dayId of [DAY, DAY + 1]) {
      daily.dayId = dayId;
      values.set(arenaDailyPda(dayId).toBase58(), await coder.encode("arenaDaily", daily));
    }
    const adapter = await AnchorKeeperAdapter.create({ nowUnix: DAY * 86_400, launchDayId: DAY,
      connection: { getAccountInfo: async (address: PublicKey) => {
        const data = values.get(address.toBase58());
        return data ? { data, owner: ZKUBE_PROGRAM_ID, executable: false, lamports: 1_000_000_000 } : null;
      } } as unknown as Connection,
    });
    expect(await adapter.inspectLaunchState()).toBe("staged_launch_ready");
    values.delete(arenaDailyPda(DAY + 1).toBase58());
    await expect(adapter.inspectLaunchState()).rejects.toThrow("missing");
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
    const closesAt = day * 86_400 + 86_340;
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

    // The unreachable run waits for its recovery deadline; the next Daily is still prepared.
    expect(await plansAt(fixtures.plans.inputs.now)).toEqual(["prepare_arena_daily"]);
    expect(await plansAt(closesAt + 21_600)).toContain("expire_unresolved_arena_run");
    expect(new Set(scanned)).toEqual(new Set([coder.memcmp("arenaPlayer").bytes, coder.memcmp("activeRun").bytes]));
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
      ["prepare_arena_daily", {
        dayId: DAY,
        followingDayId: DAY + 1,

      }, "prepare_arena_daily"],
      ["activate_arena_daily", {
        dayId: DAY,

      }, "activate_arena_daily"],
      ["skip_suspended_arena_daily", {
        dayId: DAY,
        followingDayId: DAY + 1,

      }, "skip_suspended_arena_daily"],
      ["finish_run", arcade(owner), "finish_run"],
      ["commit_run", arcade(owner), "commit_run"],
      ["consume_arena_run", arcade(owner), "consume_arena_run"],
      ["expire_unresolved_arena_run", arcade(owner),
        "expire_unresolved_arena_run"],
      ["finalize_arena_daily", {
        dayId: DAY,
        followingDayId: DAY + 1,
      }, "finalize_arena_daily"],
      ["submit_arena_board_chunk", {
        dayId: DAY,
        boardKind: "score",

        boardEntries: [{
          source: Keypair.generate().publicKey,
          score: 1,
          objectiveTotal: 0n,
          finalizedAt: DAY * 86_400,
          replayHash: new Uint8Array(32),
        }],
      }, "submit_arena_board_chunk"],
      ["expire_daily_claims", {
        dayId: DAY,
        followingDayId: DAY + 1,
      }, "expire_daily_claims"],
      ["archive_arena_daily", { dayId: DAY }, "archive_arena_daily"],
      ["close_arena_daily", { dayId: DAY }, "close_arena_daily"],
      ["close_arena_player", { dayId: DAY, owner, rentRecipient: keeper,
      }, "close_arena_player"],
    ];
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
    expect(instruction?.keys).toHaveLength(5);
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
    nowUnix: DAY * 86_400, launchDayId: DAY,
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
