/**
 * Bounded permissionless reconciliation worker.
 *
 * The keeper owns only its own signer. It derives current work from validated
 * chain state, submits at most the configured number of one-way transitions,
 * never overlaps passes, and stops write-enabled passes when the keeper's own
 * fee balance is below its reserve floor. Read-only passes still discover work
 * without signing or submitting. Orphan recovery may atomically consume an
 * exact copied-back terminal ActiveRun and close it, returning rent
 * only to the player's canonical System-owned funding PDA.
 */
import { randomUUID } from "node:crypto";
import { Connection, Keypair } from "@solana/web3.js";

import {
  buildCloseDailyChallengePlan,
  buildCloseDailyPlayerPlan,
  buildFinalizeDailyChallengePlan,
  buildOpenDailyChallengePlan,
  currentDailyDayId,
  fetchDailyChallengeIds,
  fetchDailyPlayerRecords,
  fetchDailyView,
  type DailyPlayerRecord,
  type DailyView,
} from "../../client/src/chain/dailyClient.js";
import { fetchEconomyRuntime } from "../../client/src/chain/economyClient.js";
import { deriveDailyChallengePda } from "../../client/src/chain/pdas.js";
import {
  buildConsumeRunRecoveryPlan,
  submitVersionedTransactionPlan,
  type TransactionPlan,
} from "../../client/src/chain/runPlan.js";
import { fetchOrphanedRunCandidates } from "../../client/src/chain/settlementRecovery.js";
import {
  buildRevokeExpiredSessionPlan,
  fetchExpiredZkubeSessions,
} from "../../client/src/chain/sessionCleanup.js";
import { SessionWallet, type WalletLike } from "../../client/src/chain/sessionWallet.js";
import {
  buildCloseWeeklyChallengePlan,
  buildCloseWeeklyPlayerPlan,
  buildFinalizeWeeklyPlan,
  buildForfeitWeeklySolPlan,
  buildOpenWeeklyPlan,
  buildRollupDailyPlan,
  currentWeeklyId,
  fetchPendingDailyRollupOwners,
  fetchWeeklyChallengeIds,
  fetchWeeklyPlayerRecords,
  fetchWeeklyView,
  type WeeklyPlayerRecord,
  type WeeklyView,
} from "../../client/src/chain/weeklyClient.js";
const DEFAULT_MAX_WRITES = 8;
const MAX_MAX_WRITES = 16;
/**
 * Covers a fresh Daily + Weekly cadence allocation (currently 46,200,480
 * refundable lamports) plus fees and operational headroom. Do not derive this
 * from Anchor client `account.size`: variable-capacity Vec allocations expose
 * only their fixed header there.
 */
export const DEFAULT_MIN_KEEPER_LAMPORTS = 100_000_000;
const MAX_PASS_DURATION_MS = 210_000;
const MAX_EXPIRED_SESSION_REVOKES_PER_PASS = 2;

export interface KeeperLogEvent {
  schemaVersion: 1;
  event:
    | "keeper_pass"
    | "keeper_operation"
    | "keeper_plan"
    | "keeper_readiness";
  traceId: string;
  operation?: string;
  ok: boolean;
  durationMs?: number;
  signature?: string;
  writes?: number;
  plannedWrites?: number;
  writeEnabled?: boolean;
  operationFailures?: number;
  maxWrites?: number;
  backlog?: number;
  balanceLamports?: number;
  minimumBalanceLamports?: number;
  error?: string;
}

export interface KeeperPassResult {
  ok: boolean;
  traceId: string;
  writes: number;
  plannedWrites: number;
  writeEnabled: boolean;
  operationFailures: number;
  maxWrites: number;
  backlog: number;
  balanceLamports: number;
  reserveLow: boolean;
}

export interface KeeperDependencies {
  connection: Connection;
  keeper: Keypair;
  /** Fail-closed production gate. False discovers work without signing or sending. */
  writeEnabled?: boolean;
  now?: () => number;
  maxWrites?: number;
  minimumBalanceLamports?: number;
  log?: (event: KeeperLogEvent) => void;
}

export function keeperKeypairFromEnv(
  env: Record<string, string | undefined> = process.env,
): Keypair {
  const encoded = env.KEEPER_SECRET_KEY;
  if (!encoded) throw new Error("KEEPER_SECRET_KEY is not configured");
  const parsed = JSON.parse(encoded) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    !parsed.every(
      (byte) => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255,
    )
  ) {
    throw new Error("KEEPER_SECRET_KEY must be a 64-byte JSON array");
  }
  const keypair = Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
  const expected = env.ZKUBE_KEEPER_PUBLIC_KEY;
  if (expected && keypair.publicKey.toBase58() !== expected) {
    throw new Error("KEEPER_SECRET_KEY does not match ZKUBE_KEEPER_PUBLIC_KEY");
  }
  return keypair;
}

