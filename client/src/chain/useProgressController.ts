import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "@/utils/errors";
import { useSolanaConnection } from "./connectionContext";
import { fetchProgressView, type ProgressView } from "./progressClient";
import { useConnectedPlayer } from "./connectedPlayerContext";

export function useProgressController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const [progress, setProgress] = useState<ProgressView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchProgressView({ connection, wallet });
      setProgress(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(errorMessage(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    progress,
    loading,
    error,
    refresh,
  };
}
