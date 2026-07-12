import { useMemo } from "react";

import { useProgress } from "@/contexts/progress";
import {
  ACHIEVEMENT_DEFS,
  type AchievementCategory,
  type AchievementDef,
} from "@/config/achievementDefs";
import { useEmbeddedIdentity } from "@/chain/embeddedIdentityContext";
import type { AchievementProgressView } from "@/chain/progressClient";
import { bigintToSafeNumber } from "@/utils/solanaDisplay";

export interface AchievementStatus extends AchievementDef {
  index: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  claimable: boolean;
}

export function projectAchievements(
  entries: readonly AchievementProgressView[] | null,
): AchievementStatus[] {
  return ACHIEVEMENT_DEFS.map((definition, index) => {
    const value = entries?.[index];
    return {
      ...definition,
      index,
      target: value ? bigintToSafeNumber(value.threshold) : definition.target,
      xp: value?.xpReward ?? definition.xp,
      progress: bigintToSafeNumber(value?.progress ?? 0n),
      completed: Boolean(value?.claimable || value?.claimed),
      claimed: value?.claimed ?? false,
      claimable: value?.claimable ?? false,
    };
  });
}

export const useAchievements = (playerAddress?: string) => {
  const controller = useProgress();
  const { publicKey } = useEmbeddedIdentity();
  const isCurrentPlayer =
    !playerAddress || playerAddress === publicKey.toBase58();
  const achievements = useMemo<AchievementStatus[]>(() => {
    if (!isCurrentPlayer) return [];
    return projectAchievements(controller.progress?.achievements ?? null);
  }, [controller.progress?.achievements, isCurrentPlayer]);
  return {
    achievements,
    isLoading: isCurrentPlayer && controller.loading,
    claiming: controller.claiming,
    error: controller.error,
    claimAchievement: controller.claimAchievement,
  };
};

export const ACHIEVEMENT_CATEGORIES: AchievementCategory[] = [
  "Grinder",
  "Sweeper",
  "Combo Master",
  "Guardian Slayer",
  "Explorer",
  "Challenger",
];
