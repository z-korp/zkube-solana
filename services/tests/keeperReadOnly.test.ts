// @vitest-environment node
import {
  Keypair,
  SystemProgram,
  TransactionInstruction,
  type AccountInfo,
  type PublicKey,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  SECONDS_PER_DAY,
  ZKUBE_PROGRAM_ID,
  arcadeArchivePda,
  arenaDailyPda,
  cadenceFundingPda,
  playerFundingPda,
  rulesCatalogPda,
  seasonIdForDay,
  seasonStartDay,
  weekIdForDay,
  weekStartDay,
  weeklyJackpotPda,
} from "../src/arcadeChain";
import {
  cadenceResultHash,
  canonicalArchiveV2,
} from "../src/archiveContract";
import { ArchiveIntegrityError, archiveSha256 } from "../src/archiveStore";
import type { ProtocolSnapshot } from "../src/arcadeReconciliation";
import { runKeeperPass } from "../src/keeper";
import {
  SESSION_KEYS_PROGRAM_ID,
  deriveSessionPda,
} from "../src/sessionCleanup";

describe("keeper read-only planning", () => {
  it("materializes current activation and successor preparation without signing", async () => {
    const log = vi.fn();
    const keeper = Keypair.generate();
    const connection = {
      getBalance: vi.fn().mockResolvedValue(0),
      getProgramAccounts: vi.fn().mockResolvedValue([]),
      getMultipleAccountsInfo: vi.fn().mockResolvedValue([]),
    } as never;
    const dayId = 20_651;
    const result = await runKeeperPass({
      connection,
      keeper,
      writeEnabled: false,
      now: () => (dayId * SECONDS_PER_DAY + 10) * 1_000,
      protocolSnapshot: {
        paused: false,
        launchDayId: dayId,
        rulesCatalog: rulesCatalogPda(1),
        dailies: [{
          dayId,
          status: "funding",
          runsCloseAt: dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
          recoveryDeadlineAt:
            dayId * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
          entriesPaid: 0n,
          entriesScored: 0n,
          entriesExpired: 0n,
          potLamports: 0n,
          predecessorRolloverRequired: false,
          predecessorRolloverApplied: false,
          seasonEligiblePlayers: 0,
          seasonRollups: 0,
          seasonRollupSealed: false,
          profileSyncMask: 0,
        }],
        weeklies: [],
        seasons: [],
        runs: [],
        dailySeasonPlayers: [],
        playerStateOwners: [],
        arenaPlayerClosures: [],
        seasonPlayerClosures: [],
      },
      protocolMaterializer: {
        materialize: async () => [new TransactionInstruction({
          programId: ZKUBE_PROGRAM_ID,
          keys: [{ pubkey: keeper.publicKey, isSigner: true, isWritable: false }],
          data: Buffer.alloc(8),
        })],
      },
      log,
    });
    expect(result).toMatchObject({
      writes: 0,
      plannedWrites: 2,
      reserveLow: true,
      operationFailures: 0,
    });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      event: "keeper_plan",
      operation: "activate_arena_daily",
    }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      event: "keeper_plan",
      operation: "prepare_arena_daily",
    }));
  });

  it("keeps finalized profile-sync backlog inside the eight-write pass bound", async () => {
    const log = vi.fn();
    const keeper = Keypair.generate();
    const connection = {
      getBalance: vi.fn().mockResolvedValue(0),
      getProgramAccounts: vi.fn().mockResolvedValue([]),
      getMultipleAccountsInfo: vi.fn().mockResolvedValue([]),
    } as never;
    const dayId = 20_651;
    const launchDayId = dayId - 8;
    const owners = Array.from({ length: 9 }, () => Keypair.generate().publicKey);
    const dailies = owners.map((owner, index) => {
      const cadence = launchDayId + index;
      return {
        dayId: cadence,
        status: "finalized" as const,
        runsCloseAt: cadence * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
        recoveryDeadlineAt:
          cadence * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
        entriesPaid: 1n,
        entriesScored: 1n,
        entriesExpired: 0n,
        potLamports: 10_000_000n,
        predecessorRolloverRequired: cadence !== launchDayId,
        predecessorRolloverApplied: cadence !== launchDayId,
        seasonEligiblePlayers: 0,
        seasonRollups: 0,
        seasonRollupSealed: true,
        profileSyncMask: 0,
        settlement: {
          winners: [{
            owner,
            payoutLamports: 10_000_000n,
            rank: 1,
            destinationValid: true,
          }],
          rolloverLamports: 0n,
        },
      };
    });
    const result = await runKeeperPass({
      connection,
      keeper,
      writeEnabled: false,
      now: () => (dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET) * 1_000,
      protocolSnapshot: {
        paused: false,
        launchDayId,
        rulesCatalog: rulesCatalogPda(1),
        dailies,
        weeklies: [],
        seasons: [],
        runs: [],
        dailySeasonPlayers: [],
        playerStateOwners: owners,
        arenaPlayerClosures: [],
        seasonPlayerClosures: [],
      },
      protocolMaterializer: {
        materialize: async () => [new TransactionInstruction({
          programId: ZKUBE_PROGRAM_ID,
          keys: [{ pubkey: keeper.publicKey, isSigner: true, isWritable: false }],
          data: Buffer.alloc(8),
        })],
      },
      log,
    });
    expect(result).toMatchObject({
      writes: 0,
      plannedWrites: 8,
      maxWrites: 8,
      backlog: 2,
    });
    expect(log.mock.calls.filter(([event]) =>
      event.event === "keeper_plan" && event.operation === "sync_daily_profile"
    )).toHaveLength(7);
  });

  it("closes at most two finalized participant accounts per pass", async () => {
    const log = vi.fn();
    const keeper = Keypair.generate();
    const connection = {
      getBalance: vi.fn().mockResolvedValue(0),
      getProgramAccounts: vi.fn().mockResolvedValue([]),
      getMultipleAccountsInfo: vi.fn().mockResolvedValue([]),
    } as never;
    const dayId = 20_651;
    const launchDayId = dayId - 2;
    const owners = Array.from({ length: 3 }, () => Keypair.generate().publicKey);
    const dailies = owners.map((_, index) => {
      const cadence = launchDayId + index;
      return {
        dayId: cadence,
        status: "finalized" as const,
        runsCloseAt: cadence * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
        recoveryDeadlineAt:
          cadence * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
        entriesPaid: 0n,
        entriesScored: 0n,
        entriesExpired: 0n,
        potLamports: 0n,
        predecessorRolloverRequired: cadence !== launchDayId,
        predecessorRolloverApplied: cadence !== launchDayId,
        seasonEligiblePlayers: 0,
        seasonRollups: 0,
        seasonRollupSealed: true,
        profileSyncMask: 0,
      };
    });
    const result = await runKeeperPass({
      connection,
      keeper,
      writeEnabled: false,
      now: () => (dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET) * 1_000,
      protocolSnapshot: {
        paused: false,
        launchDayId,
        rulesCatalog: rulesCatalogPda(1),
        dailies,
        weeklies: [],
        seasons: [],
        runs: [],
        dailySeasonPlayers: [],
        playerStateOwners: [],
        arenaPlayerClosures: owners.map((owner, index) => ({
          dayId: launchDayId + index,
          owner,
          rentRecipient: playerFundingPda(owner),
        })),
        seasonPlayerClosures: [],
      },
      protocolMaterializer: {
        materialize: async () => [new TransactionInstruction({
          programId: ZKUBE_PROGRAM_ID,
          keys: [{ pubkey: keeper.publicKey, isSigner: true, isWritable: false }],
          data: Buffer.alloc(8),
        })],
      },
      log,
    });
    expect(result).toMatchObject({ plannedWrites: 3, backlog: 1 });
    expect(log.mock.calls.filter(([event]) =>
      event.event === "keeper_plan" && event.operation === "close_arena_player"
    )).toHaveLength(2);
  });

  it("quarantines one archive integrity failure and continues an independent Weekly", async () => {
    const log = vi.fn();
    const materialize = vi.fn(async () => [instruction()]);
    const snapshot = archiveIsolationSnapshot();
    const prepareArchive = vi.fn(async (plan) => {
      if (plan.operation === "archive_arena_daily") {
        throw new ArchiveIntegrityError(
          "existing_archive_invalid",
          "daily",
          20_660,
          "existing cadence archive is invalid",
        );
      }
    });
    const result = await runKeeperPass({
      connection: readOnlyConnection(),
      keeper: Keypair.generate(),
      writeEnabled: false,
      now: () => 20_661 * SECONDS_PER_DAY * 1_000,
      protocolSnapshot: snapshot,
      protocolMaterializer: { materialize },
      archiveStore: { prepare: prepareArchive },
      log,
    });

    expect(result).toMatchObject({
      ok: false,
      operationFailures: 1,
      archiveQuarantines: 1,
    });
    expect(log.mock.calls
      .map(([event]) => event)
      .filter((event) => event.event === "keeper_domain_quarantine")).toEqual([]);
    expect(prepareArchive).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "archive_weekly_jackpot" }),
    );
    expect(materialize).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: "sync_daily_profile",
    }));
    expect(materialize).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: "close_arena_player",
    }));
    expect(log.mock.calls
      .map(([event]) => event)
      .filter((event) => event.event === "keeper_dependency_suppressed")
      .map((event) => event.operation)).toEqual([
      "sync_daily_profile",
      "close_arena_player",
    ]);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      event: "keeper_archive_quarantine",
      operation: "archive_arena_daily",
      competition: "daily",
      cadenceId: 20_660,
      archiveIntegrityCode: "existing_archive_invalid",
      archiveFailureStage: "preparation",
    }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      event: "keeper_pass",
      archiveQuarantines: 1,
      ok: false,
    }));
  });

  it("backfills a full read-only window after archive preparation quarantine", async () => {
    const log = vi.fn();
    const materialize = vi.fn(async () => [instruction()]);
    const prepareArchive = vi.fn(async (plan) => {
      if (plan.operation === "archive_arena_daily") {
        throw new ArchiveIntegrityError(
          "existing_archive_invalid",
          "daily",
          20_660,
          "existing cadence archive is invalid",
        );
      }
    });
    const sessions = expiredSessions(3);
    const result = await runKeeperPass({
      connection: readOnlyConnection(sessions),
      keeper: Keypair.generate(),
      writeEnabled: false,
      now: recoveryNow,
      protocolSnapshot: archiveBackfillSnapshot(),
      protocolMaterializer: { materialize },
      archiveStore: { prepare: prepareArchive },
      log,
    });

    expect(result).toMatchObject({
      plannedWrites: 8,
      operationFailures: 1,
      archiveQuarantines: 1,
      maxWrites: 8,
      backlog: 0,
    });
    const planned = log.mock.calls
      .map(([event]) => event)
      .filter((event) => event.event === "keeper_plan");
    expect(planned).toHaveLength(8);
    expect(planned.map((event) => event.operation)).toEqual([
      "prepare_arena_daily",
      "prepare_weekly_jackpot",
      "activate_season",
      "archive_weekly_jackpot",
      "cleanup_orphan_active_run",
      "close_arena_player",
      "revoke_expired_session",
      "revoke_expired_session",
    ]);
    expect(planned.filter((event) =>
      event.operation === "revoke_expired_session"
    )).toHaveLength(2);
    expect(materialize).toHaveBeenCalledWith(expect.objectContaining({
      operation: "activate_season",
    }));
    expect(materialize).toHaveBeenCalledWith(expect.objectContaining({
      operation: "cleanup_orphan_active_run",
    }));
    expect(materialize).toHaveBeenCalledWith(expect.objectContaining({
      operation: "close_arena_player",
      context: expect.objectContaining({ dayId: 20_659 }),
    }));
    expect(materialize).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: "close_arena_player",
      context: expect.objectContaining({ dayId: 20_660 }),
    }));
    expect(log.mock.calls
      .map(([event]) => event)
      .filter((event) => event.event === "keeper_dependency_suppressed")
      .map((event) => [event.operation, event.cadenceId])).toEqual([
      ["sync_daily_profile", 20_660],
      ["close_arena_player", 20_660],
    ]);
  });

  it("does not charge cadence or participant closure quota after close preparation fails", async () => {
    const log = vi.fn();
    const materialize = vi.fn(async () => [instruction()]);
    const snapshot = archiveIsolationSnapshot();
    const daily = snapshot.dailies[0]!;
    const dailyCandidate = snapshot.archiveCandidates![0]!;
    const committedSnapshot: ProtocolSnapshot = {
      ...snapshot,
      dailies: [{
        ...daily,
        profileSyncMask: 1,
      }],
      archiveState: {
        ...snapshot.archiveState!,
        lastDailyId: daily.dayId,
      },
      archiveCandidates: [{
        ...dailyCandidate,
        committed: true,
        closeEligible: true,
      }, snapshot.archiveCandidates![1]!],
    };
    const prepareArchive = vi.fn(async (plan) => {
      if (plan.operation === "close_arena_daily") {
        throw new ArchiveIntegrityError(
          "missing_committed_archive",
          "daily",
          daily.dayId,
          "committed cadence archive file is missing",
        );
      }
    });

    const result = await runKeeperPass({
      connection: readOnlyConnection(),
      keeper: Keypair.generate(),
      writeEnabled: false,
      now: () => 20_661 * SECONDS_PER_DAY * 1_000,
      protocolSnapshot: committedSnapshot,
      protocolMaterializer: { materialize },
      archiveStore: { prepare: prepareArchive },
      log,
    });

    expect(result).toMatchObject({
      operationFailures: 1,
      archiveQuarantines: 1,
    });
    expect(prepareArchive).toHaveBeenCalledWith(expect.objectContaining({
      operation: "close_arena_daily",
      context: expect.objectContaining({ dayId: daily.dayId }),
    }));
    expect(materialize).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: "close_arena_daily",
    }));
    expect(materialize).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: "close_arena_player",
      context: expect.objectContaining({ dayId: daily.dayId }),
    }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      event: "keeper_dependency_suppressed",
      operation: "close_arena_player",
      cadenceId: daily.dayId,
    }));
  });

  it("quarantines dependent writes after an archive transaction failure", async () => {
    const log = vi.fn();
    const keeper = Keypair.generate();
    const connection = writeConnection();
    connection.sendRawTransaction.mockResolvedValue("keeper-signature");
    const materialize = vi.fn(async () => [instruction()]);
    const verifyAfterWrite = vi.fn(async (plan) => {
      if (plan.operation === "archive_arena_daily") {
        throw new Error("archive transaction failed");
      }
    });

    const result = await runKeeperPass({
      connection: connection as never,
      keeper,
      writeEnabled: true,
      now: () => 20_661 * SECONDS_PER_DAY * 1_000,
      protocolSnapshot: archiveIsolationSnapshot(),
      protocolMaterializer: { materialize },
      archiveStore: { prepare: vi.fn().mockResolvedValue(undefined) },
      verifyAfterWrite,
      log,
    });

    expect(result).toMatchObject({
      ok: false,
      operationFailures: 1,
      archiveQuarantines: 1,
    });
    expect(materialize).toHaveBeenCalledWith(expect.objectContaining({
      operation: "archive_weekly_jackpot",
    }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      event: "keeper_operation",
      operation: "archive_weekly_jackpot",
      ok: true,
    }));
    expect(materialize).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: "sync_daily_profile",
    }));
    expect(materialize).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: "close_arena_player",
    }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      event: "keeper_archive_quarantine",
      operation: "archive_arena_daily",
      competition: "daily",
      cadenceId: 20_660,
      archiveFailureStage: "transaction",
    }));
  });

  it("backfills a full write window after an archive transaction quarantine", async () => {
    const log = vi.fn();
    const keeper = Keypair.generate();
    const connection = writeConnection(expiredSessions(3));
    connection.sendRawTransaction.mockResolvedValue("keeper-signature");
    const materialize = vi.fn(async () => [instruction()]);
    const verifyAfterWrite = vi.fn(async (plan) => {
      if (plan.operation === "archive_arena_daily") {
        throw new Error("archive transaction failed");
      }
    });

    const result = await runKeeperPass({
      connection: connection as never,
      keeper,
      writeEnabled: true,
      now: recoveryNow,
      protocolSnapshot: archiveBackfillSnapshot(),
      protocolMaterializer: { materialize },
      archiveStore: { prepare: vi.fn().mockResolvedValue(undefined) },
      verifyAfterWrite,
      log,
    });

    expect(result).toMatchObject({
      writes: 7,
      plannedWrites: 0,
      operationFailures: 1,
      archiveQuarantines: 1,
      maxWrites: 8,
      backlog: 1,
    });
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(8);
    expect(verifyAfterWrite).toHaveBeenCalledTimes(8);
    expect(log.mock.calls
      .map(([event]) => event)
      .filter((event) => event.event === "keeper_operation" && event.ok)
      .map((event) => event.operation)).toEqual([
      "prepare_arena_daily",
      "prepare_weekly_jackpot",
      "activate_season",
      "archive_weekly_jackpot",
      "cleanup_orphan_active_run",
      "close_arena_player",
      "revoke_expired_session",
    ]);
    expect(materialize).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: "sync_daily_profile",
    }));
    expect(materialize).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: "close_arena_player",
      context: expect.objectContaining({ dayId: 20_660 }),
    }));
  });

  it("keeps non-integrity archive/configuration failures fatal", async () => {
    const materialize = vi.fn(async () => [instruction()]);
    await expect(runKeeperPass({
      connection: readOnlyConnection(),
      keeper: Keypair.generate(),
      writeEnabled: false,
      now: () => 20_661 * SECONDS_PER_DAY * 1_000,
      protocolSnapshot: archiveIsolationSnapshot(),
      protocolMaterializer: { materialize },
      archiveStore: {
        prepare: vi.fn(async (plan) => {
          if (plan.operation === "archive_arena_daily") {
            throw new Error("archive volume configuration is invalid");
          }
        }),
      },
    })).rejects.toThrow("archive volume configuration is invalid");
    expect(materialize).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: "archive_weekly_jackpot" }),
    );
  });
});

