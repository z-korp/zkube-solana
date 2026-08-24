import { createHash } from "node:crypto";

import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  SECONDS_PER_DAY,
  ZKUBE_PROGRAM_ID,
  arcadeArchivePda,
  arenaDailyPda,
  arenaBoardPda,
  cadenceFundingPda,
  dailyContentSelection,
  playerFundingPda,
  rulesCatalogPda,
  validationOnlyPlan,
  type KeeperInstructionPlan,
  type KeeperPlanContext,
} from "../src/arcadeChain";
import { cadenceResultHash, canonicalArchive } from "../src/archiveContract";
import { assertKeeperPlanPolicy } from "../src/keeperPolicy";

const DAY = 20_651;
const NOW = DAY * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET + 1;
const KEEPER = Keypair.generate().publicKey;

describe("v5 keeper semantic policy", () => {
  it("accepts only the exact missing Daily successor", () => {
    const catalogStartsDay = DAY - 10;
    const poolEntries = Array.from({ length: 10 }, (_, index) => ({
      realmMapId: index + 1,
      passiveMapId: index + 1,
    }));
    const content = dailyContentSelection(
      catalogStartsDay,
      DAY,
      poolEntries.length,
    );
    const selected = poolEntries[content.poolIndex]!;
    const plan = validationOnlyPlan("prepare_arena_daily", {
      dayId: DAY - 1,
      followingDayId: DAY,
      launchCadenceId: DAY - 10,
      rulesCatalog: rulesCatalogPda(1),
      contentVersion: 2,
      catalogStartsDay,
      poolEntryCount: poolEntries.length,
      poolEntries,
      realmMapId: selected.realmMapId,
      passiveMapId: selected.passiveMapId,
      ...content,
      cadenceFunding: cadenceFundingPda(),
    });
    expect(() => policy(plan, DAY * SECONDS_PER_DAY + 1)).not.toThrow();
    plan.context!.followingDayId = DAY + 1;
    expect(() => policy(plan, DAY * SECONDS_PER_DAY + 1)).toThrow("preparation");
  });

  it("allows current activation before close and exact following preactivation", () => {
    expect(() => policy(validationOnlyPlan("activate_arena_daily", {
      dayId: DAY,
      rulesCatalog: rulesCatalogPda(1),
      catalogStartsDay: DAY - 10,
      poolEntryCount: 10,
    }), DAY * SECONDS_PER_DAY + 1)).not.toThrow();
    expect(() => policy(validationOnlyPlan("activate_arena_daily", {
      dayId: DAY + 1,
      rulesCatalog: rulesCatalogPda(1),
      preactivation: true,
      catalogStartsDay: DAY - 10,
      poolEntryCount: 10,
    }), DAY * SECONDS_PER_DAY + 1)).not.toThrow();
    expect(() => policy(validationOnlyPlan("activate_arena_daily", {
      dayId: DAY + 1,
      rulesCatalog: rulesCatalogPda(1),
      catalogStartsDay: DAY - 10,
      poolEntryCount: 10,
    }), DAY * SECONDS_PER_DAY + 1)).toThrow("preactivation");
  });

  it("pins ranked run routing and deadlines", () => {
    const context = rankedContext();
    expect(() => policy(validationOnlyPlan("force_finish_deadline", context)))
      .not.toThrow();
    context.runLocation = "base";
    expect(() => policy(validationOnlyPlan("force_finish_deadline", context)))
      .toThrow("routing");
  });

  it("cleans a Campaign orphan without a recovery deadline, on base only", () => {
    const context: KeeperPlanContext = {
      owner: Keypair.generate().publicKey,
      runId: 1n,
      runMode: "campaign",
      runLocation: "base",
      includeArenaPlayer: false,
    };
    expect(() => policy(validationOnlyPlan("cleanup_orphan_active_run", context)))
      .not.toThrow();
    expect(() => policy(validationOnlyPlan("cleanup_orphan_active_run", {
      ...context,
      runLocation: "ephemeral_rollup",
    }))).toThrow("routing");
  });

  it("rejects non-floored or non-conserving Daily payouts", () => {
    const context: KeeperPlanContext = {
      competition: "daily",
      dayId: DAY,
      followingDayId: DAY + 1,
      scorePayoutCount: 1,
      themePayoutCount: 0,
      scoreCapacityLimited: false,
      themeCapacityLimited: false,
      payoutTotalLamports: 9_000_000n,
      rolloverLamports: 1_000_000n,
      potLamports: 10_000_000n,
      cadenceFunding: cadenceFundingPda(),
    };
    expect(() => policy(validationOnlyPlan("finalize_arena_daily", context)))
      .not.toThrow();
    context.payoutTotalLamports = 9_500_000n;
    context.rolloverLamports = 500_000n;
    expect(() => policy(validationOnlyPlan("finalize_arena_daily", context)))
      .toThrow("conservation");
  });

  it("limits profile sync to canonical Daily winner bits", () => {
    const owner = Keypair.generate().publicKey;
    expect(() => policy(validationOnlyPlan("sync_daily_profile", {
      competition: "daily",
      dayId: DAY,
      owner,
      boardKind: "score",
      winnerPositionMask: 0x10n,
    }))).not.toThrow();
    expect(() => policy(validationOnlyPlan("sync_daily_profile", {
      competition: "daily",
      dayId: DAY,
      owner,
      boardKind: "score",
      winnerPositionMask: 1n << 1_536n,
    }))).toThrow("profile sync");
  });

  it("pins sequential Daily archive and closure bytes", () => {
    const archive = archiveContext(false);
    expect(() => policy(validationOnlyPlan("archive_arena_daily", archive)))
      .not.toThrow();
    const closing = archiveContext(true);
    expect(() => policy(validationOnlyPlan("close_arena_daily", closing)))
      .not.toThrow();
    archive.archiveFileSha256 = "00".repeat(32);
    expect(() => policy(validationOnlyPlan("archive_arena_daily", archive)))
      .toThrow("file hash");
  });

  it("pins ArenaPlayer cleanup to the owner funding PDA", () => {
    const owner = Keypair.generate().publicKey;
    const context: KeeperPlanContext = {
      competition: "daily",
      dayId: DAY,
      owner,
      rentRecipient: playerFundingPda(owner),
    };
    expect(() => policy(validationOnlyPlan("close_arena_player", context)))
      .not.toThrow();
    context.rentRecipient = Keypair.generate().publicKey;
    expect(() => policy(validationOnlyPlan("close_arena_player", context)))
      .toThrow("cleanup recipient");
  });

  it("rejects executable bytes before generated-IDL materialization", () => {
    const plan = validationOnlyPlan("activate_arena_daily", { dayId: DAY });
    plan.execution = "instruction";
    expect(() => policy(plan)).toThrow("unvalidated instruction bytes");
  });
});

