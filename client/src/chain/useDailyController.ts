import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useRun } from "@/contexts/run";

import { useSolanaConnection } from "./connectionContext";
import {
  buildRefundDailyEntryPlan,
  fetchOwnerCancelledDailyIds,
  fetchDailyView,
  type DailyView,
} from "./dailyClient";
import { submitVersionedTransactionPlan } from "./runPlan";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { SessionWallet } from "./sessionWallet";
import { deriveDailyLeaderboardPda } from "./pdas";

export function useDailyController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const run = useRun();
  const [daily, setDaily] = useState<DailyView | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const maintaining = useRef(false);

  const refresh = useCallback(async () => {
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
    if (player.sessionStatus !== "ready" || maintaining.current) return;
    maintaining.current = true;
    try {
      const session = player.requireSession();
      const sessionWallet = new SessionWallet(session.signer);
      const next = await refresh();
      if (
        next?.status === "cancelled" &&
        next.player &&
        !next.player.starRefunded
      ) {
        const transactionPlan = await buildRefundDailyEntryPlan({
          connection,
          wallet: sessionWallet,
          ownerAuthority: session.owner,
          sessionToken: session.sessionToken,
          daily: next,
        });
        const signature = await submitVersionedTransactionPlan({
          transactionPlan,
          wallet: sessionWallet,
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
          wallet: sessionWallet,
          ownerAuthority: session.owner,
          sessionToken: session.sessionToken,
          daily: cancelled,
        });
        const signature = await submitVersionedTransactionPlan({
          transactionPlan,
          wallet: sessionWallet,
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
  }, [connection, player, refresh, wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void maintain();
    const timer = globalThis.setInterval(() => void maintain(), 60_000);
    return () => globalThis.clearInterval(timer);
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
    if (!daily) throw new Error("Daily state is not ready");
    const owner = player.publicKey;
    if (!owner) throw new Error("Connect a wallet before requesting a refund");
    const session = player.requireSession();
    const sessionWallet = new SessionWallet(session.signer);
    setAction("refund");
    try {
      const transactionPlan = await buildRefundDailyEntryPlan({
        connection,
        wallet: sessionWallet,
        ownerAuthority: owner,
        sessionToken: session.sessionToken,
        daily,
      });
      const signature = await submitVersionedTransactionPlan({
        transactionPlan,
        wallet: sessionWallet,
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
  }, [connection, daily, player, refresh]);

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