function archiveIsolationSnapshot(): ProtocolSnapshot {
  const dayId = 20_660;
  const weekId = weekIdForDay(dayId);
  const owner = Keypair.generate().publicKey;
  const dailyResultData = Buffer.from("daily-result");
  const weeklyResultData = Buffer.from("weekly-result");
  const dailyJson = canonicalArchiveV2({
    account: arenaDailyPda(dayId),
    accountData: Buffer.alloc(16, 2),
    competition: "daily",
    periodId: dayId,
    programId: ZKUBE_PROGRAM_ID,
    resultData: dailyResultData,
    root: "31".repeat(32),
  });
  const weeklyJson = canonicalArchiveV2({
    account: weeklyJackpotPda(weekId),
    accountData: Buffer.alloc(16, 2),
    competition: "weekly",
    periodId: weekId,
    programId: ZKUBE_PROGRAM_ID,
    resultData: weeklyResultData,
    root: "32".repeat(32),
  });
  return {
    paused: false,
    launchDayId: 20_656,
    rulesCatalog: rulesCatalogPda(1),
    dailies: [{
      dayId,
      status: "finalized",
      runsCloseAt: dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
      recoveryDeadlineAt:
        dayId * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
      entriesPaid: 1n,
      entriesScored: 1n,
      entriesExpired: 0n,
      potLamports: 1_000_000n,
      predecessorRolloverRequired: true,
      predecessorRolloverApplied: true,
      seasonEligiblePlayers: 0,
      seasonRollups: 0,
      seasonRollupSealed: true,
      profileSyncMask: 0,
      settlement: {
        winners: [{
          owner,
          payoutLamports: 1_000_000n,
          rank: 1,
          destinationValid: true,
        }],
        rolloverLamports: 0n,
      },
    }],
    weeklies: [{
      weekId,
      qualificationStartDay: 20_656,
      status: "finalized",
      closesAt: (weekStartDay(weekId) + 7) * SECONDS_PER_DAY,
      potLamports: 0n,
      predecessorRolloverRequired: false,
      predecessorRolloverApplied: false,
      qualificationDailiesComplete: true,
      profileSyncMask: 0,
    }],
    seasons: [],
    runs: [],
    dailySeasonPlayers: [],
    playerStateOwners: [owner],
    arenaPlayerClosures: [{
      dayId,
      owner,
      rentRecipient: playerFundingPda(owner),
    }],
    seasonPlayerClosures: [],
    archiveState: {
      address: arcadeArchivePda(),
      cadenceFunding: cadenceFundingPda(),
      lastDailyId: dayId - 1,
      lastWeeklyId: weekId - 1,
    },
    archiveCandidates: [{
      competition: "daily",
      cadenceId: dayId,
      canonicalJson: dailyJson,
      fileSha256: archiveSha256(dailyJson),
      resultHash: cadenceResultHash("daily", dailyResultData),
      requiredProfileSyncMask: 1,
      committed: false,
      closeEligible: false,
      closeEligibleAt: dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
    }, {
      competition: "weekly",
      cadenceId: weekId,
      canonicalJson: weeklyJson,
      fileSha256: archiveSha256(weeklyJson),
      resultHash: cadenceResultHash("weekly", weeklyResultData),
      requiredProfileSyncMask: 0,
      committed: false,
      closeEligible: false,
      closeEligibleAt: (weekStartDay(weekId) + 7) * SECONDS_PER_DAY,
    }],
  };
}

