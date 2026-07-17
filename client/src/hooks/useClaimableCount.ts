import { useMemo } from "react";

import { useProgress } from "@/contexts/progress";

export const useClaimableCounts = () => {
  const { progress } = useProgress();
  return useMemo(() => {
    const achievements =
      progress?.achievements.filter((entry) => entry.claimable).length ?? 0;
    const quests = progress?.quests.filter((entry) => entry.claimable) ?? [];
    const daily = quests.filter((entry) => entry.cadence === "daily").length;
    const weekly = quests.filter((entry) => entry.cadence === "weekly").length;
    return {
      total: achievements + quests.length,
      achievements,
      daily,
      weekly,
      unsettledDaily: 0,
      unsettledWeeklyZones: new Set<number>(),
    };
  }, [progress?.achievements, progress?.quests]);
};
