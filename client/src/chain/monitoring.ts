import {
  PublicKey,
  Transaction,
  type AccountInfo,
  type Connection,
  type VersionedTransaction,
} from "@solana/web3.js";

import { ZKUBE_PROGRAM_ID } from "./constants";
import type { ReadinessAlert } from "./readiness";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveEconomyConfigPda,
} from "./pdas";
import { zkubeProgram } from "./runPlan";
import type { WalletLike } from "./sessionWallet";

const DAILY_LEADERBOARD_CAPACITY = 50;
const U64_MAX = (1n << 64n) - 1n;

export interface DailyOperationalSnapshot {
  address: PublicKey;
  dayId: number;
  weekId: number;
  status: string;
  opensAt: number;
  entriesCloseAt: number;
  runsCloseAt: number;
  settlementGraceCloseAt: number;
  finalizedAt: number;
  entryStars: bigint;
  uniquePlayers: bigint;
  weeklyEligiblePlayers: bigint;
  weeklyRollups: bigint;
  attemptsStarted: bigint;
  runsFinalized: bigint;
  leaderboardSize: number;
}

export interface OperationalReadiness {
  ok: boolean;
  alerts: ReadinessAlert[];
  paymasterSolLamports: bigint;
  challenges: Array<{
    dayId: number;
    status: string;
    outstandingRuns: bigint | null;
    outstandingRollups: bigint | null;
  }>;
}

export interface OperationalThresholds {
  minPaymasterLamports?: bigint | null;
}

interface DecodedDailyChallenge {
  version: number;
  dayId: number;
  weekId: number;
  economyConfig: PublicKey;
  status: Record<string, unknown>;
  opensAt: Numeric;
  entriesCloseAt: Numeric;
  runsCloseAt: Numeric;
  settlementGraceCloseAt: Numeric;
  finalizedAt: Numeric;
  entryStars: Numeric;
  uniquePlayers: Numeric;
  weeklyEligiblePlayers: Numeric;
  weeklyRollups: Numeric;
  attemptsStarted: Numeric;
  runsFinalized: Numeric;
}

interface DecodedDailyLeaderboard {
  version: number;
  challenge: PublicKey;
  entries: Array<{
    player: PublicKey;
    featuredScore: number;
    engineScore: number;
    moves: number;
    submittedAt: Numeric;
  }>;
}

interface Numeric {
  toString(radix?: number): string;
}

const READ_ONLY_WALLET: WalletLike = {
  publicKey: ZKUBE_PROGRAM_ID,
  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    void transaction;
    throw new Error("read-only monitor cannot sign");
  },
  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    void transactions;
    throw new Error("read-only monitor cannot sign");
  },
};

