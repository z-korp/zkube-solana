// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  AnchorKeeperAdapter,
  KEEPER_EXPECTED_IDL_SHA256,
} from "../src/anchorIdlAdapter";
import {
  ZKUBE_PROGRAM_ID,
  activeRunPda,
  arcadeConfigPda,
  arenaDailyPda,
  arenaPlayerPda,
  playerFundingPda,
  playerStatePda,
  protocolPda,
  rulesCatalogPda,
  seasonIdForDay,
  seasonPda,
  seasonPlayerPda,
  weekIdForDay,
  weekStartDay,
  weeklyJackpotPda,
  type KeeperOperation,
  type KeeperPlanContext,
} from "../src/arcadeChain";

const FINAL_IDL_SHA256 =
  "b744106cfe4ab71188fbdd9be07fffed69b5a5823eb22627ae17d4e1102fd29c";
const DAY = 20_651;
const WEEK = weekIdForDay(DAY);
const SEASON = seasonIdForDay(DAY);
const RUN_ID = 42n;
const MAGIC_CONTEXT = new PublicKey("MagicContext1111111111111111111111111111111");
const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");

type ProtocolOperation = Exclude<KeeperOperation, "revoke_expired_session">;
type ExpectedMeta = {
  pubkey: PublicKey;
  isWritable: boolean;
  isSigner: boolean;
};
type MaterializationCase = {
  operation: ProtocolOperation;
  context: KeeperPlanContext;
  keys: readonly ExpectedMeta[];
  body?: Buffer;
};

