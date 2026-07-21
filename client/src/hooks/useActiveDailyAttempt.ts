import { useMemo } from "react";

import { useRun } from "@/contexts/run";

export interface ActiveDailyRun {
  gameId: bigint;
  level: number;
  isReplay: boolean;
  settled: boolean;
}

export const useActiveDailyAttempt = (): ActiveDailyRun | null => {
  const run = useRun();
  return useMemo(() => {
    const active = run.activeRun;
    if (active && (active.mode === "daily" || active.mode === "practice")) {
      return {
        gameId: active.runId,
        level: active.level,
        isReplay: false,
        settled: false,
      };
    }
    return null;
  }, [run.activeRun]);
};
