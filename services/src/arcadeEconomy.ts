import {
  ARENA_ENTRY_LAMPORTS,
  ENTRY_SPLIT_LAMPORTS,
  SOL_PAYOUT_UNIT_LAMPORTS,
} from "./arcadeChain.js";

const U64_MAX = 0xffff_ffff_ffff_ffffn;
const U128_MAX = 0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn;

export interface PayoutPlan {
  payouts: readonly bigint[];
  paidLamports: bigint;
  rolloverLamports: bigint;
}

export interface EqualBudgetPlan {
  budgets: readonly bigint[];
  allocatedLamports: bigint;
  rolloverLamports: bigint;
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

export function payoutPlan(
  poolLamports: bigint,
  weights: readonly number[],
  winnerCount: number,
  unitLamports = SOL_PAYOUT_UNIT_LAMPORTS,
): PayoutPlan {
  assertU64(poolLamports, "pool");
  assertU64(unitLamports, "payout unit");
  if (unitLamports === 0n) throw new Error("payout unit must be positive");
  if (!Number.isSafeInteger(winnerCount) || winnerCount < 1 ||
      winnerCount > weights.length) {
    throw new Error("winner count is invalid");
  }
  const active = weights.slice(0, winnerCount);
  if (active.some((weight) => !Number.isSafeInteger(weight) || weight <= 0)) {
    throw new Error("payout weights must be positive integers");
  }
  const denominator = active.reduce((sum, weight) => sum + BigInt(weight), 0n);
  const payouts = weights.map((weight, index) => {
    if (index >= winnerCount) return 0n;
    const proportional = checkedMulWide(poolLamports, BigInt(weight)) / denominator;
    return proportional / unitLamports * unitLamports;
  });
  const paidLamports = payouts.reduce((sum, amount) => checkedAdd(sum, amount), 0n);
  return {
    payouts,
    paidLamports,
    rolloverLamports: poolLamports - paidLamports,
  };
}

export function equalBudgetPlan(
  poolLamports: bigint,
  budgetCount: number,
  unitLamports = SOL_PAYOUT_UNIT_LAMPORTS,
): EqualBudgetPlan {
  assertU64(poolLamports, "pool");
  assertU64(unitLamports, "payout unit");
  if (unitLamports === 0n) throw new Error("payout unit must be positive");
  if (!Number.isSafeInteger(budgetCount) || budgetCount < 1) {
    throw new Error("budget count is invalid");
  }
  const divisor = checkedMulWide(BigInt(budgetCount), unitLamports);
  const budget = poolLamports / divisor * unitLamports;
  const budgets = Array.from({ length: budgetCount }, () => budget);
  const allocatedLamports = checkedMulWide(budget, BigInt(budgetCount));
  assertU64(allocatedLamports, "allocated amount");
  return {
    budgets,
    allocatedLamports,
    rolloverLamports: poolLamports - allocatedLamports,
  };
}

function assertU64(value: bigint, label: string): void {
  if (value < 0n || value > U64_MAX) throw new Error(`${label} is outside u64`);
}

function checkedAdd(left: bigint, right: bigint): bigint {
  const value = left + right;
  assertU64(value, "sum");
  return value;
}

function checkedMulWide(left: bigint, right: bigint): bigint {
  const value = left * right;
  if (value < 0n || value > U128_MAX) throw new Error("product is outside u128");
  return value;
}
