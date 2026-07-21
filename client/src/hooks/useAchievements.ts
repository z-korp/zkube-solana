import { useMemo } from "react";

import { useProgress } from "@/contexts/progress";
import {
  ACHIEVEMENT_DEFS,
  type AchievementCategory,
  type AchievementDef,
} from "@/config/achievementDefs";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import type { AchievementProgressView } from "@/chain/progressClient";
import { bigintToSafeNumber } from "@/utils/solanaDisplay";

export interface AchievementStatus extends AchievementDef {
  index: number;
  progress: number;
  completed: boolean;
}

export function projectAchievements(
  entries: readonly AchievementProgressView[] | null,
): AchievementStatus[] {
  return ACHIEVEMENT_DEFS.flatMap((definition, index) => {
    const value = entries?.[index];
    const staticallyArcade = index <= 11 || index >= 20;
    if (!(value?.active ?? staticallyArcade)) return [];
    return [{
      ...definition,
      index,
      target: value ? bigintToSafeNumber(value.threshold) : definition.target,
      xp: value?.xpReward ?? definition.xp,
      progress: bigintToSafeNumber(value?.progress ?? 0n),
      completed: value?.completed ?? false,
    }];
  });
}

export const useAchievements = (playerAddress?: string) => {
  const controller = useProgress();
  const { publicKey } = useConnectedPlayer();
  const isCurrentPlayer =
    Boolean(publicKey && (!playerAddress || playerAddress === publicKey.toBase58()));
  const achievements = useMemo<AchievementStatus[]>(() => {
    if (!isCurrentPlayer) return [];
    return projectAchievements(controller.progress?.achievements ?? null);
  }, [controller.progress?.achievements, isCurrentPlayer]);
  return {
    achievements,
    isLoading: isCurrentPlayer && controller.loading,
    error: controller.error,
  };
};

export const ACHIEVEMENT_CATEGORIES: AchievementCategory[] = [
  "Grinder",
  "Sweeper",
  "Combo Master",
  "Challenger",
];
