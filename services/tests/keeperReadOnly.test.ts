import { createHash } from "node:crypto";

import {
  Keypair,
  TransactionInstruction,
  type Connection,
  type PublicKey,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  DAILY_POOL_SELECTION_SEED,
  DAILY_RUN_CLOSE_OFFSET,
  SECONDS_PER_DAY,
  ZKUBE_PROGRAM_ID,
  arcadeArchivePda,
  arenaDailyPda,
  arenaBoardPda,
  cadenceFundingPda,
  playerFundingPda,
  type KeeperInstructionPlan,
} from "../src/arcadeChain";
import { canonicalArchive, cadenceResultHash } from "../src/archiveContract";
import { ArchiveIntegrityError } from "../src/archiveStore";
import { rankWeightedPayoutPlan } from "../src/arcadeEconomy";
import {
  discoverReconciliationPlans,
  type DailySnapshot,
  type ProtocolSnapshot,
} from "../src/arcadeReconciliation";
import { runKeeperPass } from "../src/keeper";

const DAY = 20_651;
const PASS_NOW = DAY * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET + 1;

describe("keeper read-only planning", () => {
  it("keeps a Daily backlog inside the six-write release bound", async () => {
    const keeper = Keypair.generate().publicKey;
    const owners = Array.from({ length: 8 }, () => Keypair.generate().publicKey);
    const dailies = [
      ...owners.map((owner, index) =>
        finalizedDaily(DAY - index, owner, DAY - 7)),
      fundingDaily(DAY + 1, DAY - 7),
    ];
    const materialize = vi.fn(materializer(keeper));
    const result = await runKeeperPass({
      connection: connection(),
      keeper: { publicKey: keeper },
      now: () => PASS_NOW * 1_000,
      protocolSnapshot: snapshot({
        launchDayId: DAY - 7,
        dailies,
        playerStateOwners: owners,
      }),
      protocolMaterializer: { materialize },
    });
    expect(result).toMatchObject({
      writes: 0,
      plannedWrites: 6,
      maxWrites: 6,
      backlog: 2,
    });
    expect(materialize).toHaveBeenCalledTimes(6);
  });

  it("slices unsealed Score and Theme boards at ten rows and resumes at the cursor", () => {
    const launchDay = DAY - 1;
    const first = constructingDaily(DAY - 1, launchDay);
    const second = constructingDaily(DAY, launchDay);
    const interleaved = discoverReconciliationPlans({
      snapshot: snapshot({
        launchDayId: launchDay,
        dailies: [first, second, fundingDaily(DAY + 1, launchDay)],
      }),
      nowUnix: PASS_NOW,
    }).filter(({ operation }) => operation === "submit_arena_board_chunk");
    expect(interleaved.map(({ context }) => ({
      dayId: context.dayId,
      boardKind: context.boardKind,
      cursor: context.boardCursor,
      rows: context.boardEntries?.length,
      seal: context.sealBoard,
    }))).toEqual([
      { dayId: DAY - 1, boardKind: "score", cursor: 0, rows: 10, seal: false },
      { dayId: DAY - 1, boardKind: "theme", cursor: 0, rows: 10, seal: false },
      { dayId: DAY, boardKind: "score", cursor: 0, rows: 10, seal: false },
      { dayId: DAY, boardKind: "theme", cursor: 0, rows: 10, seal: false },
    ]);

    sealBoard(first, "theme");
    for (const [cursor, rows, seal] of [
      [0, 10, false],
      [10, 10, false],
      [20, 5, true],
    ] as const) {
      first.scoreBoard!.cursor = cursor;
      const [plan] = discoverReconciliationPlans({
        snapshot: snapshot({
          launchDayId: launchDay,
          dailies: [first, fundingDaily(DAY + 1, launchDay)],
        }),
        nowUnix: PASS_NOW,
      }).filter(({ operation }) => operation === "submit_arena_board_chunk");
      expect(plan?.context).toMatchObject({
        boardKind: "score",
        boardCursor: cursor,
        sealBoard: seal,
      });
      expect(plan?.context.boardEntries).toHaveLength(rows);
      expect(plan?.context.boardEntries?.[0]?.source)
        .toEqual(first.scoreSources?.[cursor]?.source);
    }
  });

  it("uses all 32 board-write slots, carries cursors forward, and skips quarantine", async () => {
    const keeper = Keypair.generate().publicKey;
    const launchDay = DAY - 17;
    const poisoned = constructingDaily(launchDay, launchDay);
    poisoned.integrityFailure = "poisoned board source";
    const scoreOnly = constructingDaily(DAY - 16, launchDay);
    sealBoard(scoreOnly, "theme");
    const dailies = [
      poisoned,
      scoreOnly,
      ...Array.from({ length: 16 }, (_, index) =>
        constructingDaily(DAY - 15 + index, launchDay)),
      fundingDaily(DAY + 1, launchDay),
    ];
    const materialize = vi.fn(materializer(keeper));
    const runPass = () => runKeeperPass({
      connection: connection(),
      keeper: { publicKey: keeper },
      now: () => PASS_NOW * 1_000,
      protocolSnapshot: snapshot({ launchDayId: launchDay, dailies }),
      protocolMaterializer: { materialize },
    });

    const firstPass = await runPass();
    expect(firstPass).toMatchObject({ plannedWrites: 32, backlog: 1 });
    let boardPlans = materialize.mock.calls.map(([plan]) => plan)
      .filter(({ operation }) => operation === "submit_arena_board_chunk");
    expect(boardPlans).toHaveLength(32);
    expect(boardPlans.some(({ context }) => context.dayId === launchDay)).toBe(false);
    expect(boardPlans.at(-1)?.context).toMatchObject({
      dayId: DAY,
      boardKind: "score",
      boardCursor: 0,
    });

    for (let pass = 0; pass < 3; pass += 1) {
      applyBoardPlans(dailies, boardPlans);
      materialize.mockClear();
      const nextPass = await runPass();
      boardPlans = materialize.mock.calls.map(([plan]) => plan)
        .filter(({ operation }) => operation === "submit_arena_board_chunk");
      if (pass < 2) {
        expect(nextPass.plannedWrites).toBe(32);
        expect(boardPlans[0]?.context.boardCursor).toBe((pass + 1) * 10);
      } else {
        expect(nextPass).toMatchObject({ plannedWrites: 1, backlog: 0 });
        expect(boardPlans).toEqual([expect.objectContaining({
          context: expect.objectContaining({
            dayId: DAY,
            boardKind: "theme",
            boardCursor: 0,
          }),
        })]);
      }
    }
  });

  it("closes at most one finalized participant account per pass", async () => {
    const keeper = Keypair.generate().publicKey;
    const owners = Array.from({ length: 3 }, () => Keypair.generate().publicKey);
    const finalized = owners.map((_, index) =>
      finalizedDaily(DAY - index, undefined, DAY - 2));
    const dailies = [...finalized, fundingDaily(DAY + 1, DAY - 2)];
    const candidates = finalized.map(({ dayId }) => archiveCandidate(dayId, true, false));
    const materialize = vi.fn(materializer(keeper));
    const result = await runKeeperPass({
      connection: connection(),
      keeper: { publicKey: keeper },
      now: () => PASS_NOW * 1_000,
      protocolSnapshot: snapshot({
        launchDayId: DAY - 2,
        dailies,
        arenaPlayerClosures: owners.map((owner, index) => ({
          dayId: DAY - index,
          owner,
          rentRecipient: playerFundingPda(owner),
        })),
        archiveState: {
          address: arcadeArchivePda(),
          cadenceFunding: cadenceFundingPda(),
          firstDailyId: DAY - 2,
          lastDailyId: DAY,
          dailyRoot: "44".repeat(32),
        },
        archiveCandidates: candidates,
      }),
      protocolMaterializer: { materialize },
    });
    expect(result.plannedWrites).toBe(1);
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(materialize.mock.calls[0]?.[0].operation).toBe("close_arena_player");
  });

  it("quarantines one Daily archive failure and continues an independent Daily", async () => {
    const keeper = Keypair.generate().publicKey;
    const archivedOwner = Keypair.generate().publicKey;
    const independentOwner = Keypair.generate().publicKey;
    const candidate = archiveCandidate(DAY - 1, false, false);
    const prepare = vi.fn(async () => {
      throw new ArchiveIntegrityError(
        "existing_archive_invalid",
        "daily",
        DAY - 1,
        "invalid archive",
      );
    });
    const materialize = vi.fn(materializer(keeper));
    const result = await runKeeperPass({
      connection: connection(),
      keeper: { publicKey: keeper },
      now: () => PASS_NOW * 1_000,
      protocolSnapshot: snapshot({
        launchDayId: DAY - 1,
        dailies: [
          finalizedDaily(DAY - 1, archivedOwner, DAY - 1),
          finalizedDaily(DAY, independentOwner, DAY - 1),
          fundingDaily(DAY + 1, DAY - 1),
        ],
        playerStateOwners: [archivedOwner, independentOwner],
        archiveState: {
          address: arcadeArchivePda(),
          cadenceFunding: cadenceFundingPda(),
          firstDailyId: DAY - 1,
          lastDailyId: DAY - 2,
          dailyRoot: "00".repeat(32),
        },
        archiveCandidates: [candidate],
      }),
      protocolMaterializer: { materialize },
      archiveStore: { prepare },
    });
    expect(result).toMatchObject({
      ok: false,
      archiveQuarantines: 1,
      operationFailures: 1,
      plannedWrites: 1,
    });
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(materialize.mock.calls[0]?.[0]).toMatchObject({
      operation: "sync_daily_profile",
      context: { dayId: DAY, owner: independentOwner },
    });
  });

  it("does not charge the general quota for archive quarantine or its suppressed sync", async () => {
    const keeper = Keypair.generate().publicKey;
    const archivedOwner = Keypair.generate().publicKey;
    const archived = finalizedDaily(DAY - 1, archivedOwner, DAY - 1);
    const independent = constructingDaily(DAY, DAY - 1);
    sealBoard(independent, "score");
    sealBoard(independent, "theme");
    const owners = independent.scoreSources!.slice(0, 6).map(({ owner }) => owner);
    const prepare = vi.fn(async () => {
      throw new ArchiveIntegrityError(
        "existing_archive_invalid",
        "daily",
        DAY - 1,
        "invalid archive",
      );
    });
    const materialize = vi.fn(materializer(keeper));
    const result = await runKeeperPass({
      connection: connection(),
      keeper: { publicKey: keeper },
      now: () => PASS_NOW * 1_000,
      protocolSnapshot: snapshot({
        launchDayId: DAY - 1,
        dailies: [archived, independent, fundingDaily(DAY + 1, DAY - 1)],
        playerStateOwners: [archivedOwner, ...owners],
        archiveState: {
          address: arcadeArchivePda(),
          cadenceFunding: cadenceFundingPda(),
          firstDailyId: DAY - 1,
          lastDailyId: DAY - 2,
          dailyRoot: "00".repeat(32),
        },
        archiveCandidates: [archiveCandidate(DAY - 1, false, false)],
      }),
      protocolMaterializer: { materialize },
      archiveStore: { prepare },
    });
    expect(result).toMatchObject({
      operationFailures: 1,
      archiveQuarantines: 1,
      plannedWrites: 6,
    });
    expect(materialize).toHaveBeenCalledTimes(6);
    expect(materialize.mock.calls.every(([plan]) =>
      plan.operation === "sync_daily_profile" && plan.context.dayId === DAY)).toBe(true);
  });

  it("keeps a poisoned cadence local while unrelated Daily and Campaign work proceeds", async () => {
    const keeper = Keypair.generate().publicKey;
    const poisonedOwner = Keypair.generate().publicKey;
    const independentOwner = Keypair.generate().publicKey;
    const campaignOwner = Keypair.generate().publicKey;
    const poisoned = finalizedDaily(DAY - 1, poisonedOwner, DAY - 1);
    poisoned.integrityFailure = "poisoned finalized board";
    poisoned.claimsExpired = true;
    const poisonCandidate = {
      ...archiveCandidate(DAY - 1, true, true),
      claimsExpired: true,
    };
    const materialize = vi.fn(materializer(keeper));
    const result = await runKeeperPass({
      connection: connection(),
      keeper: { publicKey: keeper },
      now: () => PASS_NOW * 1_000,
      protocolSnapshot: snapshot({
        launchDayId: DAY - 1,
        dailies: [
          poisoned,
          finalizedDaily(DAY, independentOwner, DAY - 1),
          fundingDaily(DAY + 1, DAY - 1),
        ],
        runs: [{
          owner: campaignOwner,
          runId: 1n,
          mode: "campaign",
          arenaPlayerExists: false,
          lifecycle: "terminal",
          location: "base",
          acceptedActions: 1,
          reservationActive: true,
        }],
        playerStateOwners: [poisonedOwner, independentOwner],
        arenaPlayerClosures: [{
          dayId: DAY - 1,
          owner: poisonedOwner,
          rentRecipient: playerFundingPda(poisonedOwner),
        }],
        archiveState: {
          address: arcadeArchivePda(),
          cadenceFunding: cadenceFundingPda(),
          firstDailyId: DAY - 1,
          lastDailyId: DAY - 1,
          dailyRoot: "44".repeat(32),
        },
        archiveCandidates: [poisonCandidate],
      }),
      protocolMaterializer: { materialize },
    });
    expect(result).toMatchObject({
      ok: true,
      plannedWrites: 2,
      backlog: 0,
    });
    expect(materialize.mock.calls.map(([plan]) => ({
      operation: plan.operation,
      dayId: plan.context.dayId,
      owner: plan.context.owner,
    }))).toEqual([
      {
        operation: "consume_campaign_run",
        dayId: undefined,
        owner: campaignOwner,
      },
      {
        operation: "sync_daily_profile",
        dayId: DAY,
        owner: independentOwner,
      },
    ]);
    expect(materialize.mock.calls.some(([plan]) =>
      plan.context.dayId === DAY - 1 && [
        "sync_daily_profile",
        "close_arena_daily",
        "close_arena_player",
      ].includes(plan.operation))).toBe(false);
  });
});

