import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "@/utils/errors";
import { useSolanaConnection } from "./connectionContext";
import {
  buildUnlockMapWithStarsPlan,
  fetchCampaignView,
  type CampaignView,
} from "./campaignClient";
import { fetchEconomyRuntime, type EconomyRuntime } from "./economyClient";
import { submitVersionedTransactionPlan } from "./runPlan";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { SessionWallet } from "./sessionWallet";

export function useCampaignController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const [campaign, setCampaign] = useState<CampaignView | null>(null);
  // Independent fallback for protocol/economy fetch failures. A fresh player
  // without PlayerState now receives the live public Campaign catalog.
  const [economy, setEconomy] = useState<EconomyRuntime | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchCampaignView({ connection, wallet });
      setCampaign(next);
      if (next === null) {
        setEconomy(await fetchEconomyRuntime({ connection, wallet }));
      } else {
        setEconomy(null);
      }
      setError(null);
      return next;
    } catch (cause) {
      setError(errorMessage(cause));
      return null;
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [connection, wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const unlock = useCallback(
    async (mapId: number) => {
      if (!campaign) throw new Error("Campaign state is not ready");
      const owner = player.publicKey;
      if (!owner) throw new Error("Connect a wallet before unlocking a map");
      const session = player.requireSession();
      const sessionWallet = new SessionWallet(session.signer);
      setUnlocking(true);
      try {
        const transactionPlan = await buildUnlockMapWithStarsPlan({
          connection,
          wallet: sessionWallet,
          ownerAuthority: owner,
          sessionToken: session.sessionToken,
          contentVersion: campaign.contentVersion,
          mapId,
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
        setUnlocking(false);
      }
    },
    [campaign, connection, player, refresh],
  );

  return {
    campaign,
    economy,
    loading,
    loaded,
    unlocking,
    error,
    refresh,
    unlock,
  };
}
