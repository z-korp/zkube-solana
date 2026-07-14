import { useMemo } from "react";

import { useRun } from "@/contexts/run";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { loadRunSession } from "@/chain/runSessionStore";

export interface ActiveDailyRun {
  gameId: bigint;
  level: number;
  isReplay: boolean;
  settled: boolean;
}

export const useActiveDailyAttempt = (): ActiveDailyRun | null => {
  const { publicKey } = useConnectedPlayer();
  const run = useRun();
  return useMemo(() => {
    const marker = publicKey ? loadRunSession(publicKey) : null;
    const active = run.activeRun;
    if (!marker || marker.mode !== "daily") return null;
    if (active && active.mode === "daily" && active.runId === marker.runId) {
      return {
        gameId: marker.runId,
        level: active.level,
        isReplay: false,
        settled: false,
      };
    }
    if (
      run.phase === "settled" &&
      run.receipt?.mode === "daily" &&
      run.receipt.runId === marker.runId
    ) {
      return {
        gameId: marker.runId,
        level: run.receipt.level,
        isReplay: false,
        settled: true,
      };
    }
    return null;
  }, [publicKey, run.activeRun, run.phase, run.receipt]);
};