function snapshot(overrides: Partial<ProtocolSnapshot>): ProtocolSnapshot {
  return {
    paused: true,
    launchDayId: DAY,
    rulesCatalog: Keypair.generate().publicKey,
    contentVersion: 2,
    selectionSeed: Uint8Array.from(DAILY_POOL_SELECTION_SEED),
    catalogStartsDay: DAY - 10,
    poolEntries: Array.from({ length: 10 }, (_, index) => ({
      realmMapId: index + 1,
      passiveMapId: index + 1,
    })),
    dailies: [],
    runs: [],
    playerStateOwners: [],
    arenaPlayerClosures: [],
    archiveCandidates: [],
    ...overrides,
  };
}

function finalizedDaily(
  dayId: number,
  owner: PublicKey | undefined,
  launchDayId: number,
): DailySnapshot {
  return {
    dayId,
    status: "finalized",
    finalizedAt: dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
    runsCloseAt: dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
    recoveryDeadlineAt: dayId * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
    entriesPaid: 1n,
    entriesScored: 1n,
    entriesExpired: 0n,
    potLamports: owner ? 10_000_000n : 0n,
    predecessorRolloverRequired: dayId !== launchDayId,
    predecessorRolloverApplied: dayId !== launchDayId,
    scoreQualifiedPlayers: owner ? 1 : 0,
    themeQualifiedPlayers: 0,
    scoreClaimedMask: 0n,
    themeClaimedMask: 0n,
    scoreProfileSyncMask: 0n,
    themeProfileSyncMask: 0n,
    claimsExpired: false,
    scoreBoard: board("score", owner ? 1 : 0, dayId),
    themeBoard: board("theme", 0, dayId),
    settlement: {
      winners: owner ? [{
        board: "score",
        owner,
        rank: 1,
        payoutLamports: 10_000_000n,
      }] : [],
      rolloverLamports: 0n,
      scoreCapacityLimited: false,
      themeCapacityLimited: false,
    },
  };
}