function policy(plan: KeeperInstructionPlan, nowUnix = NOW): void {
  assertKeeperPlanPolicy({
    plan,
    keeper: KEEPER,
    programId: ZKUBE_PROGRAM_ID,
    connection: {} as Connection,
    nowUnix,
  });
}

function rankedContext(): KeeperPlanContext {
  return {
    owner: Keypair.generate().publicKey,
    runId: 1n,
    runMode: "ranked",
    runLocation: "ephemeral_rollup",
    includeArenaPlayer: true,
    challengeDayId: DAY,
    deadlineDayId: DAY,
    deadlineAt: DAY * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
    recoveryDeadlineAt: DAY * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
  };
}

function archiveContext(committed: boolean): KeeperPlanContext {
  const resultData = Buffer.from("daily-result");
  const daily = arenaDailyPda(DAY);
  const canonicalJson = canonicalArchive({
    account: daily,
    accountData: Buffer.alloc(10, 1),
    scoreBoard: arenaBoardPda(daily, "score"),
    scoreBoardData: Buffer.alloc(129, 2),
    themeBoard: arenaBoardPda(daily, "theme"),
    themeBoardData: Buffer.alloc(129, 3),
    competition: "daily",
    periodId: DAY,
    programId: ZKUBE_PROGRAM_ID,
    resultData,
    root: "02".repeat(32),
  });
  return {
    competition: "daily",
    dayId: DAY,
    archiveFirstCadenceId: DAY,
    previousCadenceId: committed ? DAY : DAY - 1,
    archiveCurrentRoot: committed ? "02".repeat(32) : "00".repeat(32),
    cadenceFunding: cadenceFundingPda(),
    arcadeArchive: arcadeArchivePda(),
    ...(committed ? {} : {
      archiveCanonicalJson: canonicalJson,
      archiveFileSha256: createHash("sha256").update(canonicalJson).digest("hex"),
    }),
    archiveResultHash: cadenceResultHash("daily", resultData),
    archiveCommitted: committed,
    claimsExpired: committed,
    requiredScoreProfileSyncMask: 0n,
    requiredThemeProfileSyncMask: 0n,
    closeEligibleAt: DAY * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
  };
}
