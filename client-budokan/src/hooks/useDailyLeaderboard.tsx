// Stub — useDailyLeaderboard (migration Solana)
export interface DailyLeaderboardEntry {
  player: string;
  score: number;
  level: number;
  playerName?: string;
}

export function useDailyLeaderboard(_challengeId: number | undefined) {
  return {
    entries: [] as DailyLeaderboardEntry[],
    isLoading: false,
  };
}

export default useDailyLeaderboard;