describe("exact v4 Anchor IDL keeper adapter", () => {
  it("locks the checked-in final protocol interface", async () => {
    const adapter = await createAdapter();
    expect(adapter.idlHash).toBe(FINAL_IDL_SHA256);
    expect(KEEPER_EXPECTED_IDL_SHA256).toBe(FINAL_IDL_SHA256);
  });

  it("keeps the ephemeral undelegation callback accounts constrained", () => {
    const idl = JSON.parse(
      readFileSync(
        new URL("../../client/src/chain/idl/solana.json", import.meta.url),
        "utf8",
      ),
    ) as {
      instructions: Array<{
        name: string;
        accounts: Array<{
          name: string;
          address?: string;
          pda?: {
            seeds: Array<{ kind: string; path?: string; value?: number[] }>;
            program?: { kind: string; value?: number[] };
          };
        }>;
      }>;
    };
    const instruction = idl.instructions.find(
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
    expect(buffer?.pda?.program?.value).toHaveLength(32);
    expect(systemProgram?.address).toBe(SystemProgram.programId.toBase58());
  });

  it("materializes every keeper protocol operation with exact bytes and metas", async () => {
    const adapter = await createAdapter();
    const keeper = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const otherWinner = Keypair.generate().publicKey;
    const rulesCatalog = rulesCatalogPda(7);
    const daily = arenaDailyPda(DAY);
    const season = seasonPda(SEASON);
    const activeRun = activeRunPda(owner, RUN_ID);
    const caller = meta(keeper, false, true);
    const payer = meta(keeper, true, true);
    const winner = meta(owner, true, false);
    const winnerTwo = meta(otherWinner, true, false);

    const cases: readonly MaterializationCase[] = [
      {
        operation: "prepare_arena_daily",
        context: { dayId: DAY, followingDayId: DAY + 1, rulesCatalog },
        body: u32(DAY + 1),
        keys: [
          meta(protocolPda()),
          meta(arcadeConfigPda()),
          meta(rulesCatalog),
          meta(arenaDailyPda(DAY + 1), true),
          payer,
          caller,
          meta(SystemProgram.programId),
        ],
      },
      {
        operation: "prepare_weekly_jackpot",
        context: { weekId: WEEK, followingWeekId: WEEK + 1, rulesCatalog },
        body: u32(WEEK + 1),
        keys: [
          meta(protocolPda()),
          meta(arcadeConfigPda()),
          meta(rulesCatalog),
          meta(weeklyJackpotPda(WEEK + 1), true),
          payer,
          caller,
          meta(SystemProgram.programId),
        ],
      },
      {
        operation: "prepare_season",
        context: { seasonId: SEASON, followingSeasonId: SEASON + 1 },
        body: u32(SEASON + 1),
        keys: [
          meta(protocolPda()),
          meta(arcadeConfigPda()),
          meta(seasonPda(SEASON + 1), true),
          payer,
          caller,
          meta(SystemProgram.programId),
        ],
      },
      {
        operation: "activate_arena_daily",
        context: { dayId: DAY },
        keys: [meta(protocolPda()), meta(daily, true), caller],
      },
      {
        operation: "activate_weekly_jackpot",
        context: { weekId: WEEK },
        keys: [meta(protocolPda()), meta(weeklyJackpotPda(WEEK), true), caller],
      },
      {
        operation: "activate_season",
        context: { seasonId: SEASON },
        keys: [meta(protocolPda()), meta(season, true), caller],
      },
      {
        operation: "force_finish_deadline",
        context: runContext(owner, "ranked", "ephemeral_rollup", true),
        keys: [meta(activeRun, true), caller],
      },
      {
        operation: "commit_run",
        context: runContext(owner, "ranked", "ephemeral_rollup", true),
        keys: [
          payer,
          meta(activeRun, true),
          meta(MAGIC_CONTEXT, true),
          meta(MAGIC_PROGRAM),
        ],
      },
      {
        operation: "consume_campaign_run",
        context: {
          owner,
          runId: RUN_ID,
          runMode: "campaign",
          runLocation: "base",
          includeArenaPlayer: false,
        },
        keys: [
          meta(activeRun, true),
          meta(playerStatePda(owner), true),
          meta(owner),
          meta(playerFundingPda(owner), true),
        ],
      },
      {
        operation: "consume_arena_run",
        context: runContext(owner, "ranked", "base", true),
        keys: [
          meta(playerStatePda(owner), true),
          meta(daily, true),
          meta(arenaPlayerPda(daily, owner), true),
          meta(weeklyJackpotPda(WEEK), true),
          meta(activeRun, true),
          meta(playerFundingPda(owner), true),
        ],
      },
      {
        operation: "consume_practice_run",
        context: runContext(owner, "practice", "base", false),
        keys: [
          meta(playerStatePda(owner), true),
          meta(daily),
          meta(ZKUBE_PROGRAM_ID),
          meta(activeRun, true),
          meta(playerFundingPda(owner), true),
        ],
      },
      {
        operation: "expire_unresolved_arena_run",
        context: runContext(owner, "ranked", "unavailable", true),
        body: u64(RUN_ID),
        keys: [
          meta(playerStatePda(owner), true),
          meta(daily, true),
          meta(arenaPlayerPda(daily, owner), true),
          meta(owner),
          caller,
        ],
      },
      {
        operation: "cleanup_orphan_active_run",
        context: runContext(owner, "ranked", "base", true),
        keys: [
          meta(activeRun, true),
          meta(playerStatePda(owner), true),
          meta(playerFundingPda(owner), true),
          caller,
        ],
      },
      {
        operation: "initialize_season_player",
        context: { seasonId: SEASON, owner },
        keys: [
          meta(season),
          meta(seasonPlayerPda(season, owner), true),
          meta(owner),
          payer,
          meta(SystemProgram.programId),
        ],
      },
      {
        operation: "rollup_arena_to_season",
        context: { dayId: DAY, seasonId: SEASON, owner },
        keys: [
          meta(daily, true),
          meta(season, true),
          meta(seasonPlayerPda(season, owner), true),
          meta(arenaPlayerPda(daily, owner), true),
          caller,
        ],
      },
      {
        operation: "seal_arena_season_rollups",
        context: { dayId: DAY, seasonId: SEASON },
        keys: [meta(daily, true), meta(season, true), caller],
      },
      {
        operation: "finalize_arena_daily",
        context: {
          dayId: DAY,
          followingDayId: DAY + 1,
          owners: [owner, otherWinner],
        },
        keys: [
          meta(daily, true),
          meta(arenaDailyPda(DAY + 1), true),
          caller,
          winner,
          winnerTwo,
        ],
      },
      {
        operation: "finalize_weekly_jackpot",
        context: {
          weekId: WEEK,
          finalDayId: weekStartDay(WEEK) + 6,
          followingWeekId: WEEK + 1,
          owners: [owner, otherWinner],
        },
        keys: [
          meta(weeklyJackpotPda(WEEK), true),
          meta(arenaDailyPda(weekStartDay(WEEK) + 6)),
          meta(weeklyJackpotPda(WEEK + 1), true),
          caller,
          winner,
          winnerTwo,
        ],
      },
      {
        operation: "finalize_season",
        context: {
          seasonId: SEASON,
          followingSeasonId: SEASON + 1,
          owners: [owner, otherWinner],
        },
        keys: [
          meta(season, true),
          meta(seasonPda(SEASON + 1), true),
          caller,
          winner,
          winnerTwo,
        ],
      },
      {
        operation: "sync_daily_profile",
        context: {
          competition: "daily",
          dayId: DAY,
          owner,
          winnerPositionMask: 1,
        },
        keys: [caller, meta(daily, true), meta(playerStatePda(owner), true)],
      },
      {
        operation: "sync_weekly_profile",
        context: {
          competition: "weekly",
          weekId: WEEK,
          owner,
          winnerPositionMask: 1,
        },
        keys: [
          caller,
          meta(weeklyJackpotPda(WEEK), true),
          meta(playerStatePda(owner), true),
        ],
      },
      {
        operation: "sync_season_profile",
        context: {
          competition: "season",
          seasonId: SEASON,
          owner,
          winnerPositionMask: 1,
        },
        keys: [caller, meta(season, true), meta(playerStatePda(owner), true)],
      },
    ];

    expect(new Set(cases.map(({ operation }) => operation)).size).toBe(22);
    for (const fixture of cases) {
      const [instruction] = await adapter.materialize({
        operation: fixture.operation,
        context: fixture.context,
        programId: ZKUBE_PROGRAM_ID,
        keeper,
      });
      expect(instruction, fixture.operation).toBeDefined();
      expect(instruction!.programId.equals(ZKUBE_PROGRAM_ID), fixture.operation).toBe(true);
      expect(instruction!.keys, fixture.operation).toEqual(fixture.keys);
      expect(
        instruction!.data.subarray(0, 8),
        fixture.operation,
      ).toEqual(discriminator(fixture.operation));
      expect(
        instruction!.data.subarray(8),
        fixture.operation,
      ).toEqual(fixture.body ?? Buffer.alloc(0));
    }
  });

  it("rejects an instruction request for any unpinned program", async () => {
    const adapter = await createAdapter();
    await expect(adapter.materialize({
      operation: "activate_arena_daily",
      context: { dayId: DAY },
      programId: Keypair.generate().publicKey,
      keeper: Keypair.generate().publicKey,
    })).rejects.toThrow("unpinned program");
  });
});

async function createAdapter(): Promise<AnchorKeeperAdapter> {
  return AnchorKeeperAdapter.create({
    connection: new Connection("http://127.0.0.1:8899", "confirmed"),
    nowUnix: DAY * 86_400,
  });
}

function runContext(
  owner: PublicKey,
  runMode: "ranked" | "practice",
  runLocation: "base" | "ephemeral_rollup" | "unavailable",
  includeArenaPlayer: boolean,
): KeeperPlanContext {
  return {
    challengeDayId: DAY,
    deadlineDayId: runMode === "ranked" ? DAY : DAY + 1,
    owner,
    runId: RUN_ID,
    runMode,
    runLocation,
    includeArenaPlayer,
  };
}

function meta(
  pubkey: PublicKey,
  isWritable = false,
  isSigner = false,
): ExpectedMeta {
  return { pubkey, isWritable, isSigner };
}

function discriminator(operation: ProtocolOperation): Buffer {
  return createHash("sha256")
    .update(`global:${operation}`)
    .digest()
    .subarray(0, 8);
}

function u32(value: number): Buffer {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value);
  return output;
}

function u64(value: bigint): Buffer {
  const output = Buffer.alloc(8);
  output.writeBigUInt64LE(value);
  return output;
}