function archiveBackfillSnapshot(): ProtocolSnapshot {
  const snapshot = archiveIsolationSnapshot();
  const recoveryOwner = Keypair.generate().publicKey;
  const independentOwner = Keypair.generate().publicKey;
  const seasonId = seasonIdForDay(20_660);
  return {
    ...snapshot,
    seasons: [{
      seasonId,
      qualificationStartDay: snapshot.launchDayId,
      status: "funding",
      closesAt: (seasonStartDay(seasonId) + 28) * SECONDS_PER_DAY,
      potLamports: 0n,
      predecessorRolloverRequired: false,
      predecessorRolloverApplied: false,
      sealedDailies: 1,
      profileSyncMask: 0,
    }, {
      seasonId: seasonId + 1,
      qualificationStartDay: seasonStartDay(seasonId + 1),
      status: "open",
      closesAt: (seasonStartDay(seasonId + 1) + 28) * SECONDS_PER_DAY,
      potLamports: 0n,
      predecessorRolloverRequired: true,
      predecessorRolloverApplied: false,
      sealedDailies: 0,
      profileSyncMask: 0,
    }],
    runs: [{
      owner: recoveryOwner,
      runId: 17n,
      mode: "ranked",
      challengeDayId: 20_660,
      deadlineDayId: 20_660,
      arenaPlayerExists: true,
      lifecycle: "terminal",
      location: "base",
      acceptedActions: 1,
      runsCloseAt: 20_660 * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
      recoveryDeadlineAt:
        20_660 * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
      reservationActive: false,
    }],
    arenaPlayerClosures: [
      ...snapshot.arenaPlayerClosures,
      {
        dayId: 20_659,
        owner: independentOwner,
        rentRecipient: playerFundingPda(independentOwner),
      },
    ],
  };
}

