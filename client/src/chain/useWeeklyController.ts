import { useCallback, useEffect, useState } from "react";

import { errorMessage } from "@/utils/errors";
import { useSolanaConnection } from "./connectionContext";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { currentWeeklyId, fetchWeeklyView, type WeeklyView } from "./weeklyClient";

export function useWeeklyController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const [weekly, setWeekly] = useState<WeeklyView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const value = await fetchWeeklyView({ connection, wallet, weeklyId: currentWeeklyId() });
      setWeekly(value);
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
    const timer = globalThis.setInterval(() => void refresh(), 60_000);
    return () => globalThis.clearInterval(timer);
  }, [refresh]);

  return {
    weekly,
    loading,
    error,
    refresh,
  };
}