function constructingDaily(dayId: number, launchDayId: number): DailySnapshot {
  const potLamports = 2_000_000_000n;
  const boardPool = potLamports / 2n;
  const scorePlan = rankWeightedPayoutPlan(boardPool, 25, 1_536);
  const themePlan = rankWeightedPayoutPlan(boardPool, 25, 1_536);
  if (scorePlan.winnerCount !== 25 || themePlan.winnerCount !== 25) {
    throw new Error("test board must retain all 25 rows");
  }
  const sources = Array.from({ length: 25 }, (_, index) => {
    const owner = Keypair.generate().publicKey;
    return {
      source: Keypair.generate().publicKey,
      owner,
      score: 10_000 - index,
      objectiveTotal: BigInt(5_000 - index),
      finalizedAt: dayId * SECONDS_PER_DAY + index,
      replayHash: new Uint8Array(32).fill(index + 1),
    };
  });
  return {
    dayId,
    status: "finalized",
    finalizedAt: dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
    runsCloseAt: dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
    recoveryDeadlineAt: dayId * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
    entriesPaid: 25n,
    entriesScored: 25n,
    entriesExpired: 0n,
    potLamports,
    predecessorRolloverRequired: dayId !== launchDayId,
    predecessorRolloverApplied: dayId !== launchDayId,
    scoreQualifiedPlayers: 25,
    themeQualifiedPlayers: 25,
    scoreClaimedMask: 0n,
    themeClaimedMask: 0n,
    scoreProfileSyncMask: 0n,
    themeProfileSyncMask: 0n,
    claimsExpired: false,
    scoreSources: sources,
    themeSources: sources,
    scoreBoard: constructionBoard("score", 25),
    themeBoard: constructionBoard("theme", 25),
    settlement: {
      winners: [
        ...sources.map(({ owner }, index) => ({
          board: "score" as const,
          owner,
          rank: index + 1,
          payoutLamports: scorePlan.payouts[index]!,
        })),
        ...sources.map(({ owner }, index) => ({
          board: "theme" as const,
          owner,
          rank: index + 1,
          payoutLamports: themePlan.payouts[index]!,
        })),
      ],
      rolloverLamports: scorePlan.rolloverLamports + themePlan.rolloverLamports,
      scoreCapacityLimited: false,
      themeCapacityLimited: false,
    },
  };
}

