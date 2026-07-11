import { useCallback, useEffect, useState } from "react";
import { useSolanaConnection } from "../connectionContext";
import {
  buildPurchaseMapWithUsdcPlan,
  buildUnlockMapWithStarsPlan,
  fetchCampaignView,
  type CampaignView,
} from "./campaignClient";
import { fetchPaymasterClient } from "./paymasterClient";
import { submitSponsoredTransactionPlan } from "./runPlan";
import { useEmbeddedIdentity } from "./embeddedIdentityContext";

export function useRebootCampaign() {
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
    async (mapId: number, payment: "stars" | "usdc") => {
      if (!wallet || !campaign) throw new Error("Campaign state is not ready");
      setUnlocking(true);
      try {
        const paymaster = await fetchPaymasterClient(connection);
        const transactionPlan =
          payment === "stars"
            ? await buildUnlockMapWithStarsPlan({
                connection,
                wallet,
                contentVersion: campaign.contentVersion,
                mapId,
                paymaster: paymaster.pubkey,
              })
            : await buildPurchaseMapWithUsdcPlan({
                connection,
                wallet,
                campaign,
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

  return { campaign, loading, unlocking, error, refresh, unlock };
}
