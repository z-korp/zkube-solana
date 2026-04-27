// Stub — useGameTokensSlot (migration Solana)
export interface SlotGameTokenData {
  token_id: bigint;
  game_id: bigint;
  level: number;
  score: number;
  stars: number;
  player_name: string;
  player_address: string;
}

export const useGameTokensSlot = (_params: {
  owner?: string;
  limit?: number;
  shouldFetch?: boolean;
  refreshTrigger?: number;
}) => {
  return {
    games: [] as SlotGameTokenData[],
    loading: false,
    metadataLoading: false,
    refetch: () => {},
  };
};
