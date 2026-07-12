import { useMemo } from "react";

import { useRun } from "@/contexts/run";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";
import { loadRunSession } from "@/solana/reboot/runSessionStore";

export interface ActiveStoryRun {
  gameId: bigint;
  zoneId: number;
  level: number;
  settled: boolean;
}

export const useActiveStoryAttempt = (): ActiveStoryRun | null => {
  const { publicKey } = useEmbeddedIdentity();
  const run = useRun();
  return useMemo(() => {
    const marker = loadRunSession(publicKey);
    const active = run.activeRun;
    if (!marker || marker.mode !== "campaign") return null;
    if (active && active.mode !== "daily" && active.runId === marker.runId) {
      return {
        gameId: marker.runId,
        zoneId: active.mapId,
        level: active.level,
        settled: false,
      };
    }
    if (
      run.phase === "settled" &&
      run.receipt?.mode === "campaign" &&
      run.receipt.runId === marker.runId
    ) {
      return {
        gameId: marker.runId,
        zoneId: run.receipt.mapId,
        level: run.receipt.level,
        settled: true,
      };
    }
    return null;
  }, [publicKey, run.activeRun, run.phase, run.receipt]);
};
