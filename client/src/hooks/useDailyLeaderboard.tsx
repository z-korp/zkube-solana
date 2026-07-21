import { useMemo } from "react";

import { useDaily } from "@/contexts/daily";
import {
  dailyLeaderboardRank,
  type DailyLeaderboardView,
} from "@/chain/dailyClient";
import { truncatePublicKey } from "@/utils/solanaDisplay";

export interface DailyLeaderboardEntry {
  rank: number;
  player: string;
  playerName: string;
  runId: bigint;
  finalizedAttempts: number;
  score: number;
  dailyScore: number;
  dailyBonusTriggers: number;
  engineScore: number;
  moves: number;
  submittedAt: number;
}

export function projectDailyLeaderboard(
  entries: readonly DailyLeaderboardView[],
): DailyLeaderboardEntry[] {
  return entries.map((entry, index) => {
    const player = entry.player.toBase58();
    return {
      rank: dailyLeaderboardRank(entries, index),
      player,
      playerName: entry.playerName ?? truncatePublicKey(player),
      runId: entry.runId,
      finalizedAttempts: entry.finalizedAttempts,
      score: entry.score,
      dailyScore: entry.dailyScore ?? entry.score,
      dailyBonusTriggers: entry.dailyBonusTriggers,
      engineScore: entry.engineScore ?? entry.score,
      moves: entry.moves ?? 0,
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
