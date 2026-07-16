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
    if (active && active.mode === "daily") {
      return {
        gameId: active.runId,
        level: active.level,
        isReplay: false,
        settled: false,
      };
    }
    if (
      run.phase === "settled" &&
      run.receipt?.mode === "daily" &&
      run.receipt.runId > 0n
    ) {
      return {
        gameId: run.receipt.runId,
        level: run.receipt.level,
        isReplay: false,
        settled: true,
      };
    }
    return null;
  }, [run.activeRun, run.phase, run.receipt]);
};
