import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  DAILY_RUN_CLOSE_OFFSET,
  SECONDS_PER_DAY,
  ZKUBE_PROGRAM_ID,
  arcadeArchivePda,
  cadenceFundingPda,
  playerFundingPda,
} from "../src/arcadeChain";
import {
  discoverReconciliation,
  discoverReconciliationPlans,
  type DailySnapshot,
  type ProtocolSnapshot,
} from "../src/arcadeReconciliation";
import { operationPriority } from "../src/keeper";
import { assertKeeperPlanPolicy } from "../src/keeperPolicy";

const DAY = 20_651;
const NOW = DAY * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET + 1;
const RULES = Keypair.generate().publicKey;

describe("v5 Daily keeper reconciliation", () => {
  it("prepares and activates only Daily successors", () => {
    const plans = discoverReconciliationPlans({
      snapshot: snapshot({
        paused: false,
        launchDayId: DAY - 1,
        dailies: [
          { ...daily(DAY - 1, "finalized"), predecessorRolloverRequired: false,
            predecessorRolloverApplied: false },
          { ...daily(DAY, "funding"), predecessorRolloverRequired: true },
        ],
      }),
      nowUnix: DAY * SECONDS_PER_DAY + 1,
    });
    expect(plans.map(({ operation }) => operation)).toEqual([
      "activate_arena_daily",
      "prepare_arena_daily",
    ]);
    expect(plans.every(({ operation }) =>
      !operation.includes("weekly") && !operation.includes("season"))).toBe(true);
  });

  it("routes a suspended period into the first resumed Daily", () => {
    const lastPaidDay = 87;
    const plans = discoverReconciliationPlans({
      snapshot: snapshot({
        paused: false,
        launchDayId: lastPaidDay,
        catalogStartsDay: 95,
        dailies: [{
          ...daily(lastPaidDay, "open"),
          predecessorRolloverRequired: false,
          predecessorRolloverApplied: false,
        }],
      }),
      nowUnix: 88 * SECONDS_PER_DAY + 1,
    });
    const preparation = plans.find(({ operation }) =>
      operation === "prepare_arena_daily");
    expect(preparation?.context).toMatchObject({
      dayId: lastPaidDay,
      followingDayId: 95,
    });
    expect(plans.some(({ context }) => {
      const dayId = typeof context.dayId === "number" ? context.dayId : undefined;
      return dayId !== undefined && dayId >= 88 && dayId <= 94;
    })).toBe(false);
  });

  it("routes terminal Campaign and ranked runs by location", () => {
    const campaignOwner = Keypair.generate().publicKey;
    const rankedOwner = Keypair.generate().publicKey;
    const plans = discoverReconciliationPlans({
      snapshot: snapshot({
        launchDayId: DAY,
        dailies: [daily(DAY, "open")],
        runs: [
          {
            owner: campaignOwner,
            runId: 1n,
            mode: "campaign",
            arenaPlayerExists: false,
            lifecycle: "terminal",
            location: "base",
            acceptedActions: 1,
            reservationActive: true,
          },
          rankedRun(rankedOwner, "terminal", "ephemeral_rollup"),
        ],
      }),
      nowUnix: NOW,
    });
    expect(plans.map(({ operation }) => operation)
      .filter((operation) => operation.includes("run") || operation === "commit_run"))
      .toEqual([
      "consume_campaign_run",
      "commit_run",
    ]);
  });

  it("emits run plans the keeper policy accepts, for every run operation", () => {
    // The plan emitter and the policy are two hand-maintained mirrors of the
    // same rules; the Campaign-orphan dead path existed because nothing made
    // them agree. Every run operation must be producible AND accepted.
    const plans = discoverReconciliationPlans({
      snapshot: snapshot({
        launchDayId: DAY,
        dailies: [daily(DAY, "open")],
        runs: [
          {
            owner: Keypair.generate().publicKey,
            runId: 1n,
            mode: "campaign",
            arenaPlayerExists: false,
            lifecycle: "terminal",
            location: "base",
            acceptedActions: 1,
            reservationActive: true,
          },
          {
            owner: Keypair.generate().publicKey,
            runId: 3n,
            mode: "campaign",
            arenaPlayerExists: false,
            lifecycle: "playing",
            location: "base",
            acceptedActions: 0,
            reservationActive: false,
          },
          rankedRun(Keypair.generate().publicKey, "terminal", "ephemeral_rollup"),
          { ...rankedRun(Keypair.generate().publicKey, "terminal", "base"), runId: 4n },
          rankedRun(Keypair.generate().publicKey, "playing", "ephemeral_rollup"),
          rankedRun(Keypair.generate().publicKey, "unavailable", "unavailable"),
          {
            ...rankedRun(Keypair.generate().publicKey, "playing", "base"),
            runId: 5n,
            reservationActive: false,
          },
        ],
      }),
      nowUnix: NOW,
    });
    const runOperations = new Set([
      "force_finish_deadline",
      "expire_unresolved_arena_run",
      "commit_run",
      "consume_arena_run",
      "consume_campaign_run",
      "cleanup_orphan_active_run",
    ]);
    const runPlans = plans.filter(({ operation }) => runOperations.has(operation));
    expect(new Set(runPlans.map(({ operation }) => operation))).toEqual(runOperations);
    const keeper = Keypair.generate().publicKey;
    for (const plan of runPlans) {
      expect(() =>
        assertKeeperPlanPolicy({
          plan,
          keeper,
          programId: ZKUBE_PROGRAM_ID,
          connection: {} as Connection,
          nowUnix: NOW,
        }),
      ).not.toThrow();
    }
  });

  it("cleans an orphaned Campaign run that has no recovery deadline", () => {
    const plans = discoverReconciliationPlans({
      snapshot: snapshot({
        launchDayId: DAY,
        dailies: [daily(DAY, "open")],
        runs: [
          {
            owner: Keypair.generate().publicKey,
            runId: 1n,
            mode: "campaign",
            arenaPlayerExists: false,
            lifecycle: "playing",
            location: "base",
            acceptedActions: 0,
            reservationActive: false,
          },
        ],
      }),
      nowUnix: NOW,
    });
    expect(plans.some(({ operation, context }) =>
      operation === "cleanup_orphan_active_run" &&
      context.runMode === "campaign" &&
      context.recoveryDeadlineAt === undefined)).toBe(true);
  });

  it("finishes reachable ER state and expires unavailable ranked state", () => {
    const plans = discoverReconciliationPlans({
      snapshot: snapshot({
        launchDayId: DAY,
        dailies: [daily(DAY, "open")],
        runs: [
          rankedRun(Keypair.generate().publicKey, "playing", "ephemeral_rollup"),
          rankedRun(Keypair.generate().publicKey, "unavailable", "unavailable"),
        ],
      }),
      nowUnix: NOW,
    });
    expect(plans.map(({ operation }) => operation)
      .filter((operation) => operation === "force_finish_deadline" ||
        operation === "expire_unresolved_arena_run")).toEqual([
      "force_finish_deadline",
      "expire_unresolved_arena_run",
    ]);
  });

  it("plans conserved Daily payout and successor rollover", () => {
    const owners = [Keypair.generate().publicKey, Keypair.generate().publicKey];
    const settled = daily(DAY, "open", owners);
    const plans = discoverReconciliationPlans({
      snapshot: snapshot({
        launchDayId: DAY,
        dailies: [settled, daily(DAY + 1, "funding")],
      }),
      nowUnix: NOW,
    });
    const finalization = plans.find(({ operation }) =>
      operation === "finalize_arena_daily");
    expect(finalization?.context).toMatchObject({
      competition: "daily",
      dayId: DAY,
      followingDayId: DAY + 1,
      scorePayoutCount: 2,
      themePayoutCount: 0,
      scoreCapacityLimited: false,
      themeCapacityLimited: false,
      payoutTotalLamports: 100_000_000n,
      rolloverLamports: 1_500_000n,
      potLamports: 101_500_000n,
    });
  });

  it("syncs only outstanding payout-bearing positions", () => {
    const owners = [Keypair.generate().publicKey, Keypair.generate().publicKey];
    const finalized = daily(DAY, "finalized", owners);
    finalized.scoreProfileSyncMask = 0b01n;
    const plans = discoverReconciliationPlans({
      snapshot: snapshot({
        launchDayId: DAY,
        dailies: [finalized],
        playerStateOwners: owners,
      }),
      nowUnix: NOW,
    });
    expect(plans.filter(({ operation }) => operation === "sync_daily_profile"))
      .toEqual([expect.objectContaining({
        context: expect.objectContaining({
          boardKind: "score",
          owner: owners[1],
          winnerPositionMask: 2n,
        }),
      })]);
  });

  it("quarantines a snapshot-time integrity failure without blocking preparation", () => {
    const poisoned = daily(DAY, "finalized", [Keypair.generate().publicKey]);
    poisoned.integrityFailure = "score board does not retain every claimable winner";
    const discovery = discoverReconciliation({
      snapshot: snapshot({
        launchDayId: DAY,
        dailies: [poisoned],
      }),
      nowUnix: NOW,
    });
    expect(discovery.quarantines).toEqual([
      expect.objectContaining({
        kind: "daily",
        id: DAY,
        reason: "score board does not retain every claimable winner",
      }),
    ]);
    expect(discovery.plans.map(({ operation }) => operation))
      .toEqual(["prepare_arena_daily"]);
  });

  it("quarantines a noncanonical Daily payout without blocking preparation", () => {
    const bad = daily(DAY, "finalized", [Keypair.generate().publicKey]);
    bad.settlement!.winners[0]!.payoutLamports = 44_000_000n;
    const discovery = discoverReconciliation({
      snapshot: snapshot({
        launchDayId: DAY,
        dailies: [bad],
      }),
      nowUnix: NOW,
    });
    expect(discovery.quarantines).toEqual([
      expect.objectContaining({ kind: "daily", id: DAY }),
    ]);
    expect(discovery.plans.map(({ operation }) => operation))
      .toEqual(["prepare_arena_daily"]);
  });

  it("archives sequentially and closes only a committed Daily", () => {
    const finalized = daily(DAY, "finalized");
    const base = snapshot({
      launchDayId: DAY,
      dailies: [finalized],
      archiveState: {
        address: arcadeArchivePda(),
        cadenceFunding: cadenceFundingPda(),
        firstDailyId: DAY,
        lastDailyId: DAY - 1,
        dailyRoot: "00".repeat(32),
      },
      archiveCandidates: [candidate(DAY, false, false)],
    });
    expect(discoverReconciliationPlans({ snapshot: base, nowUnix: NOW })[0]?.operation)
      .toBe("archive_arena_daily");
    const afterClaims = finalized.finalizedAt +
      DAILY_REWARD_CLAIM_WINDOW_SECONDS + 1;
    const expiryTarget = Math.floor(afterClaims / SECONDS_PER_DAY) + 1;
    const committed = snapshot({
      ...base,
      dailies: [finalized, daily(expiryTarget, "open")],
      archiveState: {
        ...base.archiveState!,
        lastDailyId: DAY,
        dailyRoot: "44".repeat(32),
      },
      archiveCandidates: [candidate(DAY, true, false)],
    });
    expect(discoverReconciliationPlans({ snapshot: committed, nowUnix: afterClaims })[0]?.operation)
      .toBe("expire_daily_claims");
    const expiredDaily = { ...finalized, claimsExpired: true };
    const expired = snapshot({
      ...committed,
      dailies: [expiredDaily, daily(expiryTarget, "open")],
      archiveCandidates: [candidate(DAY, true, true)],
    });
    expect(discoverReconciliationPlans({ snapshot: expired, nowUnix: afterClaims })[0]?.operation)
      .toBe("close_arena_daily");
  });

  it("expires an older committed Daily after the archive tip advances", () => {
    const owner = Keypair.generate().publicKey;
    const oldDaily = daily(DAY, "finalized", [owner]);
    const tipDaily = daily(DAY + 1, "finalized");
    const afterClaims = oldDaily.finalizedAt +
      DAILY_REWARD_CLAIM_WINDOW_SECONDS + 1;
    const expiryTarget = Math.floor(afterClaims / SECONDS_PER_DAY) + 1;
    const plans = discoverReconciliationPlans({
      snapshot: snapshot({
        launchDayId: DAY,
        dailies: [oldDaily, tipDaily, daily(expiryTarget, "open")],
        archiveState: {
          address: arcadeArchivePda(),
          cadenceFunding: cadenceFundingPda(),
          firstDailyId: DAY,
          lastDailyId: DAY + 1,
          dailyRoot: "44".repeat(32),
        },
        archiveCandidates: [
          candidate(DAY, true, false),
          candidate(DAY + 1, true, false),
        ],
      }),
      nowUnix: afterClaims,
    });

    expect(plans.find(({ operation }) => operation === "expire_daily_claims")?.context)
      .toMatchObject({ dayId: DAY, previousCadenceId: DAY + 1 });
  });

  it("closes one resolved ArenaPlayer to its canonical funding PDA", () => {
    const owner = Keypair.generate().publicKey;
    const finalized = daily(DAY, "finalized");
    const plans = discoverReconciliationPlans({
      snapshot: snapshot({
        launchDayId: DAY,
        dailies: [finalized],
        arenaPlayerClosures: [{
          dayId: DAY,
          owner,
          rentRecipient: playerFundingPda(owner),
        }],
        archiveState: {
          address: arcadeArchivePda(),
          cadenceFunding: cadenceFundingPda(),
          firstDailyId: DAY,
          lastDailyId: DAY,
          dailyRoot: "44".repeat(32),
        },
        archiveCandidates: [candidate(DAY, true, false)],
      }),
      nowUnix: NOW,
    });
    expect(plans.map(({ operation }) => operation)).toContain("close_arena_player");
  });

  it("keeps monetary, archive, sync, and cleanup ordering stable", () => {
    expect(operationPriority("finalize_arena_daily"))
      .toBeLessThan(operationPriority("archive_arena_daily"));
    expect(operationPriority("archive_arena_daily"))
      .toBeLessThan(operationPriority("expire_daily_claims"));
    expect(operationPriority("expire_daily_claims"))
      .toBeLessThan(operationPriority("sync_daily_profile"));
    expect(operationPriority("sync_daily_profile"))
      .toBeLessThan(operationPriority("close_arena_daily"));
    expect(operationPriority("close_arena_daily"))
      .toBeLessThan(operationPriority("close_arena_player"));
  });
});