function constructionBoard(kind: "score" | "theme", payoutCount: number) {
  return {
    kind,
    payoutCount,
    widthCount: payoutCount,
    cursor: 0,
    sealed: false,
    sealedAt: 0,
    claimedLamports: 0n,
    claimedCount: 0,
    profileSyncCount: 0,
    capacityLimited: false,
  };
}

function sealBoard(daily: DailySnapshot, kind: "score" | "theme"): void {
  const board = kind === "score" ? daily.scoreBoard : daily.themeBoard;
  if (!board) throw new Error("test board is missing");
  board.cursor = board.payoutCount;
  board.sealed = true;
  board.sealedAt = daily.finalizedAt;
}

function applyBoardPlans(
  dailies: readonly DailySnapshot[],
  plans: readonly KeeperInstructionPlan[],
): void {
  for (const plan of plans) {
    const daily = dailies.find(({ dayId }) => dayId === plan.context.dayId);
    const board = plan.context.boardKind === "score"
      ? daily?.scoreBoard
      : daily?.themeBoard;
    const rows = plan.context.boardEntries?.length;
    if (!daily || !board || rows === undefined || board.cursor !== plan.context.boardCursor) {
      throw new Error("board carry-over fixture does not match its plan");
    }
    board.cursor += rows;
    if (plan.context.sealBoard) {
      board.sealed = true;
      board.sealedAt = daily.finalizedAt;
    }
  }
}

