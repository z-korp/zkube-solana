import { useCallback, useEffect, useState } from "react";

import { useSolanaConnection } from "@/chain/connectionContext";
import {
  buildRefundDailyEntryPlan,
  currentDailyDayId,
  fetchDailyView,
  type DailyView,
} from "@/chain/dailyClient";
import { useEmbeddedIdentity } from "@/chain/embeddedIdentityContext";
import { fetchPaymasterClient } from "@/chain/paymasterClient";
import { submitSponsoredTransactionPlan } from "@/chain/runPlan";
import { dailyToCurrentChallenge } from "./useCurrentChallenge";

export function usePreviousChallenge() {
  const { connection } = useSolanaConnection();
  const { wallet } = useEmbeddedIdentity();
  const [daily, setDaily] = useState<DailyView | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"refund" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchDailyView({
        connection,
        wallet,
        dayId: Math.max(0, currentDailyDayId() - 1),
      });
      setDaily(result);
      setError(null);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refund = useCallback(
    async () => {
      if (!daily) throw new Error("Previous Daily state is not ready");
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
        return signature;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally {
        setAction(null);
      }
    },
    [connection, daily, refresh, wallet],
  );

  return {
    challenge: daily ? dailyToCurrentChallenge(daily) : null,
    daily,
    loading,
    action,
    error,
    refresh,
    refund,
  };
}

export default usePreviousChallenge;
