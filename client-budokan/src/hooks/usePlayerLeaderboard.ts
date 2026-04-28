// Stub — usePlayerLeaderboard (migration Solana)
export interface PlayerLeaderboardEntry {
  player: string;
  score: number;
  level: number;
  playerName?: string;
}

export function usePlayerLeaderboard() {
  return {
    entries: [] as PlayerLeaderboardEntry[],
    isLoading: false,
  };
}

export default usePlayerLeaderboard;
