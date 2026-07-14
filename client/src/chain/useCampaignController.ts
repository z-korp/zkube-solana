import { useCallback, useEffect, useState } from "react";
import { useSolanaConnection } from "./connectionContext";
import {
  buildPurchaseStarsPlan,
  buildUnlockMapWithStarsPlan,
  fetchCampaignView,
  type CampaignView,
} from "./campaignClient";
import { fetchPaymasterClient } from "./paymasterClient";
import { submitSponsoredTransactionPlan } from "./runPlan";
import { useEmbeddedIdentity } from "./embeddedIdentityContext";

export function useCampaignController() {
  const { connection } = useSolanaConnection();
  const { wallet } = useEmbeddedIdentity();
  const [campaign, setCampaign] = useState<CampaignView | null>(null);
  const [loading, setLoading] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet) return null;
    setLoading(true);
    try {
      const next = await fetchCampaignView({ connection, wallet });
      setCampaign(next);
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

  const unlock = useCallback(
    async (mapId: number) => {
      if (!wallet || !campaign) throw new Error("Campaign state is not ready");
      setUnlocking(true);
      try {
        const paymaster = await fetchPaymasterClient(connection);
        const transactionPlan = await buildUnlockMapWithStarsPlan({
          connection,
          wallet,
          contentVersion: campaign.contentVersion,
          mapId,
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
        setUnlocking(false);
      }
    },
    [campaign, connection, refresh, wallet],
  );

  const buyStars = useCallback(
    async (packIndex: number) => {
      if (!wallet || !campaign) throw new Error("Campaign state is not ready");
      setUnlocking(true);
      try {
        const paymaster = await fetchPaymasterClient(connection);
        const transactionPlan = await buildPurchaseStarsPlan({
          connection,
          wallet,
          campaign,
          packIndex,
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
        setUnlocking(false);
      }
    },
    [campaign, connection, refresh, wallet],
  );

  return { campaign, loading, unlocking, error, refresh, unlock, buyStars };
}
