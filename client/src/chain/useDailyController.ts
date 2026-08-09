import { useCallback, useEffect, useState } from "react";

import { useRun } from "@/contexts/run";
import { errorMessage } from "@/utils/errors";
import { describeRunStartError } from "./runStartError";
import { useSolanaConnection } from "./connectionContext";
import { useConnectedPlayer } from "./connectedPlayerContext";
import {
  buildPurchaseKreditsPlan,
  currentDailyDayId,
  fetchDailyView,
  type DailyView,
} from "./dailyClient";
import { submitVersionedTransactionPlan } from "./runPlan";

export function useDailyController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const run = useRun().arcade;
  const [daily, setDaily] = useState<DailyView | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const dayId = currentDailyDayId();
      const value = await fetchDailyView({ connection, wallet, dayId });
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
    if (daily.kreditBalance < 1n) {
      throw new Error("Buy a Kredit with the owner wallet before entering Arena");
    }
    setAction("enter:kredit");
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

  const buyKredits = useCallback(async (kreditCount = 1) => {
    if (!player.wallet) throw new Error("Connect the owner wallet to buy Kredits");
    setAction("buy:kredits");
    try {
      const plan = await buildPurchaseKreditsPlan({
        connection,
        ownerWallet: player.wallet,
        kreditCount,
      });
      const signature = await submitVersionedTransactionPlan({
        transactionPlan: plan,
        wallet: player.wallet,
      });
      await refresh();
      await player.refreshBalance();
      return signature;
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    } finally {
      setAction(null);
    }
  }, [connection, player, refresh]);

  return {
    daily,
    loading,
    action,
    error,
    refresh,
    maintain: refresh,
    enter,
    buyKredits,
    run,
  };
}
