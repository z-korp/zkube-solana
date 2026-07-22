import { useMemo } from "react";

import { DAILY_WEIGHTS, computePayouts } from "@/ui/components/economy";

/** Minimal leaderboard shape this hook needs: a 1-based rank and owner. */
export interface DailyRankEntry {
  rank: number;
  player: string;
}

export interface MyDailyRank {
  /** The connected wallet's 1-based Daily position, or null when unranked. */
  rank: number | null;
  /** True when the rank falls inside the paying places (top DAILY_WEIGHTS). */
  inMoney: boolean;
  /** Floored payout the wallet would win at its rank, or null when unranked
   *  or outside the paying places / when the pot is not yet known. */
  prizeLamports: bigint | null;
}

interface UseMyDailyRankArgs {
  /** Today's projected Daily leaderboard entries (rank + owner base58). */
  entries: readonly DailyRankEntry[];
  /** The connected wallet address, or null/empty when not connected. */
  address: string | null | undefined;
  /** Today's guaranteed pot in lamports, or null while it is being prepared. */
  potLamports: bigint | null;
}

/**
 * Resolve the connected wallet's standing in today's Daily: its rank, whether
 * that rank pays, and the floored SOL it would win right now. Purely derived
 * from the authoritative leaderboard and pot — it never touches the chain.
 */
export function useMyDailyRank({
  entries,
  address,
  potLamports,
}: UseMyDailyRankArgs): MyDailyRank {
  return useMemo(() => {
    if (!address) {
      return { rank: null, inMoney: false, prizeLamports: null };
    }
    const mine = entries.find((entry) => entry.player === address);
    if (!mine) {
      return { rank: null, inMoney: false, prizeLamports: null };
    }
    const rank = mine.rank;
    const inMoney = rank >= 1 && rank <= DAILY_WEIGHTS.length;
    const prizeLamports =
      potLamports !== null && rank >= 1 && rank <= DAILY_WEIGHTS.length
        ? (computePayouts(potLamports, DAILY_WEIGHTS)[rank - 1] ?? null)
        : null;
    return { rank, inMoney, prizeLamports };
  }, [entries, address, potLamports]);
}