export async function runKeeperPass(dependencies: KeeperDependencies): Promise<KeeperPassResult> {
  const startedAt = Date.now();
  const now = Math.floor((dependencies.now?.() ?? Date.now()) / 1_000);
  const maxWrites = Math.min(
    MAX_MAX_WRITES,
    Math.max(1, dependencies.maxWrites ?? DEFAULT_MAX_WRITES),
  );
  const minimumBalanceLamports =
    dependencies.minimumBalanceLamports ?? DEFAULT_MIN_KEEPER_LAMPORTS;
  const traceId = randomUUID();
  const log = dependencies.log ?? (() => undefined);
  const writeEnabled = dependencies.writeEnabled ?? true;
  const wallet = new SessionWallet(dependencies.keeper);
  const balanceLamports = await dependencies.connection.getBalance(
    dependencies.keeper.publicKey,
    "confirmed",
  );
  log({
    schemaVersion: 1,
    event: "keeper_readiness",
    traceId,
    ok: balanceLamports >= minimumBalanceLamports,
    balanceLamports,
    minimumBalanceLamports,
  });
  if (writeEnabled && balanceLamports < minimumBalanceLamports) {
    throw new Error(
      `keeper fee reserve ${balanceLamports} is below floor ${minimumBalanceLamports}`,
    );
  }
  const runtime = await fetchEconomyRuntime({ connection: dependencies.connection, wallet });
  if (!runtime) throw new Error("lean economy accounts are not active on this deployment");

  let writes = 0;
  let plannedWrites = 0;
  let backlog = 0;
  let operationFailures = 0;
  const capacityUsed = () => writes + plannedWrites;
  const execute = async (
    operation: string,
    plan: TransactionPlan,
  ): Promise<boolean> => {
    if (
      capacityUsed() >= maxWrites ||
      Date.now() - startedAt >= MAX_PASS_DURATION_MS
    ) {
      backlog += 1;
      return false;
    }
    const operationStartedAt = Date.now();
    if (!writeEnabled) {
      plannedWrites += 1;
      log({
        schemaVersion: 1,
        event: "keeper_plan",
        traceId,
        operation,
        ok: true,
        durationMs: Date.now() - operationStartedAt,
        writes,
        plannedWrites,
        writeEnabled: false,
      });
      return false;
    }
    try {
      const signature = await submitVersionedTransactionPlan({
        transactionPlan: plan,
        wallet,
      });
      await dependencies.connection.confirmTransaction(signature, "confirmed");
      writes += 1;
      log({
        schemaVersion: 1,
        event: "keeper_operation",
        traceId,
        operation,
        ok: true,
        durationMs: Date.now() - operationStartedAt,
        signature,
      });
      return true;
    } catch (error) {
      operationFailures += 1;
      log({
        schemaVersion: 1,
        event: "keeper_operation",
        traceId,
        operation,
        ok: false,
        durationMs: Date.now() - operationStartedAt,
        error: safeError(error),
      });
      return false;
    }
  };

  const orphanedRuns = await fetchOrphanedRunCandidates(
    dependencies.connection,
    maxWrites,
  );
  for (const candidate of orphanedRuns) {
    await execute(
      `finalize_orphaned_${candidate.mode}_run`,
      await buildConsumeRunRecoveryPlan({
        connection: dependencies.connection,
        wallet,
        owner: candidate.owner,
        runId: candidate.runId,
        addresses: candidate.addresses,
        mode: candidate.mode,
        dailyChallenge: candidate.dailyChallenge,
      }),
    );
  }

  const dayId = currentDailyDayId(now);
  const weekId = currentWeeklyId(now);
  let currentWeekly = await fetchWeeklyView({
    connection: dependencies.connection,
    wallet,
    weekId,
  });
  if (!currentWeekly) {
    await execute(
      "open_weekly_challenge",
      await buildOpenWeeklyPlan({
        connection: dependencies.connection,
        wallet,
        weekId,
        payer: dependencies.keeper.publicKey,
      }),
    );
    currentWeekly = await fetchWeeklyView({
      connection: dependencies.connection,
      wallet,
      weekId,
    });
  }
  let currentDaily = await fetchDailyView({
    connection: dependencies.connection,
    wallet,
    dayId,
  });
  if (!currentDaily && now % 86_400 < 23 * 60 * 60) {
    await execute(
      "open_daily_challenge",
      await buildOpenDailyChallengePlan({
        connection: dependencies.connection,
        wallet,
        dayId,
        payer: dependencies.keeper.publicKey,
      }),
    );
    currentDaily = await fetchDailyView({
      connection: dependencies.connection,
      wallet,
      dayId,
    });
  }
  void currentDaily;
  void currentWeekly;

  const dailyIds = await fetchDailyChallengeIds({
    connection: dependencies.connection,
    wallet,
  });
  for (const candidateDay of dailyIds) {
    const daily = await fetchDailyView({
      connection: dependencies.connection,
      wallet,
      dayId: candidateDay,
    });
    if (daily && dailyShouldFinalize(daily, now)) {
      await execute(
        "finalize_daily_challenge",
        await buildFinalizeDailyChallengePlan({
          connection: dependencies.connection,
          wallet,
          daily,
        }),
      );
    }
  }

  for (const candidateDay of dailyIds) {
    if (capacityUsed() >= maxWrites) {
      backlog += 1;
      break;
    }
    const daily = await fetchDailyView({
      connection: dependencies.connection,
      wallet,
      dayId: candidateDay,
    });
    if (!daily || daily.status !== "claimable") continue;
    const weekly = await fetchWeeklyView({
      connection: dependencies.connection,
      wallet,
      weekId: daily.weekId,
    });
    if (!weekly || weekly.status !== "open") continue;
    const owners = await fetchPendingDailyRollupOwners({
      connection: dependencies.connection,
      wallet,
      daily,
    });
    for (const owner of owners) {
      if (
        !(await execute(
          "rollup_daily_to_weekly",
          await buildRollupDailyPlan({
            connection: dependencies.connection,
            wallet,
            daily,
            weekly,
            playerOwner: owner,
          }),
        )) &&
        capacityUsed() >= maxWrites
      ) {
        backlog += owners.length;
        break;
      }
    }
  }

  const weeklyIds = await fetchWeeklyChallengeIds({
    connection: dependencies.connection,
    wallet,
  });
  for (const candidateWeek of weeklyIds) {
    let weekly = await fetchWeeklyView({
      connection: dependencies.connection,
      wallet,
      weekId: candidateWeek,
    });
    if (!weekly) continue;
    if (weekly.status === "open" && now >= weekly.finalizesAt) {
      const complete = await weeklyDailiesComplete({
        connection: dependencies.connection,
        wallet,
        weekly,
      });
      if (complete) {
        await execute(
          "finalize_weekly_challenge",
          await buildFinalizeWeeklyPlan({
            connection: dependencies.connection,
            wallet,
            weekly,
          }),
        );
        weekly = await fetchWeeklyView({
          connection: dependencies.connection,
          wallet,
          weekId: candidateWeek,
        });
        if (!weekly) continue;
      }
    }
    if (weekly.status === "claimable" && now > weekly.claimsCloseAt) {
      await execute(
        "forfeit_weekly_sol",
        await buildForfeitWeeklySolPlan({
          connection: dependencies.connection,
          wallet,
          weekly,
        }),
      );
    }
  }

  for (const candidateDay of dailyIds) {
    if (capacityUsed() >= maxWrites) {
      backlog += 1;
      break;
    }
    let daily = await fetchDailyView({
      connection: dependencies.connection,
      wallet,
      dayId: candidateDay,
    });
    if (!daily || (daily.status !== "claimable" && daily.status !== "cancelled")) continue;
    const weekly = await fetchWeeklyView({
      connection: dependencies.connection,
      wallet,
      weekId: daily.weekId,
    });
    if (!weekly || (weekly.status !== "claimable" && weekly.status !== "closed")) continue;
    const players = await fetchDailyPlayerRecords({
      connection: dependencies.connection,
      wallet,
      daily,
    });
    for (const player of players.filter((record) => dailyPlayerCanClose(daily!, record))) {
      await execute(
        "close_daily_player",
        await buildCloseDailyPlayerPlan({
          connection: dependencies.connection,
          wallet,
          daily,
          owner: player.owner,
        }),
      );
      if (capacityUsed() >= maxWrites) break;
    }
    daily = await fetchDailyView({
      connection: dependencies.connection,
      wallet,
      dayId: candidateDay,
    });
    if (daily && daily.closedPlayers === daily.uniquePlayers) {
      await execute(
        "close_daily_challenge",
        await buildCloseDailyChallengePlan({
          connection: dependencies.connection,
          wallet,
          daily,
        }),
      );
    }
  }

  for (const candidateWeek of weeklyIds) {
    if (capacityUsed() >= maxWrites) {
      backlog += 1;
      break;
    }
    let weekly = await fetchWeeklyView({
      connection: dependencies.connection,
      wallet,
      weekId: candidateWeek,
    });
    if (!weekly || (weekly.status !== "claimable" && weekly.status !== "closed")) continue;
    const players = await fetchWeeklyPlayerRecords({
      connection: dependencies.connection,
      wallet,
      weekly,
    });
    for (const player of players.filter((record) => weeklyPlayerCanClose(weekly!, record))) {
      await execute(
        "close_weekly_player",
        await buildCloseWeeklyPlayerPlan({
          connection: dependencies.connection,
          wallet,
          weekly,
          owner: player.owner,
        }),
      );
      if (capacityUsed() >= maxWrites) break;
    }
    weekly = await fetchWeeklyView({
      connection: dependencies.connection,
      wallet,
      weekId: candidateWeek,
    });
    if (
      weekly?.status === "closed" &&
      weekly.closedPlayers === weekly.participants &&
      (await weeklyDailiesClosed({ connection: dependencies.connection, weekId: candidateWeek }))
    ) {
      await execute(
        "close_weekly_challenge",
        await buildCloseWeeklyChallengePlan({
          connection: dependencies.connection,
          wallet,
          weekly,
        }),
      );
    }
  }

  const sessionCleanupAllowance = expiredSessionCleanupAllowance(
    capacityUsed(),
    maxWrites,
  );
  if (sessionCleanupAllowance > 0) {
    const expiredSessions = await fetchExpiredZkubeSessions({
      connection: dependencies.connection,
      nowUnix: now,
      maximum: sessionCleanupAllowance + 1,
    });
    if (expiredSessions.length > sessionCleanupAllowance) backlog += 1;
    for (const session of expiredSessions.slice(0, sessionCleanupAllowance)) {
      await execute(
        "revoke_expired_session",
        buildRevokeExpiredSessionPlan({
          connection: dependencies.connection,
          wallet,
          session,
          nowUnix: now,
        }),
      );
    }
  }

  const result: KeeperPassResult = {
    ok: operationFailures === 0,
    traceId,
    writes,
    plannedWrites,
    writeEnabled,
    operationFailures,
    maxWrites,
    backlog,
    balanceLamports,
    reserveLow: balanceLamports < minimumBalanceLamports,
  };
  log({
    schemaVersion: 1,
    event: "keeper_pass",
    traceId,
    ok: result.ok,
    durationMs: Date.now() - startedAt,
    writes,
    plannedWrites,
    writeEnabled,
    operationFailures,
    maxWrites,
    backlog,
  });
  return result;
}

