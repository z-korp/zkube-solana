import { useCallback, useEffect, useState } from "react";

import { useRun } from "@/contexts/run";
import { errorMessage } from "@/utils/errors";
import { describeRunStartError } from "./runStartError";
import { useSolanaConnection } from "./connectionContext";
import { useConnectedPlayer } from "./connectedPlayerContext";
import {
  currentDailyDayId,
  fetchDailyView,
  type DailyView,
} from "./dailyClient";

export function useDailyController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const run = useRun().arcade;
  const [daily, setDaily] = useState<DailyView | null>(null);
  const [practiceDaily, setPracticeDaily] = useState<DailyView | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const dayId = currentDailyDayId();
      const [value, previous] = await Promise.all([
        fetchDailyView({ connection, wallet, dayId }),
        run.activeRun?.mode === "practice" && dayId > 0
          ? fetchDailyView({ connection, wallet, dayId: dayId - 1 })
          : Promise.resolve(null),
      ]);
      setDaily(value);
      // Read-only compatibility for displaying a legacy Practice result.
      // No new Practice run can be launched.
      setPracticeDaily(
        run.activeRun?.mode === "practice" ? previous : null,
      );
      setError(null);
      return value;
    } catch (cause) {
      setError(errorMessage(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, [connection, run.activeRun?.mode, wallet]);

  useEffect(() => {
    void refresh();
    const refreshTimer = globalThis.setInterval(() => void refresh(), 60_000);
    return () => globalThis.clearInterval(refreshTimer);
  }, [refresh]);

  const dailyAddress = daily?.address.toBase58() ?? null;
  useEffect(() => {
    if (!dailyAddress) return;
    const subscription = connection.onAccountChange(
      daily!.address,
      () => void refresh(),
      "confirmed",
    );
    return () => {
      void connection.removeAccountChangeListener(subscription);
    };
  }, [connection, daily, dailyAddress, refresh]);

  const enter = useCallback(async () => {
    if (!daily) throw new Error("Today's Arena is not available");
    if (daily.followingDailyLamports === null) {
      throw new Error(
        "Ranked entry is paused while the following Daily is prepared. No entry was charged.",
      );
    }
    if (run.phase !== "none" && run.phase !== "missing")
      throw new Error("Finish the active run first");
    setAction("enter:sol");
    try {
      const active = await run.startDailyRun(daily);
      await refresh();
      return active;
    } catch (cause) {
      setError(describeRunStartError(errorMessage(cause)).headline);
      throw cause;
    } finally {
      setAction(null);
    }
  }, [daily, refresh, run]);

  const practice = useCallback(async () => {
    throw new Error("Practice has been retired");
  }, []);

  return {
    daily,
    practiceDaily,
    practiceAvailable: false,
    loading,
    action,
    error,
    refresh,
    maintain: refresh,
    enter,
    practice,
    run,
  };
}
