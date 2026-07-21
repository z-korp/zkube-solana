import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";

import { useRun } from "@/contexts/run";
import { errorMessage } from "@/utils/errors";
import { useSolanaConnection } from "./connectionContext";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { fetchDailyView, type DailyView } from "./dailyClient";
import { deriveArenaBoardPda } from "./pdas";

export function useDailyController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const run = useRun();
  const [daily, setDaily] = useState<DailyView | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const value = await fetchDailyView({ connection, wallet });
      setDaily(value);
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
  }, [refresh]);

  const dailyAddress = daily?.address.toBase58() ?? null;
  useEffect(() => {
    if (!dailyAddress) return;
    const subscription = connection.onAccountChange(
      deriveArenaBoardPda(new PublicKey(dailyAddress)),
      () => void refresh(),
      "confirmed",
    );
    return () => { void connection.removeAccountChangeListener(subscription); };
  }, [connection, dailyAddress, refresh]);

  const enter = useCallback(async () => {
    if (!daily) throw new Error("Today's Arena is not available");
    if (!daily.playerEligible) throw new Error("Clear Campaign Map 1 to unlock Arena");
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

  const refund = useCallback(async () => {
    throw new Error("Only provably stuck paid runs are refunded by protocol recovery");
  }, []);

  return { daily, loading, action, error, refresh, maintain: refresh, enter, refund };
}
