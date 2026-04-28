// Stub — usePlayerBestRun (migration Solana)
export interface PlayerBestRunData {
  gameId: bigint;
  score: number;
  level: number;
  moves: number;
}

export const usePlayerBestRun = (_playerAddress: string | undefined) => {
  return {
    bestRuns: [] as PlayerBestRunData[],
    isLoading: false,
  };
};
