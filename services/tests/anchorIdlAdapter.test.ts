// @vitest-environment node
import { readFileSync } from "node:fs";
import { BorshAccountsCoder, convertIdlToCamelCase, type Idl } from "@anchor-lang/core";
import BN from "bn.js";

import { Keypair, PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  AnchorKeeperAdapter,
  KEEPER_EXPECTED_IDL_SHA256,
} from "../src/anchorIdlAdapter";
import {
  ZKUBE_PROGRAM_ID,
  KEEPER_PLAN_INSTRUCTION,
  arenaDailyPda,
  cadenceFundingPda,
  type KeeperOperation,
  type KeeperPlanContext,
} from "../src/arcadeChain";
import { discoverReconciliationPlans } from "../src/arcadeReconciliation";
import { canonicalDevnetReplayDomainHex } from "../src/serviceReadiness";

const SOURCE_IDL_SHA256 =
  "4a578067e71dc9a63c6fe7e69545f413d811f4f99d0ec0e81c82c4962c3e3e08";
const DAY = 20_651;
const RUN_ID = 42n;

type ProtocolOperation = KeeperOperation;

describe("exact v5 Anchor IDL keeper adapter", () => {
  it("a_closed_arena_player_returns_rent_to_its_payer", async () => {
    const fixtures = JSON.parse(readFileSync(new URL("../../fixtures/program-unity-v1.json", import.meta.url), "utf8"));
    const fixture = fixtures.closedPlayer;
    const coder = new BorshAccountsCoder(convertIdlToCamelCase(readIdl() as Idl));
    const protocolRow = fixtures.plans.accounts.protocol;
    const protocol = coder.decode("protocolConfig", Buffer.from(protocolRow.data, "base64"));
    protocol.replayDomain = [...Buffer.from(canonicalDevnetReplayDomainHex(), "hex")];
    const info = (row: { owner: string; executable: boolean; data: string }) => ({
      owner: new PublicKey(row.owner), executable: row.executable, lamports: 1_000_000_000,
      data: Buffer.from(row.data, "base64"), rentEpoch: 0,
    });
    const values = new Map([
      [protocolRow.address, { ...info(protocolRow), data: await coder.encode("protocolConfig", protocol) }],
      [fixture.arcade.address, info(fixture.arcade)],
      [cadenceFundingPda().toBase58(), { owner: SystemProgram.programId, executable: false,
        lamports: 1_000_000_000, data: Buffer.alloc(0), rentEpoch: 0 }],
    ]);
    let playerData = Buffer.from(fixture.player.data, "base64");
    const connection = {
      getAccountInfo: async (address: PublicKey) => values.get(address.toBase58()) ?? null,
      getMultipleAccountsInfo: async (addresses: PublicKey[]) => addresses.map(() => null),
      getProgramAccounts: async (_program: PublicKey, options: { filters: Array<{ memcmp: { bytes: string } }> }) =>
        options.filters[0]?.memcmp.bytes === coder.memcmp("arenaPlayer").bytes
          ? [{ pubkey: new PublicKey(fixture.player.address), account: { ...info(fixture.player), data: playerData } }] : [],
    } as unknown as Connection;
    const nowUnix = fixture.inputs.now;
    const adapter = await AnchorKeeperAdapter.create({ connection, nowUnix,
      release: { launchDayId: fixture.inputs.day - 100 }, testExpectedIdlSha256: SOURCE_IDL_SHA256 });
    const snapshot = await adapter.loadProtocolSnapshot();
    const plans = discoverReconciliationPlans({ snapshot, nowUnix });
    expect(plans.map(({ operation }) => operation)).toEqual(["close_arena_player"]);
    const [call] = await adapter.materialize({ operation: plans[0]!.operation, context: plans[0]!.context!,
      programId: ZKUBE_PROGRAM_ID, keeper: new PublicKey(fixture.inputs.validator) });
    const expected = fixture.transaction.instructions[0];
    expect(call!.data.toString("base64")).toBe(expected.data);
    expect(call!.keys.map((key) => ({ address: key.pubkey.toBase58(), signer: key.isSigner,
      writable: key.isWritable }))).toEqual(expected.accounts);

    const invalid = coder.decode("arenaPlayer", playerData);
    invalid.activePaidRunId = new BN(1);
    playerData = await coder.encode("arenaPlayer", invalid);
    await expect(adapter.loadProtocolSnapshot()).rejects.toThrow("invalid ArenaPlayer");
  });

  it("locks the fresh-bootstrap interface at 32 instructions and 8 accounts", async () => {
    const idl = readIdl();
    expect(idl.instructions).toHaveLength(32);
    expect(idl.accounts).toHaveLength(8);
    expect(idl.instructions.map(({ name }) => name)).not.toEqual(expect.arrayContaining([
      "prepare_weekly_jackpot",
      "finalize_season",
      "consume_practice_run",
    ]));
    expect(idl.accounts.map(({ name }) => name)).not.toEqual(expect.arrayContaining([
      "WeeklyJackpot",
      "Season",
      "SeasonPlayer",
    ]));
    const adapter = await createAdapter();
    expect(adapter.idlHash).toBe(SOURCE_IDL_SHA256);
    expect(KEEPER_EXPECTED_IDL_SHA256).toBe(SOURCE_IDL_SHA256);
  });

  it("keeps the ephemeral undelegation callback constrained", () => {
    const instruction = readIdl().instructions.find(
      ({ name }) => name === "process_undelegation",
    );
    const buffer = instruction?.accounts.find(({ name }) => name === "buffer");
    const systemProgram = instruction?.accounts.find(
      ({ name }) => name === "system_program",
    );
    expect(Buffer.from(buffer?.pda?.seeds[0]?.value ?? []).toString()).toBe(
      "undelegate-buffer",
    );
    expect(buffer?.pda?.seeds[1]).toMatchObject({
      kind: "account",
      path: "base_account",
    });
    expect(buffer?.pda?.program).toMatchObject({ kind: "const" });
    expect(systemProgram?.address).toBe(SystemProgram.programId.toBase58());
  });

  it("materializes every surviving keeper protocol operation", async () => {
    const adapter = await createAdapter();
    const keeper = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const cases: Array<[ProtocolOperation, KeeperPlanContext, string]> = [
      ["prepare_arena_daily", {
        dayId: DAY,
        followingDayId: DAY + 1,
        suspendedUntilDay: 0,
        pairIndex: 0,
        realmMapId: 1,
      }, "prepare_arena_daily"],
      ["activate_arena_daily", {
        dayId: DAY,
        suspendedUntilDay: 0,
      }, "activate_arena_daily"],
      ["skip_suspended_arena_daily", {
        dayId: DAY,
        followingDayId: DAY + 1,
        suspendedUntilDay: DAY + 1,
        cadenceFunding: Keypair.generate().publicKey,
      }, "skip_suspended_arena_daily"],
      ["finish_run", arcade(owner, "ephemeral_rollup"), "finish_run"],
      ["commit_run", arcade(owner, "ephemeral_rollup"), "commit_run"],
      ["consume_arena_run", arcade(owner, "base"), "consume_arena_run"],
      ["expire_unresolved_arena_run", arcade(owner, "unavailable"),
        "expire_unresolved_arena_run"],
      ["cleanup_orphan_active_run", arcade(owner, "base"),
        "cleanup_orphan_active_run"],
      ["finalize_arena_daily", {
        dayId: DAY,
        followingDayId: DAY + 1,
        scorePayoutCount: 1,
        themePayoutCount: 0,
      }, "finalize_arena_daily"],
      ["submit_arena_board_chunk", {
        dayId: DAY,
        boardKind: "score",
        boardCursor: 0,
        boardPayoutCount: 1,
        boardEntries: [{
          source: Keypair.generate().publicKey,
          score: 1,
          objectiveTotal: 0n,
          finalizedAt: DAY * 86_400,
          replayHash: new Uint8Array(32),
        }],
        sealBoard: true,
      }, "submit_arena_board_chunk"],
      ["expire_daily_claims", {
        dayId: DAY,
        followingDayId: DAY + 1,
      }, "expire_daily_claims"],
      ["archive_arena_daily", { dayId: DAY }, "archive_arena_daily"],
      ["close_arena_daily", { dayId: DAY }, "close_arena_daily"],
      ["close_arena_player", { dayId: DAY, owner, rentRecipient: keeper,
        parentDailyClosed: true }, "close_arena_player"],
    ];
    const idl = readIdl();
    for (const [operation, context, expectedName] of cases) {
      expect(KEEPER_PLAN_INSTRUCTION[operation].instruction).toBe(expectedName);
      const [instruction] = await adapter.materialize({
        operation,
        context,
        programId: ZKUBE_PROGRAM_ID,
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
      programId: ZKUBE_PROGRAM_ID,
      keeper: Keypair.generate().publicKey,
    })).rejects.toThrow("outside the exact allowlist");
  });

  it("materializes Arena consumption without a removed Weekly account", async () => {
    const adapter = await createAdapter();
    const keeper = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const [instruction] = await adapter.materialize({
      operation: "consume_arena_run",
      context: arcade(owner, "base"),
      programId: ZKUBE_PROGRAM_ID,
      keeper,
    });
    expect(instruction?.keys).toHaveLength(5);
    expect(instruction?.keys.some(({ pubkey }) => pubkey.equals(arenaDailyPda(DAY))))
      .toBe(true);
  });
});

async function createAdapter(): Promise<AnchorKeeperAdapter> {
  return AnchorKeeperAdapter.create({
    connection: {} as Connection,
    nowUnix: DAY * 86_400,
    testExpectedIdlSha256: SOURCE_IDL_SHA256,
  });
}
function arcade(
  owner: PublicKey,
  runLocation: "base" | "ephemeral_rollup" | "unavailable",
): KeeperPlanContext {
  return {
    owner,
    rentRecipient: Keypair.generate().publicKey,
    runId: RUN_ID,
    runLocation,
    includeArenaPlayer: true,
    challengeDayId: DAY,
    deadlineDayId: DAY,
    deadlineAt: DAY * 86_400 + 86_340,
    recoveryDeadlineAt: DAY * 86_400 + 107_940,
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
