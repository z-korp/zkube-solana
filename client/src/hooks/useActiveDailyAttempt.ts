import { useMemo } from "react";

import { useRun } from "@/backend/client";

export interface ActiveDailyRun {
  gameId: bigint;
  level: number;
  mode: "daily";
  isReplay: boolean;
  settled: boolean;
}

export const useActiveDailyAttempt = (): ActiveDailyRun | null => {
  const run = useRun();
  return useMemo(() => {
    const active = run.arcade.activeRun;
    if (active?.mode === "daily") {
      return {
        gameId: active.runId,
        level: active.level,
        mode: active.mode,
        isReplay: false,
        settled: false,
      };
    }
    return null;
  }, [run.arcade.activeRun]);
};