export function expiredSessionCleanupAllowance(
  writes: number,
  maxWrites: number,
): number {
  return Math.min(
    MAX_EXPIRED_SESSION_REVOKES_PER_PASS,
    Math.max(0, maxWrites - writes),
  );
}

export function dailyShouldFinalize(daily: DailyView, nowUnix: number): boolean {
  return (
    daily.status === "open" &&
    nowUnix >= daily.runsCloseAt &&
    (daily.attemptsStarted === daily.runsFinalized || nowUnix >= daily.settlementGraceCloseAt)
  );
}

export function dailyPlayerCanClose(daily: DailyView, player: DailyPlayerRecord): boolean {
  if (player.attempts !== player.finalizedAttempts) return false;
  if (daily.status === "cancelled") return player.starRefunded;
  if (daily.status !== "claimable") return false;
  return player.bestRunId === 0n || player.weeklyRolledUp;
}

export function weeklyPlayerCanClose(weekly: WeeklyView, player: WeeklyPlayerRecord): boolean {
  if (weekly.status === "closed") return true;
  if (weekly.status !== "claimable") return false;
  const rank = weekly.leaderboard.findIndex((entry) => entry.player.equals(player.owner));
  const solWinner = rank >= 0 && rank < weekly.solWinnerCount;
  const starWinner =
    rank >= 0 && rank < weekly.solWinnerCount + weekly.starWinnerCount;
  return (!solWinner || player.solClaimed) && (!starWinner || player.starsClaimed);
}

async function weeklyDailiesComplete(args: {
  connection: Connection;
  wallet: WalletLike;
  weekly: WeeklyView;
}): Promise<boolean> {
  const startDay = args.weekly.weekId * 7 - 3;
  const dailies = await Promise.all(
    Array.from({ length: 7 }, (_, offset) =>
      fetchDailyView({
        connection: args.connection,
        wallet: args.wallet,
        dayId: startDay + offset,
      }),
    ),
  );
  return dailies.every(
    (daily) =>
      !daily ||
      (daily.status === "cancelled" && daily.weeklyRollups === 0) ||
      (daily.status === "claimable" && daily.weeklyRollups === daily.weeklyEligiblePlayers),
  );
}

async function weeklyDailiesClosed(args: {
  connection: Connection;
  weekId: number;
}): Promise<boolean> {
  const startDay = args.weekId * 7 - 3;
  const infos = await args.connection.getMultipleAccountsInfo(
    Array.from({ length: 7 }, (_, offset) => deriveDailyChallengePda(startDay + offset)),
    "confirmed",
  );
  return infos.every((info) => info === null);
}

export function boundedKeeperInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 240);
}
