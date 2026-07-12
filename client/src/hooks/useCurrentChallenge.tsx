import { useEffect, useMemo, useState } from "react";

import { useDailyController } from "@/contexts/daily";
import { currentDailyDayId, type DailyView } from "@/solana/reboot/dailyClient";

export interface CurrentChallengeView {
  challenge_id: number;
  start_time: number;
  end_time: number;
  settled: boolean;
  cancelled: boolean;
  zone_id: number;
  total_attempts: bigint;
  active_mutator_id: number;
  passive_mutator_id: number;
}

export function dailyToCurrentChallenge(
  daily: DailyView,
): CurrentChallengeView {
  return {
    challenge_id: daily.dayId,
    start_time: daily.opensAt,
    end_time: daily.runsCloseAt,
    settled: daily.status === "claimable" || daily.status === "closed",
    cancelled: daily.status === "cancelled",
    zone_id: daily.mapId,
    total_attempts: daily.runsStarted,
    active_mutator_id: daily.rules.activeMutatorId,
    passive_mutator_id: daily.rules.passiveMutatorId,
  };
}

export function useCurrentChallenge() {
  const { daily, loading, refresh } = useDailyController();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1_000)),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const dayId = currentDailyDayId(now);
  useEffect(() => {
    if (!loading && daily?.dayId !== dayId) {
      void refresh();
    }
  }, [daily?.dayId, dayId, loading, refresh]);

  const challenge = useMemo(
    () => (daily ? dailyToCurrentChallenge(daily) : null),
    [daily],
  );
  return {
    challenge,
    isLoading: loading,
    challengeCount: challenge ? 1 : 0,
  };
}

export default useCurrentChallenge;
