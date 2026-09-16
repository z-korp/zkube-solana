import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  DAILY_RUN_CLOSE_OFFSET,
  SECONDS_PER_DAY,
  arcadeConfigPda,
  cadenceFundingPda,
} from "../src/arcadeChain";
import {
  discoverReconciliationPlans,
  type DailySnapshot,
  type ProtocolSnapshot,
} from "../src/arcadeReconciliation";
import { KEEPER_PLAN_INSTRUCTION } from "../src/arcadeChain";

const DAY = 20_651;
const NOW = DAY * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET + 1;

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
        suspendedUntilDay: 95,
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

  it("routes terminal Arcade runs by location", () => {
    const baseOwner = Keypair.generate().publicKey;
    const arcadeOwner = Keypair.generate().publicKey;
    const plans = discoverReconciliationPlans({
      snapshot: snapshot({
        launchDayId: DAY,
        dailies: [daily(DAY, "open")],
        runs: [
          { ...arcadeRun(baseOwner, "terminal", "base"), runId: 1n },
          arcadeRun(arcadeOwner, "terminal", "ephemeral_rollup"),
        ],
      }),
      nowUnix: NOW,
    });
    expect(plans.map(({ operation }) => operation)
      .filter((operation) => operation.includes("run") || operation === "commit_run"))
      .toEqual([
      "consume_arena_run",
      "commit_run",
    ]);
  });

  it("validates every emitted recovery plan inside discovery", () => {
    const plans = discoverReconciliationPlans({
      snapshot: snapshot({
        launchDayId: DAY,
        dailies: [daily(DAY, "open")],
        runs: [
          arcadeRun(Keypair.generate().publicKey, "terminal", "ephemeral_rollup"),
          { ...arcadeRun(Keypair.generate().publicKey, "terminal", "base"), runId: 4n },
          arcadeRun(Keypair.generate().publicKey, "playing", "ephemeral_rollup"),
          arcadeRun(Keypair.generate().publicKey, "unavailable", "unavailable"),
          {
            ...arcadeRun(Keypair.generate().publicKey, "playing", "base"),
            runId: 5n,
            reservationActive: false,
          },
        ],
      }),
      nowUnix: NOW,
    });
    const runOperations = new Set([
      "finish_run",
      "expire_unresolved_arena_run",
      "commit_run",
      "consume_arena_run",
      "cleanup_orphan_active_run",
    ]);
    const runPlans = plans.filter(({ operation }) => runOperations.has(operation));
    expect(new Set(runPlans.map(({ operation }) => operation))).toEqual(runOperations);
    expect(runPlans.every(({ execution }) => execution === "validation_only"))
      .toBe(true);
  });

  it("finishes reachable ER state and expires unavailable arcade state", () => {
    const plans = discoverReconciliationPlans({
      snapshot: snapshot({
        launchDayId: DAY,
        dailies: [daily(DAY, "open")],
        runs: [
          arcadeRun(Keypair.generate().publicKey, "playing", "ephemeral_rollup"),
          arcadeRun(Keypair.generate().publicKey, "unavailable", "unavailable"),
        ],
      }),
      nowUnix: NOW,
    });
    expect(plans.map(({ operation }) => operation)
      .filter((operation) => operation === "finish_run" ||
        operation === "expire_unresolved_arena_run")).toEqual([
      "finish_run",
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

  it("archives sequentially and closes only a committed Daily", () => {
    const finalized = daily(DAY, "finalized");
    const base = snapshot({
      launchDayId: DAY,
      dailies: [finalized],
      archiveState: {
        address: arcadeConfigPda(),
        cadenceFunding: cadenceFundingPda(),
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
          address: arcadeConfigPda(),
          cadenceFunding: cadenceFundingPda(),
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
      .toMatchObject({ dayId: DAY });
  });

  it("keeps monetary, archive, and cleanup ordering stable", () => {
    expect(KEEPER_PLAN_INSTRUCTION.finalize_arena_daily.priority)
      .toBeLessThan(KEEPER_PLAN_INSTRUCTION.archive_arena_daily.priority);
    expect(KEEPER_PLAN_INSTRUCTION.archive_arena_daily.priority)
      .toBeLessThan(KEEPER_PLAN_INSTRUCTION.expire_daily_claims.priority);
    expect(KEEPER_PLAN_INSTRUCTION.expire_daily_claims.priority)
      .toBeLessThan(KEEPER_PLAN_INSTRUCTION.close_arena_daily.priority);
  });
});

function snapshot(overrides: Partial<ProtocolSnapshot> = {}): ProtocolSnapshot {
  return {
    paused: true,
    launchDayId: DAY,
    suspendedUntilDay: 0,
    dailies: [],
    runs: [],
    archiveCandidates: [],
    ...overrides,
  };
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
    capacityLimited: false,
  };
}

function arcadeRun(
  owner: PublicKey,
  lifecycle: "playing" | "terminal" | "unavailable",
  location: "base" | "ephemeral_rollup" | "unavailable",
) {
  return {
    owner,
    rentPayer: Keypair.generate().publicKey,
    runId: 2n,
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
    cadenceId,
    claimsExpired: closeEligible,
    committed,
    closeEligibleAt: cadenceId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET +
      DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  };
}
