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
} from "../chain/dailyClient.js";
import { fetchEconomyRuntime } from "../chain/economyClient.js";
import { deriveDailyChallengePda } from "../chain/pdas.js";
import type { PaymasterClient } from "../chain/paymasterClient.js";
import { submitSponsoredTransactionPlan, type TransactionPlan } from "../chain/runPlan.js";
import { SessionWallet, type WalletLike } from "../chain/sessionWallet.js";
import {
  buildCloseWeeklyChallengePlan,
  buildCloseWeeklyPlayerPlan,
  buildFinalizeWeeklyPlan,
  buildForfeitWeeklyCashPlan,
  buildOpenWeeklyPlan,
  buildRollupDailyPlan,
  currentWeeklyId,
  fetchPendingDailyRollupOwners,
  fetchWeeklyChallengeIds,
  fetchWeeklyPlayerRecords,
  fetchWeeklyView,
  type WeeklyPlayerRecord,
  type WeeklyView,
} from "../chain/weeklyClient.js";
const DEFAULT_MAX_WRITES = 8;
const MAX_MAX_WRITES = 16;
const DEFAULT_MIN_PAYMASTER_LAMPORTS = 1_500_000_000;
const MAX_PASS_DURATION_MS = 210_000;

export interface KeeperLogEvent {
  schemaVersion: 1;
  event: "keeper_pass" | "keeper_operation" | "keeper_readiness";
  traceId: string;
  operation?: string;
  ok: boolean;
  durationMs?: number;
  signature?: string;
  writes?: number;
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
  operationFailures: number;
  maxWrites: number;
  backlog: number;
  balanceLamports: number;
  reserveLow: boolean;
}

export interface KeeperDependencies {
  connection: Connection;
  keeper: Keypair;
  paymaster: PaymasterClient;
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
    dependencies.minimumBalanceLamports ?? DEFAULT_MIN_PAYMASTER_LAMPORTS;
  const traceId = randomUUID();
  const log = dependencies.log ?? (() => undefined);
  const wallet = new SessionWallet(dependencies.keeper);
  const balanceLamports = await dependencies.connection.getBalance(
    dependencies.paymaster.pubkey,
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
  if (balanceLamports < minimumBalanceLamports) {
    throw new Error(
      `paymaster reserve ${balanceLamports} is below keeper floor ${minimumBalanceLamports}`,
    );
  }
  const runtime = await fetchEconomyRuntime({ connection: dependencies.connection, wallet });
  if (!runtime) throw new Error("lean economy accounts are not active on this deployment");

  let writes = 0;
  let backlog = 0;
  let operationFailures = 0;
  const execute = async (operation: string, plan: TransactionPlan): Promise<boolean> => {
    if (
      writes >= maxWrites ||
      Date.now() - startedAt >= MAX_PASS_DURATION_MS
    ) {
      backlog += 1;
      return false;
    }
    const operationStartedAt = Date.now();
    try {
      const signature = await submitSponsoredTransactionPlan({
        transactionPlan: plan,
        wallet,
        paymaster: dependencies.paymaster,
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
        paymaster: dependencies.paymaster.pubkey,
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
        paymaster: dependencies.paymaster.pubkey,
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
          paymaster: dependencies.paymaster.pubkey,
        }),
      );
    }
  }

  for (const candidateDay of dailyIds) {
    if (writes >= maxWrites) {
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
            paymaster: dependencies.paymaster.pubkey,
            playerOwner: owner,
          }),
        )) &&
        writes >= maxWrites
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
            paymaster: dependencies.paymaster.pubkey,
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
        "forfeit_weekly_cash",
        await buildForfeitWeeklyCashPlan({
          connection: dependencies.connection,
          wallet,
          weekly,
          paymaster: dependencies.paymaster.pubkey,
        }),
      );
    }
  }

  for (const candidateDay of dailyIds) {
    if (writes >= maxWrites) {
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
          paymaster: dependencies.paymaster.pubkey,
        }),
      );
      if (writes >= maxWrites) break;
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
          paymaster: dependencies.paymaster.pubkey,
        }),
      );
    }
  }

  for (const candidateWeek of weeklyIds) {
    if (writes >= maxWrites) {
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
          paymaster: dependencies.paymaster.pubkey,
        }),
      );
      if (writes >= maxWrites) break;
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
          paymaster: dependencies.paymaster.pubkey,
        }),
      );
    }
  }

  const result: KeeperPassResult = {
    ok: operationFailures === 0,
    traceId,
    writes,
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
    operationFailures,
    maxWrites,
    backlog,
  });
  return result;
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
  const cashWinner = rank >= 0 && rank < weekly.cashWinnerCount;
  const starWinner =
    rank >= 0 && rank < weekly.cashWinnerCount + weekly.starWinnerCount;
  return (!cashWinner || player.cashClaimed) && (!starWinner || player.starsClaimed);
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
