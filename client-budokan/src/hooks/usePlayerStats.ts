// Stub — PlayerStats Starknet (migration Solana)
export interface PlayerStats {
  totalLines: number;
  totalBossDefeats: number;
  totalCombo4: number;
}
export const usePlayerStats = (_playerAddress?: string) => {
  return { stats: undefined as PlayerStats | undefined };
};
