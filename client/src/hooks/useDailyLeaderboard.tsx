import { useMemo } from "react";

import { useDaily } from "@/contexts/daily";
import type { DailyLeaderboardView } from "@/chain/dailyClient";
import { truncatePublicKey } from "@/utils/solanaDisplay";

export interface DailyLeaderboardEntry {
  rank: number;
  player: string;
  playerName: string;
  receipt: string;
  runId: bigint;
  score: number;
  submittedAt: number;
}

export function projectDailyLeaderboard(
  entries: readonly DailyLeaderboardView[],
): DailyLeaderboardEntry[] {
  return entries.map((entry, index) => {
    const player = entry.player.toBase58();
    return {
      rank: index + 1,
      player,
      playerName: truncatePublicKey(player),
      receipt: entry.receipt.toBase58(),
      runId: entry.runId,
      score: entry.score,
      submittedAt: entry.submittedAt,
    };
  });
}

export function useDailyLeaderboard(challengeId: number | undefined) {
  const { daily, loading } = useDaily();
  const entries = useMemo<DailyLeaderboardEntry[]>(() => {
    if (challengeId === undefined || daily?.dayId !== challengeId) return [];
    return projectDailyLeaderboard(daily.leaderboard);
  }, [challengeId, daily]);
  return {
    entries,
    isLoading: loading && challengeId !== undefined,
  };
}

export default useDailyLeaderboard;
