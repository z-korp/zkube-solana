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
} from "../src/arcadeChain";
import { canonicalArchiveV3, cadenceResultHash } from "../src/archiveContract";
import { ArchiveIntegrityError } from "../src/archiveStore";
import type { DailySnapshot, ProtocolSnapshot } from "../src/arcadeReconciliation";
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
    scoreBoard: board("score", owner ? 1 : 0),
    themeBoard: board("theme", 0),
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

function board(kind: "score" | "theme", payoutCount: number) {
  return {
    kind,
    payoutCount,
    widthCount: payoutCount,
    cursor: payoutCount,
    sealed: true,
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
  const canonicalJson = canonicalArchiveV3({
    account: daily,
    accountData: Buffer.alloc(10, 1),
    scoreBoard: arenaBoardPda(daily, "score"),
    scoreBoardData: Buffer.alloc(121, 2),
    themeBoard: arenaBoardPda(daily, "theme"),
    themeBoardData: Buffer.alloc(121, 3),
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
