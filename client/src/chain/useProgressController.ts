import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "@/utils/errors";
import { useSolanaConnection } from "./connectionContext";
import {
  buildClaimAchievementPlan,
  buildClaimLevelMilestonePlan,
  buildClaimQuestPlan,
  fetchProgressView,
  type ProgressView,
} from "./progressClient";
import { submitVersionedTransactionPlan } from "./runPlan";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { SessionWallet } from "./sessionWallet";

export function useProgressController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const [progress, setProgress] = useState<ProgressView | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
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

  const claimAchievement = useCallback(
    async (index: number) => {
      if (!progress) throw new Error("Progress is not ready");
      const owner = player.publicKey;
      if (!owner) throw new Error("Connect a wallet before claiming rewards");
      const session = player.requireSession();
      const sessionWallet = new SessionWallet(session.signer);
      setClaiming(`achievement:${index}`);
      try {
        const transactionPlan = await buildClaimAchievementPlan({
          connection,
          wallet: sessionWallet,
          ownerAuthority: owner,
          sessionToken: session.sessionToken,
          achievementIndex: index,
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
        setClaiming(null);
      }
    },
    [connection, player, progress, refresh],
  );

  const claimQuest = useCallback(
    async (index: number) => {
      if (!progress) throw new Error("Progress is not ready");
      const owner = player.publicKey;
      if (!owner) throw new Error("Connect a wallet before claiming rewards");
      const session = player.requireSession();
      const sessionWallet = new SessionWallet(session.signer);
      setClaiming(`quest:${index}`);
      try {
        const transactionPlan = await buildClaimQuestPlan({
          connection,
          wallet: sessionWallet,
          ownerAuthority: owner,
          sessionToken: session.sessionToken,
          questIndex: index,
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
        setClaiming(null);
      }
    },
    [connection, player, progress, refresh],
  );

  const claimLevelMilestone = useCallback(
    async (index: number) => {
      if (!progress) {
        throw new Error("Level milestones are not active");
      }
      const owner = player.publicKey;
      if (!owner) throw new Error("Connect a wallet before claiming rewards");
      const session = player.requireSession();
      const sessionWallet = new SessionWallet(session.signer);
      setClaiming(`milestone:${index}`);
      try {
        const transactionPlan = await buildClaimLevelMilestonePlan({
          connection,
          wallet: sessionWallet,
          ownerAuthority: owner,
          sessionToken: session.sessionToken,
          milestoneIndex: index,
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
        setClaiming(null);
      }
    },
    [connection, player, progress, refresh],
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