function instruction(): TransactionInstruction {
  return new TransactionInstruction({
    programId: ZKUBE_PROGRAM_ID,
    keys: [],
    data: Buffer.alloc(8),
  });
}

function readOnlyConnection(sessions: ReturnType<typeof sessionFixture>[] = []) {
  return {
    getBalance: vi.fn().mockResolvedValue(0),
    getProgramAccounts: vi.fn().mockResolvedValue(sessions),
    getMultipleAccountsInfo: vi.fn(async (owners: PublicKey[]) =>
      owners.map(() => systemAccount())
    ),
  } as never;
}

function writeConnection(sessions: ReturnType<typeof sessionFixture>[] = []) {
  return {
    getBalance: vi.fn().mockResolvedValue(200_000_000),
    getProgramAccounts: vi.fn().mockResolvedValue(sessions),
    getMultipleAccountsInfo: vi.fn(async (owners: PublicKey[]) =>
      owners.map(() => systemAccount())
    ),
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 1,
    }),
    simulateTransaction: vi.fn().mockResolvedValue({
      value: {
        err: null,
        accounts: [{ lamports: 200_000_000 }],
      },
    }),
    getFeeForMessage: vi.fn().mockResolvedValue({ value: 5_000 }),
    sendRawTransaction: vi.fn(),
    confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
  };
}

