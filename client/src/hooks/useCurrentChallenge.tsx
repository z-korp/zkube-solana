import { useEffect, useMemo, useRef } from "react";

import { useDaily } from "@/contexts/daily";
import { currentDailyDayId, type DailyView } from "@/chain/dailyClient";
import { useNowTick } from "@/hooks/useNowTick";

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
    total_attempts: daily.attemptsStarted,
    active_mutator_id: daily.rules.activeMutatorId,
    passive_mutator_id: daily.rules.passiveMutatorId,
  };
}

export function useCurrentChallenge() {
  const { daily, loading, refresh } = useDaily();
  const refreshRequestedForDay = useRef<number | null>(null);
  // The day boundary only needs minute granularity; useNowTick returns ms.
  const now = Math.floor(useNowTick(60_000) / 1_000);
  const dayId = currentDailyDayId(now);
  useEffect(() => {
    if (loading || daily?.dayId === dayId) return;
    // A missing Daily is a completed null read, not an invitation to loop.
    // The controller performs its own bounded cadence refresh; this hook asks
    // only once for each UTC day so the UI can leave "Loading" and show the
    // explicit unpublished state while waiting for the keeper.
    if (refreshRequestedForDay.current === dayId) return;
    refreshRequestedForDay.current = dayId;
    void refresh();
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
