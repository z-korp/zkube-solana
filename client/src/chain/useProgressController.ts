import { useCallback, useEffect, useState } from "react";
import { useSolanaConnection } from "./connectionContext";
import { fetchPaymasterClient } from "./paymasterClient";
import {
  buildClaimAchievementPlan,
  buildClaimLevelMilestonePlan,
  buildClaimQuestPlan,
  fetchProgressView,
  type ProgressView,
} from "./progressClient";
import { submitSponsoredTransactionPlan } from "./runPlan";
import { useEmbeddedIdentity } from "./embeddedIdentityContext";

export function useProgressController() {
  const { connection } = useSolanaConnection();
  const { wallet } = useEmbeddedIdentity();
  const [progress, setProgress] = useState<ProgressView | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet) {
      setProgress(null);
      return null;
    }
    setLoading(true);
    try {
      const next = await fetchProgressView({ connection, wallet });
      setProgress(next);
      setError(null);
      return next;
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

  const claimAchievement = useCallback(
    async (index: number) => {
      if (!wallet || !progress) throw new Error("Progress is not ready");
      setClaiming(`achievement:${index}`);
      try {
        const paymaster = await fetchPaymasterClient(connection);
        const transactionPlan = await buildClaimAchievementPlan({
          connection,
          wallet,
          achievementIndex: index,
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
        setClaiming(null);
      }
    },
    [connection, progress, refresh, wallet],
  );

  const claimQuest = useCallback(
    async (index: number) => {
      if (!wallet || !progress) throw new Error("Progress is not ready");
      setClaiming(`quest:${index}`);
      try {
        const paymaster = await fetchPaymasterClient(connection);
        const transactionPlan = await buildClaimQuestPlan({
          connection,
          wallet,
          questIndex: index,
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
        setClaiming(null);
      }
    },
    [connection, progress, refresh, wallet],
  );

  const claimLevelMilestone = useCallback(
    async (index: number) => {
      if (!wallet || !progress) {
        throw new Error("Level milestones are not active");
      }
      setClaiming(`milestone:${index}`);
      try {
        const paymaster = await fetchPaymasterClient(connection);
        const transactionPlan = await buildClaimLevelMilestonePlan({
          connection,
          wallet,
          milestoneIndex: index,
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
        setClaiming(null);
      }
    },
    [connection, progress, refresh, wallet],
  );

  return {
    progress,
    loading,
    claiming,
    error,
    refresh,
    claimAchievement,
    claimQuest,
    claimLevelMilestone,
  };
}
