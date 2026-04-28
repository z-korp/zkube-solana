// Stub — PlayerMeta Starknet (migration Solana)
export interface PlayerMeta {
  player: string;
  bestLevel: number;
  totalRuns: number;
  dailyStars: number;
  lifetimeXp: number;
  lastActive: number;
}
export const usePlayerMeta = (_overrideAddress?: string) => {
  return { playerMeta: undefined as PlayerMeta | undefined };
};
