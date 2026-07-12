// Compat shim over the Solana program's campaign shape: 10 maps × 10 levels,
// the 10th level of every map is the guardian trial.
export const DEFAULT_GRID_WIDTH = 8;
export const DEFAULT_GRID_HEIGHT = 10;

export const LEVEL_CAP = 10;
export const BOSS_INTERVAL = 10;
export const BOSS_LEVELS = [10] as const;
export const PRE_BOSS_LEVELS = [9] as const;
