// Every Campaign map has 10 levels; the protocol activates a dynamic
// contiguous map range (currently ten, with capacity for 32 maps).
// The 10th level of every map is the guardian trial.

const BOSS_INTERVAL = 10;

export function isBossLevel(level: number): boolean {
  return level > 0 && level % BOSS_INTERVAL === 0;
}
