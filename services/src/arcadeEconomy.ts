import {
  ARENA_ENTRY_LAMPORTS,
  ENTRY_SPLIT_LAMPORTS,
  SOL_PAYOUT_UNIT_LAMPORTS,
} from "./arcadeChain.js";

const U64_MAX = 0xffff_ffff_ffff_ffffn;
const U128_MAX = 0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn;
const RANK_WEIGHT_SCALE = U64_MAX;
const MIN_BOARD_PAYOUT_PLACES = 4;

export interface BoardWidth {
  winnerCount: number;
  denominator: bigint;
}

export interface PayoutPlan {
  payouts: readonly bigint[];
  winnerCount: number;
  widthWinnerCount: number;
  denominator: bigint;
  capacityLimited: boolean;
  paidLamports: bigint;
  rolloverLamports: bigint;
}

export function dailyBoardPools(
  poolLamports: bigint,
  themeQualifiedWinners: number,
): { score: bigint; theme: bigint } {
  assertU64(poolLamports, "pool");
  assertU32(themeQualifiedWinners, "Theme qualified winner count");
  if (themeQualifiedWinners === 0) return { score: poolLamports, theme: 0n };
  const theme = poolLamports / 2n;
  return { score: poolLamports - theme, theme };
}

export function exactEntrySplit(entryLamports: bigint): typeof ENTRY_SPLIT_LAMPORTS {
  if (entryLamports !== ARENA_ENTRY_LAMPORTS) {
    throw new Error("ranked entry must be exactly 0.01 SOL");
  }
  const accounted = Object.values(ENTRY_SPLIT_LAMPORTS)
    .reduce((sum, amount) => checkedAdd(sum, amount), 0n);
  if (accounted !== entryLamports) {
    throw new Error("entry split does not conserve lamports");
  }
  return ENTRY_SPLIT_LAMPORTS;
}

/** Mirrors zkube-core's allocation-free harmonic width scan exactly. */
export function boardWidth(
  poolLamports: bigint,
  qualifiedWinners: number,
  entryPrice = ARENA_ENTRY_LAMPORTS,
  unitLamports = SOL_PAYOUT_UNIT_LAMPORTS,
): BoardWidth {
  assertU64(poolLamports, "pool");
  assertU32(qualifiedWinners, "qualified winner count");
  assertU64(entryPrice, "entry price");
  assertU64(unitLamports, "payout unit");
  if (entryPrice === 0n) throw new Error("entry price must be positive");
  if (unitLamports === 0n) throw new Error("payout unit must be positive");
  if (qualifiedWinners === 0) return { winnerCount: 0, denominator: 0n };

  const minimum = Math.min(qualifiedWinners, MIN_BOARD_PAYOUT_PLACES);
  let denominator = 0n;
  for (let rank = 1; rank <= minimum; rank += 1) {
    denominator = checkedAddWide(denominator, rankWeight(rank));
  }
  let winnerCount = minimum;
  for (let rank = minimum + 1; rank <= qualifiedWinners; rank += 1) {
    const candidateDenominator = checkedAddWide(denominator, rankWeight(rank));
    if (payoutForRank(poolLamports, candidateDenominator, rank, unitLamports) < entryPrice) {
      break;
    }
    denominator = candidateDenominator;
    winnerCount = rank;
  }

  while (winnerCount > 0 &&
      payoutForRank(poolLamports, denominator, winnerCount, unitLamports) === 0n) {
    winnerCount -= 1;
  }
  return { winnerCount, denominator };
}

export function payoutForRank(
  poolLamports: bigint,
  denominator: bigint,
  rank: number,
  unitLamports = SOL_PAYOUT_UNIT_LAMPORTS,
): bigint {
  assertU64(poolLamports, "pool");
  assertU128(denominator, "denominator");
  assertU64(unitLamports, "payout unit");
  if (denominator === 0n) throw new Error("payout denominator is zero");
  if (unitLamports === 0n) throw new Error("payout unit must be positive");
  const unitDenominator = checkedMulWide(denominator, unitLamports);
  const wholeUnits = checkedMulWide(poolLamports, rankWeight(rank)) / unitDenominator;
  const payout = checkedMulWide(wholeUnits, unitLamports);
  assertU64(payout, "payout");
  return payout;
}

export function rankWeightedPayoutPlan(
  poolLamports: bigint,
  qualifiedWinners: number,
  boardCapacity?: number,
  entryPrice = ARENA_ENTRY_LAMPORTS,
  unitLamports = SOL_PAYOUT_UNIT_LAMPORTS,
): PayoutPlan {
  const width = boardWidth(poolLamports, qualifiedWinners, entryPrice, unitLamports);
  const winnerCount = boardCapacity === undefined
    ? width.winnerCount
    : Math.min(width.winnerCount, boardCapacity);
  if (!Number.isSafeInteger(winnerCount) || winnerCount < 0) {
    throw new Error("board capacity is invalid");
  }
  const payouts = Array.from({ length: winnerCount }, (_, index) =>
    payoutForRank(poolLamports, width.denominator, index + 1, unitLamports));
  const paidLamports = payouts.reduce((sum, amount) => checkedAdd(sum, amount), 0n);
  return {
    payouts,
    winnerCount,
    widthWinnerCount: width.winnerCount,
    denominator: width.denominator,
    capacityLimited: winnerCount < width.winnerCount,
    paidLamports,
    rolloverLamports: poolLamports - paidLamports,
  };
}

function rankWeight(rank: number): bigint {
  assertU32(rank, "rank");
  if (rank === 0) throw new Error("rank must be positive");
  return RANK_WEIGHT_SCALE / BigInt(rank);
}

function assertU32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${label} is outside u32`);
  }
}

function assertU64(value: bigint, label: string): void {
  if (value < 0n || value > U64_MAX) throw new Error(`${label} is outside u64`);
}

function assertU128(value: bigint, label: string): void {
  if (value < 0n || value > U128_MAX) throw new Error(`${label} is outside u128`);
}

function checkedAdd(left: bigint, right: bigint): bigint {
  const value = left + right;
  assertU64(value, "sum");
  return value;
}

function checkedAddWide(left: bigint, right: bigint): bigint {
  const value = left + right;
  assertU128(value, "sum");
  return value;
}

function checkedMulWide(left: bigint, right: bigint): bigint {
  const value = left * right;
  assertU128(value, "product");
  return value;
}
