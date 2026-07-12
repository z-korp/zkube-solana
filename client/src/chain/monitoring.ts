import { unpackAccount } from "@solana/spl-token";
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
  deriveDailyVaultPda,
} from "./pdas";
import { zkubeProgram } from "./runPlan";
import type { WalletLike } from "./sessionWallet";
import type { TreasuryView } from "./treasuryClient";

const DAILY_WINNERS = 10;
const U64_MAX = (1n << 64n) - 1n;

export interface DailyOperationalSnapshot {
  address: PublicKey;
  dayId: number;
  status: string;
  opensAt: number;
  entriesCloseAt: number;
  runsCloseAt: number;
  settlementGraceCloseAt: number;
  finalizedAt: number;
  claimsCloseAt: number;
  sponsorFunding: bigint;
  paidEntryFunding: bigint;
  prizeLiability: bigint;
  rakeAccrued: bigint;
  rakeDistributed: bigint;
  refundsPaid: bigint;
  prizeClaimed: bigint;
  prizeForfeited: bigint;
  settledPrizePool: bigint;
  sponsorReclaimed: boolean;
  runsStarted: bigint;
  runsFinalized: bigint;
  paymentVault: PublicKey;
  vaultBalance: bigint;
  leaderboardSize: number;
}

export interface OperationalReadiness {
  ok: boolean;
  alerts: ReadinessAlert[];
  paymasterSolLamports: bigint;
  challenges: Array<{
    dayId: number;
    status: string;
    expectedVaultBalance: bigint | null;
    actualVaultBalance: bigint;
    outstandingRuns: bigint | null;
  }>;
}

export interface OperationalThresholds {
  minPaymasterLamports?: bigint | null;
  claimWarningSeconds?: number;
}

interface DecodedDailyChallenge {
  version: number;
  dayId: number;
  status: Record<string, unknown>;
  paymentMint: PublicKey;
  paymentTokenProgram: PublicKey;
  paymentVault: PublicKey;
  opensAt: Numeric;
  entriesCloseAt: Numeric;
  runsCloseAt: Numeric;
  settlementGraceCloseAt: Numeric;
  finalizedAt: Numeric;
  claimsCloseAt: Numeric;
  sponsorFunding: Numeric;
  paidEntryFunding: Numeric;
  prizeLiability: Numeric;
  rakeAccrued: Numeric;
  rakeDistributed: Numeric;
  refundsPaid: Numeric;
  prizeClaimed: Numeric;
  prizeForfeited: Numeric;
  settledPrizePool: Numeric;
  sponsorReclaimed: boolean;
  runsStarted: Numeric;
  runsFinalized: Numeric;
}

interface DecodedDailyLeaderboard {
  version: number;
  challenge: PublicKey;
  entries: Array<{
    player: PublicKey;
    score: number;
    submittedAt: Numeric;
  }>;
}

interface Numeric {
  toString(radix?: number): string;
}

const READ_ONLY_WALLET: WalletLike = {
  publicKey: ZKUBE_PROGRAM_ID,
  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    void transaction;
    throw new Error("read-only monitor cannot sign");
  },
  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    void transactions;
    throw new Error("read-only monitor cannot sign");
  },
};

