import { useMemo } from "react";

import { useDailyController } from "@/contexts/daily";
import { useRun } from "@/contexts/run";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";
import { loadRunSession } from "@/solana/reboot/runSessionStore";

export interface ActiveDailyRun {
  gameId: bigint;
  challengeId: number;
  level: number;
  isReplay: boolean;
}

export const useActiveDailyAttempt = (): ActiveDailyRun | null => {
  const { publicKey } = useEmbeddedIdentity();
  const { daily } = useDailyController();
  const run = useRun();
  return useMemo(() => {
    const marker = loadRunSession(publicKey);
    const active = run.activeRun;
    if (
      !marker ||
      marker.mode !== "daily" ||
      !daily ||
      !active ||
      active.mode !== "daily" ||
      active.runId !== marker.runId ||
      !active.dailyChallenge.equals(daily.address)
    ) {
      return null;
    }
    return {
      gameId: marker.runId,
      challengeId: daily.dayId,
      level: active.level,
      isReplay: false,
    };
  }, [daily, publicKey, run.activeRun]);
};
