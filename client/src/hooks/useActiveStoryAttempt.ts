import { useMemo } from "react";

import { useRun } from "@/contexts/run";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";
import { loadRunSession } from "@/solana/reboot/runSessionStore";

export interface ActiveStoryRun {
  gameId: bigint;
  zoneId: number;
  level: number;
}

export const useActiveStoryAttempt = (): ActiveStoryRun | null => {
  const { publicKey } = useEmbeddedIdentity();
  const run = useRun();
  return useMemo(() => {
    const marker = loadRunSession(publicKey);
    const active = run.activeRun;
    if (
      !marker ||
      marker.mode !== "campaign" ||
      !active ||
      active.mode === "daily" ||
      active.runId !== marker.runId
    ) {
      return null;
    }
    return { gameId: marker.runId, zoneId: active.mapId, level: active.level };
  }, [publicKey, run.activeRun]);
};