export async function fetchDailyOperationalSnapshots(args: {
  connection: Connection;
  treasury: TreasuryView;
  nowUnix: number;
  lookbackDays: number;
}): Promise<DailyOperationalSnapshot[]> {
  if (!Number.isInteger(args.lookbackDays) || args.lookbackDays < 1 || args.lookbackDays > 366) {
    throw new Error("lookbackDays must be between 1 and 366");
  }
  const currentDay = Math.max(0, Math.floor(args.nowUnix / 86_400));
  const firstDay = Math.max(0, currentDay - args.lookbackDays + 1);
  const days = Array.from({ length: currentDay - firstDay + 1 }, (_, index) => firstDay + index);
  const challengeAddresses = days.map((day) => deriveDailyChallengePda(day));
  const challengeInfos = await getMultipleAccounts(args.connection, challengeAddresses);
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
    if (!address || expectedDay === undefined) throw new Error("Daily scan index is invalid");
    assertProgramAccount(info, `Daily challenge ${expectedDay}`);
    const challenge = program.coder.accounts.decode(
      "dailyChallenge",
      info.data,
    ) as unknown as DecodedDailyChallenge;
    if (
      Number(challenge.version) !== 1
      || Number(challenge.dayId) !== expectedDay
      || !challenge.paymentMint.equals(args.treasury.paymentMint)
      || !challenge.paymentTokenProgram.equals(args.treasury.paymentTokenProgram)
      || !challenge.paymentVault.equals(deriveDailyVaultPda(expectedDay))
    ) throw new Error(`Daily challenge ${expectedDay} relationship is invalid`);
    decoded.push({ address, challenge });
  }

  const vaultInfos = await getMultipleAccounts(
    args.connection,
    decoded.map(({ challenge }) => challenge.paymentVault),
  );
  const leaderboardAddresses = decoded.map(({ address }) => deriveDailyLeaderboardPda(address));
  const leaderboardInfos = await getMultipleAccounts(args.connection, leaderboardAddresses);
  return decoded.map(({ address, challenge }, index) => {
    const dayId = Number(challenge.dayId);
    const vaultInfo = vaultInfos[index];
    if (!vaultInfo) throw new Error(`Daily vault ${dayId} is missing`);
    if (!vaultInfo.owner.equals(args.treasury.paymentTokenProgram)) {
      throw new Error(`Daily vault ${dayId} has the wrong token program`);
    }
    const tokenAccount = unpackAccount(
      challenge.paymentVault,
      vaultInfo,
      args.treasury.paymentTokenProgram,
    );
    if (!tokenAccount.mint.equals(args.treasury.paymentMint) || !tokenAccount.owner.equals(address)) {
      throw new Error(`Daily vault ${dayId} authority or mint is invalid`);
    }
    const leaderboardInfo = leaderboardInfos[index];
    if (!leaderboardInfo) throw new Error(`Daily leaderboard ${dayId} is missing`);
    assertProgramAccount(leaderboardInfo, `Daily leaderboard ${dayId}`);
    const leaderboard = program.coder.accounts.decode(
      "dailyLeaderboard",
      leaderboardInfo.data,
    ) as unknown as DecodedDailyLeaderboard;
    assertLeaderboard(leaderboard, address, dayId);
    return {
      address,
      dayId,
      status: Object.keys(challenge.status)[0] ?? "unknown",
      opensAt: asSafeNumber(challenge.opensAt, `Daily ${dayId} opensAt`),
      entriesCloseAt: asSafeNumber(challenge.entriesCloseAt, `Daily ${dayId} entriesCloseAt`),
      runsCloseAt: asSafeNumber(challenge.runsCloseAt, `Daily ${dayId} runsCloseAt`),
      settlementGraceCloseAt: asSafeNumber(
        challenge.settlementGraceCloseAt,
        `Daily ${dayId} settlementGraceCloseAt`,
      ),
      finalizedAt: asSafeNumber(challenge.finalizedAt, `Daily ${dayId} finalizedAt`),
      claimsCloseAt: asSafeNumber(challenge.claimsCloseAt, `Daily ${dayId} claimsCloseAt`),
      sponsorFunding: asU64(challenge.sponsorFunding, `Daily ${dayId} sponsorFunding`),
      paidEntryFunding: asU64(challenge.paidEntryFunding, `Daily ${dayId} paidEntryFunding`),
      prizeLiability: asU64(challenge.prizeLiability, `Daily ${dayId} prizeLiability`),
      rakeAccrued: asU64(challenge.rakeAccrued, `Daily ${dayId} rakeAccrued`),
      rakeDistributed: asU64(challenge.rakeDistributed, `Daily ${dayId} rakeDistributed`),
      refundsPaid: asU64(challenge.refundsPaid, `Daily ${dayId} refundsPaid`),
      prizeClaimed: asU64(challenge.prizeClaimed, `Daily ${dayId} prizeClaimed`),
      prizeForfeited: asU64(challenge.prizeForfeited, `Daily ${dayId} prizeForfeited`),
      settledPrizePool: asU64(challenge.settledPrizePool, `Daily ${dayId} settledPrizePool`),
      sponsorReclaimed: Boolean(challenge.sponsorReclaimed),
      runsStarted: asU64(challenge.runsStarted, `Daily ${dayId} runsStarted`),
      runsFinalized: asU64(challenge.runsFinalized, `Daily ${dayId} runsFinalized`),
      paymentVault: challenge.paymentVault,
      vaultBalance: tokenAccount.amount,
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
  const claimWarningSeconds = args.thresholds?.claimWarningSeconds ?? 72 * 60 * 60;
  const minPaymasterLamports = args.thresholds?.minPaymasterLamports ?? null;
  if (!Number.isInteger(args.nowUnix) || args.nowUnix < 0) {
    throw new Error("nowUnix must be a non-negative integer");
  }
  if (!Number.isInteger(claimWarningSeconds) || claimWarningSeconds < 0) {
    throw new Error("claimWarningSeconds must be a non-negative integer");
  }
  if (args.paymasterSolLamports < 0n) throw new Error("paymaster SOL balance cannot be negative");
  if (minPaymasterLamports !== null && minPaymasterLamports < 0n) {
    throw new Error("minimum paymaster balance cannot be negative");
  }
  if (args.paymasterSolLamports === 0n) {
    alerts.push(alert("critical", "PAYMASTER_SOL_EMPTY", "Paymaster has no SOL for transaction fees"));
  } else if (minPaymasterLamports !== null && args.paymasterSolLamports < minPaymasterLamports) {
    alerts.push(alert("warning", "PAYMASTER_SOL_LOW", "Paymaster SOL is below the configured threshold"));
  }

  const challenges = args.daily.map((daily) => {
    const context = `Daily ${daily.dayId}`;
    let expectedVaultBalance: bigint | null = null;
    let outstandingRuns: bigint | null = null;
    if (!(daily.opensAt < daily.entriesCloseAt
      && daily.entriesCloseAt < daily.runsCloseAt
      && daily.runsCloseAt < daily.settlementGraceCloseAt)) {
      alerts.push(alert("critical", "DAILY_WINDOW_ORDER", `${context} has invalid time windows`));
    }
    if (daily.runsFinalized > daily.runsStarted) {
      alerts.push(alert("critical", "DAILY_RUN_COUNTERS", `${context} finalized more runs than started`));
    } else {
      outstandingRuns = daily.runsStarted - daily.runsFinalized;
      if (outstandingRuns > 0n && args.nowUnix >= daily.settlementGraceCloseAt) {
        alerts.push(alert("warning", "DAILY_RUN_BACKLOG", `${context} has runs unresolved after grace cutoff`));
      }
    }

    const sponsorReturned = daily.sponsorReclaimed ? daily.sponsorFunding : 0n;
    const inflows = daily.paidEntryFunding + daily.sponsorFunding;
    const outflows = daily.refundsPaid
      + sponsorReturned
      + daily.rakeDistributed
      + daily.prizeClaimed
      + daily.prizeForfeited;
    const outstandingRake = daily.rakeAccrued - daily.rakeDistributed;
    if (outflows > inflows || outstandingRake < 0n) {
      alerts.push(alert("critical", "DAILY_ACCOUNTING_UNDERFLOW", `${context} accounting underflows`));
    } else {
      expectedVaultBalance = inflows - outflows;
      const trackedBalance = daily.prizeLiability + outstandingRake;
      if (expectedVaultBalance !== trackedBalance) {
        alerts.push(alert("critical", "DAILY_ACCOUNTING_DRIFT", `${context} liability accounting does not balance`));
      }
      if (daily.vaultBalance < expectedVaultBalance) {
        alerts.push(alert("critical", "DAILY_VAULT_DEFICIT", `${context} vault is below recorded liabilities`));
      } else if (daily.vaultBalance > expectedVaultBalance) {
        alerts.push(alert("warning", "DAILY_VAULT_SURPLUS", `${context} vault contains unclassified surplus tokens`));
      }
    }
    if (
      daily.finalizedAt > 0
      && daily.prizeClaimed + daily.prizeForfeited > daily.settledPrizePool
    ) alerts.push(alert("critical", "DAILY_PRIZE_OVERPAY", `${context} resolved prizes exceed the settled pool`));

    if (daily.status === "open" && args.nowUnix >= daily.entriesCloseAt) {
      alerts.push(alert("warning", "DAILY_OPEN_AFTER_ENTRY_CLOSE", `${context} remains open after entries closed`));
    }
    if (daily.status === "claimable" && daily.claimsCloseAt > 0 && daily.prizeLiability > 0n) {
      if (args.nowUnix > daily.claimsCloseAt) {
        alerts.push(alert("warning", "DAILY_FORFEITURE_DUE", `${context} has expired unclaimed prizes`));
      } else if (daily.claimsCloseAt - args.nowUnix <= claimWarningSeconds) {
        alerts.push(alert("warning", "DAILY_CLAIMS_CLOSING", `${context} prize claims close soon`));
      }
    }
    if (daily.status === "cancelled") {
      if (daily.refundsPaid < daily.paidEntryFunding) {
        alerts.push(alert("warning", "DAILY_REFUND_BACKLOG", `${context} has unpaid entry refunds`));
      }
      if (daily.sponsorFunding > 0n && !daily.sponsorReclaimed) {
        alerts.push(alert("warning", "DAILY_SPONSOR_RECLAIM_DUE", `${context} sponsor funds are not reclaimed`));
      }
    }
    return {
      dayId: daily.dayId,
      status: daily.status,
      expectedVaultBalance,
      actualVaultBalance: daily.vaultBalance,
      outstandingRuns,
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
    results.push(...await connection.getMultipleAccountsInfo(
      addresses.slice(offset, offset + 100),
      "confirmed",
    ));
  }
  return results;
}

function assertProgramAccount(info: AccountInfo<Buffer>, label: string): void {
  if (!info.owner.equals(ZKUBE_PROGRAM_ID)) throw new Error(`${label} has the wrong owner`);
  if (info.executable) throw new Error(`${label} must not be executable`);
}

function assertLeaderboard(
  leaderboard: DecodedDailyLeaderboard,
  challenge: PublicKey,
  dayId: number,
): void {
  if (
    Number(leaderboard.version) !== 1
    || !leaderboard.challenge.equals(challenge)
    || leaderboard.entries.length > DAILY_WINNERS
  ) throw new Error(`Daily leaderboard ${dayId} relationship is invalid`);
  const players = new Set<string>();
  for (let index = 0; index < leaderboard.entries.length; index += 1) {
    const entry = leaderboard.entries[index];
    if (!entry || players.has(entry.player.toBase58())) {
      throw new Error(`Daily leaderboard ${dayId} contains duplicate players`);
    }
    players.add(entry.player.toBase58());
    const next = leaderboard.entries[index + 1];
    if (!next) continue;
    const submittedAt = asSafeNumber(entry.submittedAt, `Daily leaderboard ${dayId} time`);
    const nextSubmittedAt = asSafeNumber(next.submittedAt, `Daily leaderboard ${dayId} time`);
    if (
      entry.score < next.score
      || entry.score === next.score && submittedAt > nextSubmittedAt
      || entry.score === next.score
        && submittedAt === nextSubmittedAt
        && comparePublicKeys(entry.player, next.player) > 0
    ) throw new Error(`Daily leaderboard ${dayId} ordering is invalid`);
  }
}

function comparePublicKeys(left: PublicKey, right: PublicKey): number {
  return Buffer.compare(left.toBuffer(), right.toBuffer());
}

function asU64(value: Numeric, label: string): bigint {
  const parsed = BigInt(value.toString());
  if (parsed < 0n || parsed > U64_MAX) throw new Error(`${label} is outside u64 bounds`);
  return parsed;
}

function asSafeNumber(value: Numeric, label: string): number {
  const parsed = Number(value.toString());
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is not a safe integer`);
  return parsed;
}

function alert(
  severity: ReadinessAlert["severity"],
  code: string,
  message: string,
): ReadinessAlert {
  return { severity, code, message };
}