function board(kind: "score" | "theme", payoutCount: number, dayId: number) {
  return {
    kind,
    payoutCount,
    widthCount: payoutCount,
    cursor: payoutCount,
    sealed: true,
    sealedAt: dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
    claimedLamports: 0n,
    claimedCount: 0,
    profileSyncCount: 0,
    capacityLimited: false,
  };
}

function fundingDaily(dayId: number, launchDayId: number): DailySnapshot {
  return {
    dayId,
    status: "funding",
    finalizedAt: 0,
    runsCloseAt: dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
    recoveryDeadlineAt: dayId * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
    entriesPaid: 0n,
    entriesScored: 0n,
    entriesExpired: 0n,
    potLamports: 0n,
    predecessorRolloverRequired: dayId !== launchDayId,
    predecessorRolloverApplied: dayId !== launchDayId,
    scoreQualifiedPlayers: 0,
    themeQualifiedPlayers: 0,
    scoreClaimedMask: 0n,
    themeClaimedMask: 0n,
    scoreProfileSyncMask: 0n,
    themeProfileSyncMask: 0n,
    claimsExpired: false,
  };
}

function archiveCandidate(cadenceId: number, committed: boolean, closeEligible: boolean) {
  const resultData = Buffer.from(`daily-${cadenceId}`);
  const daily = arenaDailyPda(cadenceId);
  const canonicalJson = canonicalArchive({
    account: daily,
    accountData: Buffer.alloc(10, 1),
    scoreBoard: arenaBoardPda(daily, "score"),
    scoreBoardData: Buffer.alloc(129, 2),
    themeBoard: arenaBoardPda(daily, "theme"),
    themeBoardData: Buffer.alloc(129, 3),
    competition: "daily",
    periodId: cadenceId,
    programId: ZKUBE_PROGRAM_ID,
    resultData,
    root: "44".repeat(32),
  });
  return {
    competition: "daily" as const,
    cadenceId,
    ...(committed ? {} : {
      canonicalJson,
      fileSha256: createHash("sha256").update(canonicalJson).digest("hex"),
    }),
    resultHash: cadenceResultHash("daily", resultData),
    requiredScoreProfileSyncMask: 0n,
    requiredThemeProfileSyncMask: 0n,
    claimsExpired: false,
    committed,
    closeEligible,
    closeEligibleAt: cadenceId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET +
      DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  };
}

function connection(): Connection {
  return {
    getBalance: vi.fn().mockResolvedValue(200_000_000),
    getProgramAccounts: vi.fn().mockResolvedValue([]),
  } as unknown as Connection;
}

function materializer(keeper: PublicKey) {
  return async () => [new TransactionInstruction({
    programId: ZKUBE_PROGRAM_ID,
    keys: [{ pubkey: keeper, isSigner: true, isWritable: false }],
    data: Buffer.alloc(8),
  })];
}
