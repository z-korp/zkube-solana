import { useCallback, useEffect, useState } from "react";
import { useSolanaConnection } from "../connectionContext";
import {
  buildClaimDailyPrizePlan,
  buildRefundDailyEntryPlan,
  fetchDailyView,
  type DailyView,
} from "./dailyClient";
import { fetchPaymasterClient } from "./paymasterClient";
import { submitSponsoredTransactionPlan } from "./runPlan";
import { useRebootRun } from "./useRebootRun";
import { useEmbeddedIdentity } from "./embeddedIdentityContext";

export function useRebootDaily() {
  const { connection } = useSolanaConnection();
  const { wallet } = useEmbeddedIdentity();
  const run = useRebootRun();
  const [daily, setDaily] = useState<DailyView | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enter = useCallback(
    async (payment: "stars" | "usdc") => {
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
      if (payment === "stars") {
        if (daily.player?.freeAttemptUsed)
          throw new Error("Today's Stars attempt is already used");
        if (daily.playerStars < daily.starEntryCost)
          throw new Error("Not enough Stars");
      }
      setAction(`enter:${payment}`);
      try {
        const active = await run.startDailyRun(daily, payment);
        await refresh();
        setError(null);
        return active;
      } catch (cause) {
        setError(message(cause));
        throw cause;
      } finally {
        setAction(null);
      }
    },
    [daily, refresh, run],
  );

  const payout = useCallback(
    async (kind: "claim" | "refund") => {
      if (!wallet || !daily) throw new Error("Daily state is not ready");
      setAction(kind);
      try {
        const paymaster = await fetchPaymasterClient(connection);
        const transactionPlan =
          kind === "claim"
            ? await buildClaimDailyPrizePlan({
                connection,
                wallet,
                daily,
                paymaster: paymaster.pubkey,
              })
            : await buildRefundDailyEntryPlan({
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
    },
    [connection, daily, refresh, wallet],
  );

  return {
    daily,
    loading,
    action,
    error: error ?? run.error,
    run,
    refresh,
    enter,
    claim: () => payout("claim"),
    refund: () => payout("refund"),
  };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
