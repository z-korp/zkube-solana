import { useCallback, useEffect, useState } from "react";

import { useRun } from "@/contexts/run";
import { errorMessage } from "@/utils/errors";
import { useSolanaConnection } from "./connectionContext";
import { useConnectedPlayer } from "./connectedPlayerContext";
import {
  currentDailyDayId,
  fetchDailyView,
  isPracticeEntryWindowOpen,
  type DailyView,
} from "./dailyClient";

export function useDailyController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const run = useRun();
  const [daily, setDaily] = useState<DailyView | null>(null);
  const [practiceDaily, setPracticeDaily] = useState<DailyView | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowUnix, setNowUnix] = useState(() => Math.floor(Date.now() / 1_000));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const dayId = currentDailyDayId();
      const [value, yesterday] = await Promise.all([
        fetchDailyView({ connection, wallet, dayId }),
        dayId > 0
          ? fetchDailyView({ connection, wallet, dayId: dayId - 1 })
          : Promise.resolve(null),
      ]);
      setDaily(value);
      setPracticeDaily(yesterday?.status === "finalized" ? yesterday : null);
      setError(null);
      return value;
    } catch (cause) {
      setError(errorMessage(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  useEffect(() => {
    void refresh();
    const refreshTimer = globalThis.setInterval(() => void refresh(), 60_000);
    return () => globalThis.clearInterval(refreshTimer);
  }, [refresh]);

  useEffect(() => {
    const clock = globalThis.setInterval(
      () => setNowUnix(Math.floor(Date.now() / 1_000)),
      1_000,
    );
    return () => globalThis.clearInterval(clock);
  }, []);

  const dailyAddress = daily?.address.toBase58() ?? null;
  useEffect(() => {
    if (!dailyAddress) return;
    const subscription = connection.onAccountChange(
      daily!.address,
      () => void refresh(),
      "confirmed",
    );
    return () => { void connection.removeAccountChangeListener(subscription); };
  }, [connection, daily, dailyAddress, refresh]);

  const enter = useCallback(async () => {
    if (!daily) throw new Error("Today's Arena is not available");
    if (run.phase !== "none" && run.phase !== "missing") throw new Error("Finish the active run first");
    setAction("enter:sol");
    try {
      const active = await run.startDailyRun(daily);
      await refresh();
      return active;
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    } finally {
      setAction(null);
    }
  }, [daily, refresh, run]);

  const practice = useCallback(async () => {
    if (!practiceDaily) {
      throw new Error("Yesterday's finalized Arena is not available for Practice");
    }
    if (!isPracticeEntryWindowOpen()) {
      throw new Error("Practice entry is closed after 23:30 UTC");
    }
    if (run.phase !== "none" && run.phase !== "missing") {
      throw new Error("Finish the active run first");
    }
    setAction("practice");
    try {
      const active = await run.startPracticeRun(practiceDaily);
      await refresh();
      return active;
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    } finally {
      setAction(null);
    }
  }, [practiceDaily, refresh, run]);

  const practiceAvailable =
    practiceDaily !== null &&
    practiceDaily.dayId + 1 === currentDailyDayId(nowUnix) &&
    isPracticeEntryWindowOpen(nowUnix);

  return {
    daily,
    practiceDaily,
    practiceAvailable,
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
