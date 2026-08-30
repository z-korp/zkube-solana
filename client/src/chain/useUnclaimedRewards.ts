import { useCallback, useEffect, useState } from "react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useSolanaConnection } from "@/chain/connectionContext";
import {
  buildClaimDailyPrizePlan,
  currentDailyDayId,
  fetchUnclaimedRewards,
  type UnclaimedRewardView,
} from "@/chain/dailyClient";
import { SessionWallet } from "@/chain/sessionWallet";
import { submitVersionedTransactionPlan } from "@/chain/runPlan";
import { DEV_BYPASS_ACTIVE } from "@/dev/devBypass";
import { devUnclaimedRewards } from "@/dev/fixtures";
import { errorMessage } from "@/utils/errors";

export interface UnclaimedRewardsResult {
  rewards: UnclaimedRewardView[];
  /** Everything owed across every sealed, unexpired board. */
  totalLamports: bigint;
  loading: boolean;
  claiming: boolean;
  error: string | null;
  /** Collect one reward; resolves to the amount that landed. */
  claim: (reward: UnclaimedRewardView) => Promise<bigint>;
  refresh: () => Promise<void>;
}

/**
 * What this wallet is still owed, and the one-tap way to collect it.
 *
 * Spending a Kredit already settles up to two owed boards, so a returning
 * player never has to think about this. It exists for the player who won and
 * did not come back: without a direct path their reward simply expires into the
 * next pot after thirty days, which is the worst outcome the settlement design
 * can produce.
 *
 * `claim_daily_prize` takes the owner as a writable non-signer, so the device
 * session signs it — no wallet approval, no Kredit, just the network fee.
 */
export function useUnclaimedRewards(): UnclaimedRewardsResult {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const owner = player.publicKey;
  const [rewards, setRewards] = useState<UnclaimedRewardView[]>([]);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!owner) {
      setRewards([]);
      return;
    }
    if (import.meta.env.DEV && DEV_BYPASS_ACTIVE) {
      setRewards(devUnclaimedRewards());
      return;
    }
    setLoading(true);
    try {
      setRewards(
        await fetchUnclaimedRewards({
          connection,
          owner,
          currentDayId: currentDailyDayId(),
        }),
      );
      setError(null);
    } catch {
      // A failed scan never invents a reward, and never blocks the lobby.
      setRewards([]);
    } finally {
      setLoading(false);
    }
  }, [connection, owner]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const claim = useCallback(
    async (reward: UnclaimedRewardView) => {
      if (!owner) throw new Error("Connect a wallet before collecting");
      const device = player.requireSession();
      const wallet = new SessionWallet(device.signer);
      setClaiming(true);
      setError(null);
      try {
        const transactionPlan = await buildClaimDailyPrizePlan({
          connection,
          wallet,
          ownerAuthority: owner,
          sessionToken: device.sessionToken,
          dayId: reward.dayId,
          board: reward.board,
          position: reward.position,
        });
        const signature = await submitVersionedTransactionPlan({
          transactionPlan,
          wallet,
        });
        await connection.confirmTransaction(signature, "confirmed");
        await player.refreshBalance();
        await refresh();
        return reward.amountLamports;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      } finally {
        setClaiming(false);
      }
    },
    [connection, owner, player, refresh],
  );

  return {
    rewards,
    totalLamports: rewards.reduce(
      (total, reward) => total + reward.amountLamports,
      0n,
    ),
    loading,
    claiming,
    error,
    claim,
    refresh,
  };
}
