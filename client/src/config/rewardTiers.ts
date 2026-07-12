/**
 * Presentation-only Daily payout tiers. Unlike the original Cairo client's
 * static percentile/Stars table, Solana snapshots ten exact rank weights into
 * each DailyChallenge. Callers must pass that live snapshot.
 */
export interface RewardTier {
  rank: number;
  label: string;
  payoutBps: number;
}

export function getDailyRewardTiers(
  payoutBps: readonly number[],
): RewardTier[] {
  return payoutBps
    .slice(0, 10)
    .map((weight, index) => ({
      rank: index + 1,
      label: `#${index + 1}`,
      payoutBps: weight,
    }))
    .filter((tier) => tier.payoutBps > 0);
}

export function computeDailyReward(
  rank: number,
  settledPrizePool: bigint,
  payoutBps: readonly number[],
): bigint {
  if (!Number.isInteger(rank) || rank < 1 || rank > 10) return 0n;
  const weight = payoutBps[rank - 1] ?? 0;
  if (!Number.isInteger(weight) || weight <= 0) return 0n;
  return (settledPrizePool * BigInt(weight)) / 10_000n;
}
