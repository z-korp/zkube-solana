// Stub — useLeaderboardSlot (migration Solana)
export interface LeaderboardEntry {
  token_id: bigint;
  game_id: bigint;
  level: number;
  score: number;
  stars: number;
  player_name: string;
  player_address: string;
}

export interface UseLeaderboardSlotResult {
  games: LeaderboardEntry[];
  loading: boolean;
  refetch: () => void;
}

export const useLeaderboardSlot = (_settingsId?: number): UseLeaderboardSlotResult => {
  return {
    games: [],
    loading: false,
    refetch: () => {},
  };
};
