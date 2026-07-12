import { useCallback, useEffect, useState } from "react";
import { useSolanaConnection } from "../connectionContext";
import { fetchTreasuryView, type TreasuryView } from "./treasuryClient";

export function useRebootTreasury() {
  const { connection } = useSolanaConnection();
  const [treasury, setTreasury] = useState<TreasuryView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchTreasuryView(connection);
      setTreasury(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, [connection]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { treasury, loading, error, refresh };
}
