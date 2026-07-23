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
    const active = run.campaign.activeRun;
    // The durable ActiveRun is authoritative. Browser storage is only a cache
    // and may be unavailable after refresh or inside a wallet browser.
    if (active?.mode === "campaign") {
      return {
        gameId: active.runId,
        zoneId: active.mapId,
        level: active.level,
        settled: false,
      };
    }
    return null;
  }, [run.campaign.activeRun]);
};
