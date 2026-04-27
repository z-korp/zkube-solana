// Stub — useGameLevel (migration Solana)
export interface GameLevelData {
  level: number;
  gridWidth: number;
  gridHeight: number;
  startRows: number;
  maxMoves: number;
  mutatorId: number;
  star3Threshold: number;
  star2Threshold: number;
}

export const useGameLevel = (_params: { gameId: bigint | undefined; shouldLog?: boolean }) => {
  return undefined as GameLevelData | undefined;
};