export async function fetchDailyOperationalSnapshots(args: {
  connection: Connection;
  nowUnix: number;
  lookbackDays: number;
}): Promise<DailyOperationalSnapshot[]> {
  if (
    !Number.isInteger(args.lookbackDays) ||
    args.lookbackDays < 1 ||
    args.lookbackDays > 366
  ) {
    throw new Error("lookbackDays must be between 1 and 366");
  }
  const currentDay = Math.max(0, Math.floor(args.nowUnix / 86_400));
  const firstDay = Math.max(0, currentDay - args.lookbackDays + 1);
  const days = Array.from(
    { length: currentDay - firstDay + 1 },
    (_, index) => firstDay + index,
  );
  const challengeAddresses = days.map((day) => deriveDailyChallengePda(day));
  const challengeInfos = await getMultipleAccounts(
    args.connection,
    challengeAddresses,
  );
  const program = zkubeProgram(args.connection, READ_ONLY_WALLET);
  const decoded: Array<{
    address: PublicKey;
    challenge: DecodedDailyChallenge;
  }> = [];

  for (let index = 0; index < challengeInfos.length; index += 1) {
    const info = challengeInfos[index];
    if (!info) continue;
    const address = challengeAddresses[index];
    const expectedDay = days[index];
    if (!address || expectedDay === undefined)
      throw new Error("Daily scan index is invalid");
    assertProgramAccount(info, `Daily challenge ${expectedDay}`);
    const challenge = program.coder.accounts.decode(
      "dailyChallenge",
      info.data,
    ) as unknown as DecodedDailyChallenge;
    if (
      Number(challenge.version) !== 1 ||
      Number(challenge.dayId) !== expectedDay ||
      !challenge.economyConfig.equals(deriveEconomyConfigPda())
    )
      throw new Error(`Daily challenge ${expectedDay} relationship is invalid`);
    decoded.push({ address, challenge });
  }

  const leaderboardInfos = await getMultipleAccounts(
    args.connection,
    decoded.map(({ address }) => deriveDailyLeaderboardPda(address)),
  );
  return decoded.map(({ address, challenge }, index) => {
    const dayId = Number(challenge.dayId);
    const leaderboardInfo = leaderboardInfos[index];
    if (!leaderboardInfo)
      throw new Error(`Daily leaderboard ${dayId} is missing`);
    assertProgramAccount(leaderboardInfo, `Daily leaderboard ${dayId}`);
    const leaderboard = program.coder.accounts.decode(
      "dailyLeaderboard",
      leaderboardInfo.data,
    ) as unknown as DecodedDailyLeaderboard;
    assertLeaderboard(leaderboard, address, dayId);
    return {
      address,
      dayId,
      weekId: asSafeNumber(challenge.weekId, `Daily ${dayId} weekId`),
      status: Object.keys(challenge.status)[0] ?? "unknown",
      opensAt: asSafeNumber(challenge.opensAt, `Daily ${dayId} opensAt`),
      entriesCloseAt: asSafeNumber(
        challenge.entriesCloseAt,
        `Daily ${dayId} entriesCloseAt`,
      ),
      runsCloseAt: asSafeNumber(
        challenge.runsCloseAt,
        `Daily ${dayId} runsCloseAt`,
      ),
      settlementGraceCloseAt: asSafeNumber(
        challenge.settlementGraceCloseAt,
        `Daily ${dayId} settlementGraceCloseAt`,
      ),
      finalizedAt: asSafeNumber(
        challenge.finalizedAt,
        `Daily ${dayId} finalizedAt`,
      ),
      entryStars: asU64(challenge.entryStars, `Daily ${dayId} entryStars`),
      uniquePlayers: asU64(
        challenge.uniquePlayers,
        `Daily ${dayId} uniquePlayers`,
      ),
      weeklyEligiblePlayers: asU64(
        challenge.weeklyEligiblePlayers,
        `Daily ${dayId} weeklyEligiblePlayers`,
      ),
      weeklyRollups: asU64(
        challenge.weeklyRollups,
        `Daily ${dayId} weeklyRollups`,
      ),
      attemptsStarted: asU64(
        challenge.attemptsStarted,
        `Daily ${dayId} attemptsStarted`,
      ),
      runsFinalized: asU64(
        challenge.runsFinalized,
        `Daily ${dayId} runsFinalized`,
      ),
      leaderboardSize: leaderboard.entries.length,
    };
  });
}

export function evaluateOperationalReadiness(args: {
  nowUnix: number;
  paymasterSolLamports: bigint;
  daily: DailyOperationalSnapshot[];
  thresholds?: OperationalThresholds;
}): OperationalReadiness {
  const alerts: ReadinessAlert[] = [];
  const minPaymasterLamports = args.thresholds?.minPaymasterLamports ?? null;
  if (!Number.isInteger(args.nowUnix) || args.nowUnix < 0) {
    throw new Error("nowUnix must be a non-negative integer");
  }
  if (args.paymasterSolLamports < 0n)
    throw new Error("paymaster SOL balance cannot be negative");
  if (minPaymasterLamports !== null && minPaymasterLamports < 0n) {
    throw new Error("minimum paymaster balance cannot be negative");
  }
  if (args.paymasterSolLamports === 0n) {
    alerts.push(
      alert(
        "critical",
        "PAYMASTER_SOL_EMPTY",
        "Paymaster has no SOL for transaction fees",
      ),
    );
  } else if (
    minPaymasterLamports !== null &&
    args.paymasterSolLamports < minPaymasterLamports
  ) {
    alerts.push(
      alert(
        "warning",
        "PAYMASTER_SOL_LOW",
        "Paymaster SOL is below the configured threshold",
      ),
    );
  }

  const challenges = args.daily.map((daily) => {
    const context = `Daily ${daily.dayId}`;
    let outstandingRuns: bigint | null = null;
    let outstandingRollups: bigint | null = null;
    if (
      !(
        daily.opensAt < daily.entriesCloseAt &&
        daily.entriesCloseAt < daily.runsCloseAt &&
        daily.runsCloseAt < daily.settlementGraceCloseAt
      )
    ) {
      alerts.push(
        alert(
          "critical",
          "DAILY_WINDOW_ORDER",
          `${context} has invalid time windows`,
        ),
      );
    }
    if (daily.entryStars <= 0n) {
      alerts.push(
        alert(
          "critical",
          "DAILY_ENTRY_COST",
          `${context} has a zero Star entry cost`,
        ),
      );
    }
    if (daily.runsFinalized > daily.attemptsStarted) {
      alerts.push(
        alert(
          "critical",
          "DAILY_RUN_COUNTERS",
          `${context} finalized more runs than started`,
        ),
      );
    } else {
      outstandingRuns = daily.attemptsStarted - daily.runsFinalized;
      if (
        outstandingRuns > 0n &&
        args.nowUnix >= daily.settlementGraceCloseAt
      ) {
        alerts.push(
          alert(
            "warning",
            "DAILY_RUN_BACKLOG",
            `${context} has runs unresolved after grace cutoff`,
          ),
        );
      }
    }
    if (daily.weeklyEligiblePlayers > daily.uniquePlayers) {
      alerts.push(
        alert(
          "critical",
          "DAILY_ELIGIBILITY_COUNTERS",
          `${context} has more Weekly-eligible than unique players`,
        ),
      );
    }
    if (daily.weeklyRollups > daily.weeklyEligiblePlayers) {
      alerts.push(
        alert(
          "critical",
          "DAILY_ROLLUP_COUNTERS",
          `${context} rolled more players than eligible`,
        ),
      );
    } else {
      outstandingRollups = daily.weeklyEligiblePlayers - daily.weeklyRollups;
      if (daily.finalizedAt > 0 && outstandingRollups > 0n) {
        alerts.push(
          alert(
            "warning",
            "DAILY_ROLLUP_BACKLOG",
            `${context} has Weekly results awaiting rollup`,
          ),
        );
      }
    }
    if (BigInt(daily.leaderboardSize) > daily.uniquePlayers) {
      alerts.push(
        alert(
          "critical",
          "DAILY_LEADERBOARD_COUNTERS",
          `${context} leaderboard exceeds unique players`,
        ),
      );
    }
    if (daily.status === "open" && args.nowUnix >= daily.entriesCloseAt) {
      alerts.push(
        alert(
          "warning",
          "DAILY_OPEN_AFTER_ENTRY_CLOSE",
          `${context} remains open after entries closed`,
        ),
      );
    }
    return {
      dayId: daily.dayId,
      status: daily.status,
      outstandingRuns,
      outstandingRollups,
    };
  });

  return {
    ok: !alerts.some((entry) => entry.severity === "critical"),
    alerts,
    paymasterSolLamports: args.paymasterSolLamports,
    challenges,
  };
}

