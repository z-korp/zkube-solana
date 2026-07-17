import { useCallback, useEffect, useState } from "react";

import { errorMessage } from "@/utils/errors";
import { useSolanaConnection } from "@/chain/connectionContext";
import {
  buildRefundDailyEntryPlan,
  currentDailyDayId,
  fetchDailyView,
  type DailyView,
} from "@/chain/dailyClient";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { SessionWallet } from "@/chain/sessionWallet";
import { submitVersionedTransactionPlan } from "@/chain/runPlan";
import { dailyToCurrentChallenge } from "./useCurrentChallenge";

export function usePreviousChallenge() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
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
      setError(errorMessage(cause));
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
      if (!player.publicKey) throw new Error("Connect a wallet before requesting a refund");
      const session = player.requireSession();
      const sessionWallet = new SessionWallet(session.signer);
      setAction("refund");
      try {
        const transactionPlan = await buildRefundDailyEntryPlan({
          connection,
          wallet: sessionWallet,
          ownerAuthority: player.publicKey,
          sessionToken: session.sessionToken,
          daily,
        });
        const signature = await submitVersionedTransactionPlan({
          transactionPlan,
          wallet: sessionWallet,
        });
        await connection.confirmTransaction(signature, "confirmed");
        await refresh();
        return signature;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      } finally {
        setAction(null);
      }
    },
    [connection, daily, player, refresh],
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
