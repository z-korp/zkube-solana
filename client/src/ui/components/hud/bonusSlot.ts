/**
 * One bonus the run rolled: what it is, how many charges are left, and how
 * close the next one is. Lives here rather than in a component so the rail and
 * the play screen can share it without either owning the other.
 */
import type { BonusType } from "@/core/bonusTypes";

const BONUS_DISPLAY: Readonly<
  Record<number, { name: string; icon: string; description: string }>
> = {
  0: { name: "None", icon: "", description: "" },
  1: {
    name: "Hammer",
    icon: "/assets/common/bonus/hammer.png",
    description: "Destroy a single block",
  },
  2: {
    name: "Totem",
    icon: "/assets/common/bonus/tiki.png",
    description: "Destroy all blocks of one size",
  },
  3: {
    name: "Wave",
    icon: "/assets/common/bonus/wave.png",
    description: "Clear an entire row",
  },
};

export function bonusDisplay(id: number) {
  return BONUS_DISPLAY[id] ?? BONUS_DISPLAY[0];
}

export const REROLL_DISPLAY = {
  name: "Reroll",
  icon: "/assets/common/bonus/reroll.png",
} as const;

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
