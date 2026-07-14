// Every Campaign map has 10 levels; the protocol activates a dynamic
// contiguous map range (currently ten, with capacity for 32 maps).
// The 10th level of every map is the guardian trial.
export const DEFAULT_GRID_WIDTH = 8;
export const DEFAULT_GRID_HEIGHT = 10;

export const LEVEL_CAP = 10;
export const BOSS_INTERVAL = 10;
export const BOSS_LEVELS = [10] as const;
export const PRE_BOSS_LEVELS = [9] as const;

export function isBossLevel(level: number): boolean {
  return level > 0 && level % BOSS_INTERVAL === 0;
}
