// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { convertIdlToCamelCase, type Idl } from "@anchor-lang/core";
import BN from "bn.js";
import { describe, expect, it } from "vitest";

import {
  AnchorKeeperAdapter,
  canonicalCadenceResultHash,
  KEEPER_EXPECTED_IDL_SHA256,
} from "../src/anchorIdlAdapter";
import {
  ZKUBE_PROGRAM_ID,
  ARCADE_ACCOUNT_VERSION,
  DAILY_ENTRY_CLOSE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  activeRunPda,
  arcadeConfigPda,
  arcadeArchivePda,
  arenaDailyPda,
  arenaPlayerPda,
  playerFundingPda,
  cadenceFundingPda,
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
  "8f22022034d137de95b8e44be24182512f00103ca18c7c58f601f92b6454491a";
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
    const weeklyFinalDay = weekStartDay(WEEK) + 6;
    const weeklyQualificationDays = Array.from(
      { length: weeklyFinalDay - DAY + 1 },
      (_, offset) => DAY + offset,
    );
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
          meta(arcadeArchivePda()),
          meta(rulesCatalog),
          meta(arenaDailyPda(DAY + 1), true),
          meta(cadenceFundingPda(), true),
          caller,
          meta(SystemProgram.programId),
          meta(ZKUBE_PROGRAM_ID),
        ],
      },
      {
        operation: "prepare_weekly_jackpot",
        context: { weekId: WEEK, followingWeekId: WEEK + 1, rulesCatalog },
        body: u32(WEEK + 1),
        keys: [
          meta(protocolPda()),
          meta(arcadeConfigPda()),
          meta(arcadeArchivePda()),
          meta(rulesCatalog),
          meta(weeklyJackpotPda(WEEK + 1), true),
          meta(cadenceFundingPda(), true),
          caller,
          meta(SystemProgram.programId),
          meta(ZKUBE_PROGRAM_ID),
        ],
      },
      {
        operation: "prepare_season",
        context: { seasonId: SEASON, followingSeasonId: SEASON + 1 },
        body: u32(SEASON + 1),
        keys: [
          meta(protocolPda()),
          meta(arcadeConfigPda()),
          meta(arcadeArchivePda()),
          meta(seasonPda(SEASON + 1), true),
          meta(cadenceFundingPda(), true),
          caller,
          meta(SystemProgram.programId),
          meta(ZKUBE_PROGRAM_ID),
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
        operation: "expire_unresolved_practice_run",
        context: runContext(owner, "practice", "unavailable", false),
        body: u64(RUN_ID),
        keys: [
          meta(playerStatePda(owner), true),
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
          finalDayId: weeklyFinalDay,
          qualificationStartDay: DAY,
          qualificationDayIds: weeklyQualificationDays,
          followingWeekId: WEEK + 1,
          owners: [owner, otherWinner],
        },
        keys: [
          meta(weeklyJackpotPda(WEEK), true),
          meta(weeklyJackpotPda(WEEK + 1), true),
          meta(arcadeArchivePda()),
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
      {
        operation: "archive_arena_daily",
        context: { dayId: DAY },
        keys: [meta(arcadeArchivePda(), true), meta(daily), caller],
      },
      {
        operation: "archive_weekly_jackpot",
        context: { weekId: WEEK },
        keys: [
          meta(arcadeArchivePda(), true),
          meta(weeklyJackpotPda(WEEK)),
          caller,
        ],
      },
      {
        operation: "archive_season",
        context: { seasonId: SEASON },
        keys: [meta(arcadeArchivePda(), true), meta(season), caller],
      },
      {
        operation: "close_arena_daily",
        context: { dayId: DAY },
        keys: [
          meta(arcadeArchivePda()),
          meta(daily, true),
          meta(cadenceFundingPda(), true),
          caller,
        ],
      },
      {
        operation: "close_weekly_jackpot",
        context: { weekId: WEEK },
        keys: [
          meta(arcadeArchivePda()),
          meta(weeklyJackpotPda(WEEK), true),
          meta(cadenceFundingPda(), true),
          caller,
        ],
      },
      {
        operation: "close_season",
        context: { seasonId: SEASON },
        keys: [
          meta(arcadeArchivePda()),
          meta(season, true),
          meta(cadenceFundingPda(), true),
          caller,
        ],
      },
      {
        operation: "close_arena_player",
        context: {
          dayId: DAY,
          owner,
          rentRecipient: playerFundingPda(owner),
        },
        keys: [
          meta(daily),
          meta(arenaPlayerPda(daily, owner), true),
          meta(playerFundingPda(owner), true),
          caller,
        ],
      },
      {
        operation: "close_season_player",
        context: {
          seasonId: SEASON,
          owner,
          rentRecipient: playerFundingPda(owner),
        },
        keys: [
          meta(season),
          meta(seasonPlayerPda(season, owner), true),
          meta(playerFundingPda(owner), true),
          caller,
        ],
      },
    ];

    expect(new Set(cases.map(({ operation }) => operation)).size).toBe(31);
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

  it("matches Rust archive result-hash golden vectors", () => {
    const raw = JSON.parse(
      readFileSync(
        new URL("../../client/src/chain/idl/solana.json", import.meta.url),
        "utf8",
      ),
    ) as Idl;
    const idl = convertIdlToCamelCase(raw);
    const arcadeConfig = new PublicKey(Uint8Array.from({ length: 32 }, () => 9));
    const goldenDay = 20_656;
    const goldenWeek = weekIdForDay(goldenDay);
    const goldenSeason = seasonIdForDay(goldenDay);
    const zeroLedger = {
      seededLamports: new BN(0),
      entryLamports: new BN(0),
      rolloverInLamports: new BN(0),
      payoutLamports: new BN(0),
      rolloverOutLamports: new BN(0),
    };
    const opensAt = goldenDay * 86_400;
    const daily = {
      version: ARCADE_ACCOUNT_VERSION,
      dayId: goldenDay,
      weekId: goldenWeek,
      seasonId: goldenSeason,
      arcadeConfig,
      rulesVersion: 1,
      contentVersion: 1,
      catalogHash: Array(32).fill(1),
      rulesHash: Array(32).fill(2),
      mapId: 1,
      scoringRule: {
        id: 0,
        family: 0,
        kind: 0,
        parameter: 0,
        bonusMultiplierX100: 0,
      },
      rules: {
        level: 0,
        pointsRequired: 0,
        maxMoves: 0,
        difficulty: 0,
        primary: { kind: 0, value: 0, requiredCount: 0 },
        secondary: { kind: 0, value: 0, requiredCount: 0 },
        activeMutatorId: 0,
        passiveMutatorId: 0,
        bossId: 0,
        blockWeights: [0, 0, 0, 0, 0],
        scoreMultiplierX100: 0,
        comboMultiplierX100: 0,
        lineClearBonus: 0,
        perfectClearBonus: 0,
        starThresholdModifier: 0,
        bonusType: 0,
        bonusTriggerType: 0,
        bonusThreshold: 0,
        startingCharges: 0,
        startingRows: 0,
      },
      pressure: {
        thresholds: [8, 18, 30, 42, 54, 66, 78],
        scoreMultipliersX100: [100, 110, 125, 140, 160, 180, 210, 250],
        blockWeights: [
          [25, 30, 25, 15, 5],
          [22, 28, 25, 18, 7],
          [20, 25, 25, 20, 10],
          [18, 22, 24, 22, 14],
          [16, 20, 22, 24, 18],
          [14, 18, 20, 26, 22],
          [12, 16, 18, 28, 26],
          [10, 14, 16, 30, 30],
        ],
        startingHeight: 4,
        maxMoves: 100,
      },
      opensAt: new BN(opensAt),
      entriesCloseAt: new BN(opensAt + DAILY_ENTRY_CLOSE_OFFSET),
      runsCloseAt: new BN(opensAt + DAILY_RUN_CLOSE_OFFSET),
      finalizedAt: new BN(opensAt + DAILY_RUN_CLOSE_OFFSET),
      ledger: zeroLedger,
      entriesPaid: new BN(0),
      entriesScored: new BN(0),
      entriesExpired: new BN(0),
      uniquePlayers: 0,
      seasonEligiblePlayers: 0,
      entries: [],
    };
    const dailyResultHash = canonicalCadenceResultHash(idl, "daily", daily);
    expect(dailyResultHash).toBe(
      "3c7f85e915d5745256cadbc5e3195bea61f4a918402d5f68d49b2faa13a0eb8e",
    );
    expect(canonicalCadenceResultHash(idl, "daily", {
      ...daily,
      profileSyncMask: 0x1f,
      seasonRollups: 1,
      seasonRollupSealed: true,
    })).toBe(dailyResultHash);

    expect(canonicalCadenceResultHash(idl, "weekly", {
      version: ARCADE_ACCOUNT_VERSION,
      weekId: goldenWeek,
      qualificationStartDay: goldenDay,
      arcadeConfig,
      metrics: [
        { highestCombo: {} },
        { highestActionScore: {} },
        { totalLines: {} },
      ],
      rulesHash: Array(32).fill(4),
      opensAt: new BN(10),
      closesAt: new BN(20),
      finalizedAt: new BN(30),
      ledger: zeroLedger,
      comboEntries: [],
      actionEntries: [],
      runEntries: [],
    })).toBe(
      "848bf2b103f87341c8d6f5eec636e52f890111e00d12b6b130dd8e9ad711cbf3",
    );
    expect(canonicalCadenceResultHash(idl, "season", {
      version: ARCADE_ACCOUNT_VERSION,
      seasonId: goldenSeason,
      qualificationStartDay: goldenDay,
      arcadeConfig,
      opensAt: new BN(40),
      closesAt: new BN(50),
      finalizedAt: new BN(60),
      ledger: zeroLedger,
      entries: [],
    })).toBe(
      "bde74719a008e0341f9a23682984ed077e3817d87c14cda1506fae4fe1eed247",
    );
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
  const instruction = {
    prepare_arena_daily: "funded_prepare_arena_daily",
    prepare_weekly_jackpot: "funded_prepare_weekly_jackpot",
    prepare_season: "funded_prepare_season",
  }[operation] ?? operation;
  return createHash("sha256")
    .update(`global:${instruction}`)
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
