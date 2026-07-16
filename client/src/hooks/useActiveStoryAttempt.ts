import { useMemo } from "react";

import { useRun } from "@/contexts/run";

export interface ActiveStoryRun {
  gameId: bigint;
  zoneId: number;
  level: number;
  settled: boolean;
}

export const useActiveStoryAttempt = (): ActiveStoryRun | null => {
  const run = useRun();
  return useMemo(() => {
    const active = run.activeRun;
    // The durable ActiveRun is authoritative. Browser storage is only a cache
    // and may be unavailable after refresh or inside a wallet browser.
    if (active && active.mode !== "daily") {
      return {
        gameId: active.runId,
        zoneId: active.mapId,
        level: active.level,
        settled: false,
      };
    }
    if (
      run.phase === "settled" &&
      run.receipt?.mode === "campaign" &&
      run.receipt.runId > 0n
    ) {
      return {
        gameId: run.receipt.runId,
        zoneId: run.receipt.mapId,
        level: run.receipt.level,
        settled: true,
      };
    }
    return null;
  }, [run.activeRun, run.phase, run.receipt]);
};
