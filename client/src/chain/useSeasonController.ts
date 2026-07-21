import { useCallback, useEffect, useState } from "react";

import { errorMessage } from "@/utils/errors";
import { useSolanaConnection } from "./connectionContext";
import { useConnectedPlayer } from "./connectedPlayerContext";
import {
  currentSeasonId,
  fetchSeasonView,
  type SeasonView,
} from "./seasonClient";

export function useSeasonController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const [season, setSeason] = useState<SeasonView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const value = await fetchSeasonView({
        connection,
        wallet,
        seasonId: currentSeasonId(),
      });
      setSeason(value);
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

  return { season, loading, error, refresh };
}
