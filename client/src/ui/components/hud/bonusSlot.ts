/**
 * One bonus the run rolled: what it is, how many charges are left, and how
 * close the next one is. Lives here rather than in a component so the rail and
 * the play screen can share it without either owning the other.
 */
import type { BonusType } from "@/chain/bonusTypes";

export interface BonusSlot {
  type: BonusType | "reroll";
  charges: number;
  isActive: boolean; // This is the slot the game rolled
  icon: string;
  name: string;
  description: string;
  triggerDescription: string; // e.g. "Chain 4 combos"
  triggerProgress?: {
    current: number;
    threshold: number;
    suffix?: string;
  };
  totemTarget?: {
    width: number;
    cells: number;
  };
  onClick: () => void;
}