async function getMultipleAccounts(
  connection: Connection,
  addresses: PublicKey[],
): Promise<Array<AccountInfo<Buffer> | null>> {
  const results: Array<AccountInfo<Buffer> | null> = [];
  for (let offset = 0; offset < addresses.length; offset += 100) {
    results.push(
      ...(await connection.getMultipleAccountsInfo(
        addresses.slice(offset, offset + 100),
        "confirmed",
      )),
    );
  }
  return results;
}

function assertProgramAccount(info: AccountInfo<Buffer>, label: string): void {
  if (!info.owner.equals(ZKUBE_PROGRAM_ID))
    throw new Error(`${label} has the wrong owner`);
  if (info.executable) throw new Error(`${label} must not be executable`);
}

function assertLeaderboard(
  leaderboard: DecodedDailyLeaderboard,
  challenge: PublicKey,
  dayId: number,
): void {
  if (
    Number(leaderboard.version) !== 1 ||
    !leaderboard.challenge.equals(challenge) ||
    leaderboard.entries.length > DAILY_LEADERBOARD_CAPACITY
  )
    throw new Error(`Daily leaderboard ${dayId} relationship is invalid`);
  const players = new Set<string>();
  for (let index = 0; index < leaderboard.entries.length; index += 1) {
    const entry = leaderboard.entries[index];
    if (!entry || players.has(entry.player.toBase58())) {
      throw new Error(`Daily leaderboard ${dayId} contains duplicate players`);
    }
    players.add(entry.player.toBase58());
    if (index > 0) {
      const previous = leaderboard.entries[index - 1];
      if (previous && dailyEntryOutranks(entry, previous)) {
        throw new Error(`Daily leaderboard ${dayId} is not sorted`);
      }
    }
  }
}

function dailyEntryOutranks(
  candidate: DecodedDailyLeaderboard["entries"][number],
  current: DecodedDailyLeaderboard["entries"][number],
): boolean {
  if (candidate.featuredScore !== current.featuredScore)
    return candidate.featuredScore > current.featuredScore;
  if (candidate.engineScore !== current.engineScore)
    return candidate.engineScore > current.engineScore;
  if (candidate.moves !== current.moves) return candidate.moves > current.moves;
  const candidateTime = BigInt(candidate.submittedAt.toString());
  const currentTime = BigInt(current.submittedAt.toString());
  if (candidateTime !== currentTime) return candidateTime < currentTime;
  return candidate.player.toBase58() < current.player.toBase58();
}

function asU64(value: Numeric, label: string): bigint {
  const parsed = BigInt(value.toString());
  if (parsed < 0n || parsed > U64_MAX)
    throw new Error(`${label} is outside u64`);
  return parsed;
}

function asSafeNumber(value: Numeric, label: string): number {
  const parsed = Number(value.toString());
  if (!Number.isSafeInteger(parsed))
    throw new Error(`${label} is not a safe integer`);
  return parsed;
}

function alert(
  severity: ReadinessAlert["severity"],
  code: string,
  message: string,
): ReadinessAlert {
  return { severity, code, message };
}