function expiredSessions(count: number) {
  const owner = Keypair.generate().publicKey;
  return Array.from({ length: count }, (_, index) =>
    sessionFixture(owner, index + 1)
  );
}

function sessionFixture(owner: PublicKey, validUntil: number) {
  const sessionSigner = Keypair.generate().publicKey;
  const pubkey = deriveSessionPda(ZKUBE_PROGRAM_ID, owner, sessionSigner);
  const data = Buffer.alloc(144);
  Buffer.from([178, 3, 85, 254, 13, 116, 128, 41]).copy(data);
  owner.toBuffer().copy(data, 8);
  ZKUBE_PROGRAM_ID.toBuffer().copy(data, 40);
  sessionSigner.toBuffer().copy(data, 72);
  owner.toBuffer().copy(data, 104);
  data.writeBigInt64LE(BigInt(validUntil), 136);
  return {
    pubkey,
    account: {
      ...systemAccount(),
      owner: SESSION_KEYS_PROGRAM_ID,
      data,
    },
  };
}

function systemAccount(): AccountInfo<Buffer> {
  return {
    data: Buffer.alloc(0),
    executable: false,
    lamports: 1,
    owner: SystemProgram.programId,
    rentEpoch: 0,
  };
}

function recoveryNow(): number {
  return (20_661 * SECONDS_PER_DAY + 6 * 60 * 60) * 1_000;
}
