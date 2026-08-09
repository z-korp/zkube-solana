const FLOOR_UNIT = 1_000_000n;
const ENTRY_PRICE = 10_000_000n;
const RANK_WEIGHT_SCALE = 0xffff_ffff_ffff_ffffn;

export interface RankPayoutPlan {
  payouts: bigint[];
  winnerCount: number;
  paidLamports: bigint;
  rolloverLamports: bigint;
}

export function dailyBoardPools(
  potLamports: bigint,
  themeQualifiedPlayers: number,
): { score: bigint; theme: bigint } {
  if (themeQualifiedPlayers === 0) return { score: potLamports, theme: 0n };
  const theme = potLamports / 2n;
  return { score: potLamports - theme, theme };
}

export function computeRankPayouts(
  potLamports: bigint,
  qualifiedPlayers: number,
): RankPayoutPlan {
  if (potLamports < 0n || !Number.isInteger(qualifiedPlayers) ||
      qualifiedPlayers < 0 || qualifiedPlayers > 0xffff_ffff) {
    throw new Error("Rank payout input is invalid");
  }
  if (qualifiedPlayers === 0) {
    return { payouts: [], winnerCount: 0, paidLamports: 0n,
      rolloverLamports: potLamports };
  }
  const minimum = Math.min(qualifiedPlayers, 4);
  let denominator = 0n;
  for (let rank = 1; rank <= minimum; rank += 1) denominator += rankWeight(rank);
  let winnerCount = minimum;
  for (let rank = minimum + 1; rank <= qualifiedPlayers; rank += 1) {
    const candidate = denominator + rankWeight(rank);
    if (payoutForRank(potLamports, candidate, rank) < ENTRY_PRICE) break;
    denominator = candidate;
    winnerCount = rank;
  }
  while (winnerCount > 0 &&
      payoutForRank(potLamports, denominator, winnerCount) === 0n) {
    winnerCount -= 1;
  }
  const payouts = Array.from({ length: winnerCount }, (_, index) =>
    payoutForRank(potLamports, denominator, index + 1));
  const paidLamports = payouts.reduce((sum, payout) => sum + payout, 0n);
  return { payouts, winnerCount, paidLamports,
    rolloverLamports: potLamports - paidLamports };
}

function payoutForRank(pool: bigint, denominator: bigint, rank: number): bigint {
  if (denominator === 0n) throw new Error("Rank payout denominator is zero");
  const wholeUnits = pool * rankWeight(rank) / (denominator * FLOOR_UNIT);
  return wholeUnits * FLOOR_UNIT;
}

function rankWeight(rank: number): bigint {
  if (!Number.isInteger(rank) || rank < 1 || rank > 0xffff_ffff) {
    throw new Error("Rank is invalid");
  }
  return RANK_WEIGHT_SCALE / BigInt(rank);
}
