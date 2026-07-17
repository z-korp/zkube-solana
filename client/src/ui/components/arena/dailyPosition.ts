import {
  dailyLeaderboardRank,
  type DailyView,
} from "@/chain/dailyClient";

export interface PlayerPosition {
  rank: number;
  score: number;
  dailyBonusTriggers: number;
  engineScore: number;
  moves: number;
}

/** Best-run position for the connected player on a daily's leaderboard. */
export function getPlayerPosition(
  daily: DailyView | null,
  address: string,
): PlayerPosition | null {
  if (!daily?.player) return null;
  const leaderboardIndex = daily.leaderboard.findIndex(
    (entry) => entry.player.toBase58() === address,
  );
  const rank = leaderboardIndex >= 0
    ? dailyLeaderboardRank(daily.leaderboard, leaderboardIndex)
    : null;
  if (rank === null) return null;
  return {
    rank,
    score: daily.player.bestDailyScore ?? daily.player.bestScore,
    dailyBonusTriggers: daily.player.bestDailyBonusTriggers ?? 0,
    engineScore: daily.player.bestEngineScore ?? daily.player.bestScore,
    moves: daily.player.bestMoves ?? 0,
  };
}