function snapshot(overrides: Partial<ProtocolSnapshot> = {}): ProtocolSnapshot {
  return {
    paused: true,
    launchDayId: DAY,
    rulesCatalog: RULES,
    contentVersion: 2,
    catalogStartsDay: DAY - 10,
    poolEntries: dailyPoolEntries(),
    dailies: [],
    runs: [],
    playerStateOwners: [],
    arenaPlayerClosures: [],
    archiveCandidates: [],
    ...overrides,
  };
}

function dailyPoolEntries() {
  return Array.from({ length: 10 }, (_, index) => ({
    realmMapId: index + 1,
  }));
}

function daily(
  dayId: number,
  status: DailySnapshot["status"],
  owners: readonly PublicKey[] = [],
): DailySnapshot {
  const potLamports = owners.length ? 101_500_000n : 0n;
  const payouts = owners.length === 1
    ? [101_000_000n]
    : [67_000_000n, 33_000_000n];
  return {
    dayId,
    status,
    finalizedAt: status === "finalized"
      ? dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET
      : 0,
    runsCloseAt: dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
    recoveryDeadlineAt: dayId * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
    entriesPaid: status === "funding" ? 0n : 2n,
    entriesScored: status === "funding" ? 0n : 2n,
    entriesExpired: 0n,
    potLamports,
    predecessorRolloverRequired: dayId !== DAY,
    predecessorRolloverApplied: dayId !== DAY,
    scoreQualifiedPlayers: owners.length,
    themeQualifiedPlayers: 0,
    scoreClaimedMask: 0n,
    themeClaimedMask: 0n,
    scoreProfileSyncMask: 0n,
    themeProfileSyncMask: 0n,
    claimsExpired: false,
    ...(status === "finalized" ? {
      scoreBoard: board("score", owners.length, dayId),
      themeBoard: board("theme", 0, dayId),
    } : {}),
    ...(status !== "funding" ? {
      settlement: {
        winners: owners.map((owner, index) => ({
          board: "score" as const,
          owner,
          rank: index + 1,
          payoutLamports: payouts[index]!,
        })),
        rolloverLamports: owners.length === 1
          ? 500_000n
          : owners.length === 2
            ? 1_500_000n
            : 0n,
        scoreCapacityLimited: false,
        themeCapacityLimited: false,
      },
    } : {}),
  };
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

function rankedRun(
  owner: PublicKey,
  lifecycle: "playing" | "terminal" | "unavailable",
  location: "base" | "ephemeral_rollup" | "unavailable",
) {
  return {
    owner,
    runId: 2n,
    mode: "ranked" as const,
    challengeDayId: DAY,
    deadlineDayId: DAY,
    arenaPlayerExists: true,
    lifecycle,
    location,
    acceptedActions: 1,
    runsCloseAt: DAY * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
    recoveryDeadlineAt: DAY * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
    reservationActive: true,
  };
}

function candidate(cadenceId: number, committed: boolean, closeEligible: boolean) {
  return {
    competition: "daily" as const,
    cadenceId,
    ...(committed ? {} : {
      canonicalJson: "{}",
      fileSha256: "01".repeat(32),
    }),
    resultHash: "02".repeat(32),
    requiredScoreProfileSyncMask: 0n,
    requiredThemeProfileSyncMask: 0n,
    claimsExpired: closeEligible,
    committed,
    closeEligible,
    closeEligibleAt: cadenceId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET +
      DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  };
}
