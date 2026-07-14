import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useRun } from "@/contexts/run";

import { useSolanaConnection } from "./connectionContext";
import {
  buildFinalizeDailyChallengePlan,
  buildOpenDailyChallengePlan,
  buildRefundDailyEntryPlan,
  fetchOwnerCancelledDailyIds,
  fetchDailyView,
  type DailyView,
} from "./dailyClient";
import { fetchPaymasterClient } from "./paymasterClient";
import { submitSponsoredTransactionPlan } from "./runPlan";
import { useEmbeddedIdentity } from "./embeddedIdentityContext";
import { fetchEconomyRuntime } from "./economyClient";
import { deriveDailyLeaderboardPda } from "./pdas";

export function useDailyController() {
  const { connection } = useSolanaConnection();
  const { wallet } = useEmbeddedIdentity();
  const run = useRun();
  const [daily, setDaily] = useState<DailyView | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const maintaining = useRef(false);

  const refresh = useCallback(async () => {
    if (!wallet) {
      setDaily(null);
      return null;
    }
    setLoading(true);
    try {
      const next = await fetchDailyView({ connection, wallet });
      setDaily(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(message(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  const maintain = useCallback(async () => {
    if (!wallet || maintaining.current) return;
    maintaining.current = true;
    try {
      let next = await refresh();
      const runtime = await fetchEconomyRuntime({ connection, wallet });
      if (!runtime) return;
      const now = Math.floor(Date.now() / 1_000);
      const paymaster = await fetchPaymasterClient(connection);
      if (!next && now % 86_400 < 23 * 60 * 60) {
        const transactionPlan = await buildOpenDailyChallengePlan({
          connection,
          wallet,
          paymaster: paymaster.pubkey,
        });
        const signature = await submitSponsoredTransactionPlan({
          transactionPlan,
          wallet,
          paymaster,
        });
        await connection.confirmTransaction(signature, "confirmed");
        next = await refresh();
      }
      if (
        next?.status === "open" &&
        now >= next.runsCloseAt &&
        (next.attemptsStarted === next.runsFinalized ||
          now >= next.settlementGraceCloseAt)
      ) {
        const transactionPlan = await buildFinalizeDailyChallengePlan({
          connection,
          wallet,
          daily: next,
          paymaster: paymaster.pubkey,
        });
        const signature = await submitSponsoredTransactionPlan({
          transactionPlan,
          wallet,
          paymaster,
        });
        await connection.confirmTransaction(signature, "confirmed");
        next = await refresh();
      }
      if (
        next?.status === "cancelled" &&
        next.player &&
        !next.player.starRefunded
      ) {
        const transactionPlan = await buildRefundDailyEntryPlan({
          connection,
          wallet,
          daily: next,
          paymaster: paymaster.pubkey,
        });
        const signature = await submitSponsoredTransactionPlan({
          transactionPlan,
          wallet,
          paymaster,
        });
        await connection.confirmTransaction(signature, "confirmed");
        await refresh();
      }
      const cancelledDayIds = await fetchOwnerCancelledDailyIds({ connection, wallet });
      for (const dayId of cancelledDayIds.slice(0, 4)) {
        const cancelled = await fetchDailyView({ connection, wallet, dayId });
        if (!cancelled?.player || cancelled.player.starRefunded) continue;
        const transactionPlan = await buildRefundDailyEntryPlan({
          connection,
          wallet,
          daily: cancelled,
          paymaster: paymaster.pubkey,
        });
        const signature = await submitSponsoredTransactionPlan({
          transactionPlan,
          wallet,
          paymaster,
        });
        await connection.confirmTransaction(signature, "confirmed");
      }
    } catch (cause) {
      // Keeper races are expected; a fresh read resolves already-created or
      // already-finalized accounts without making gameplay approval-gated.
      setError(message(cause));
    } finally {
      maintaining.current = false;
    }
  }, [connection, refresh, wallet]);

  useEffect(() => {
    void maintain();
    const timer = window.setInterval(() => void maintain(), 60_000);
    return () => window.clearInterval(timer);
  }, [maintain]);

  const dailyAddress = daily?.address.toBase58() ?? null;
  useEffect(() => {
    if (!dailyAddress) return;
    const leaderboard = deriveDailyLeaderboardPda(new PublicKey(dailyAddress));
    const subscription = connection.onAccountChange(
      leaderboard,
      () => void refresh(),
      "confirmed",
    );
    return () => {
      void connection.removeAccountChangeListener(subscription);
    };
  }, [connection, dailyAddress, refresh]);

  const enter = useCallback(async () => {
    if (!daily) throw new Error("Today's Daily challenge is not available");
    if (!daily.playerEligible)
      throw new Error("Clear Campaign Map 1 to unlock Daily Arena");
    if (run.phase !== "none" && run.phase !== "missing") {
      throw new Error(
        "Settle and clean up the current run before starting another",
      );
    }
    const now = Math.floor(Date.now() / 1_000);
    if (
      daily.status !== "open" ||
      now < daily.opensAt ||
      now >= daily.entriesCloseAt
    ) {
      throw new Error("Daily entries are closed");
    }
    if (daily.playerStars < daily.starEntryCost)
      throw new Error("Not enough Stars");
    setAction("enter:stars");
    try {
      const active = await run.startDailyRun(daily);
      await refresh();
      setError(null);
      return active;
    } catch (cause) {
      setError(message(cause));
      throw cause;
    } finally {
      setAction(null);
    }
  }, [daily, refresh, run]);

  const refund = useCallback(async () => {
    if (!wallet || !daily) throw new Error("Daily state is not ready");
    setAction("refund");
    try {
      const paymaster = await fetchPaymasterClient(connection);
      const transactionPlan = await buildRefundDailyEntryPlan({
        connection,
        wallet,
        daily,
        paymaster: paymaster.pubkey,
      });
      const signature = await submitSponsoredTransactionPlan({
        transactionPlan,
        wallet,
        paymaster,
      });
      await connection.confirmTransaction(signature, "confirmed");
      await refresh();
      setError(null);
      return signature;
    } catch (cause) {
      setError(message(cause));
      throw cause;
    } finally {
      setAction(null);
    }
  }, [connection, daily, refresh, wallet]);

  return {
    daily,
    loading,
    action,
    error: error ?? run.error,
    run,
    refresh,
    enter,
    refund,
  };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
