// Compat shim: the original client unpacked a 119-bit run_data field; on
// Solana the ActiveRun account exposes everything directly. Only the level
// helpers survive.
import { BOSS_INTERVAL } from "@/dojo/game/constants";

export function isBossLevel(level: number): boolean {
  return level > 0 && level % BOSS_INTERVAL === 0;
}
