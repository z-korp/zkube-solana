import { useCallback, useEffect, useState } from "react";
import { useSolanaConnection } from "./connectionContext";
import {
  buildUnlockMapWithStarsPlan,
  fetchCampaignView,
  type CampaignView,
} from "./campaignClient";
import { fetchEconomyRuntime, type EconomyRuntime } from "./economyClient";
import { fetchPaymasterClient } from "./paymasterClient";
import { submitSponsoredTransactionPlan } from "./runPlan";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { SessionWallet } from "./sessionWallet";

export function useCampaignController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const [campaign, setCampaign] = useState<CampaignView | null>(null);
  // Player-independent pricing fallback: fresh players have no
  // PlayerProfile/CampaignProgress yet, so fetchCampaignView returns null and
  // the UI would otherwise have no zone-unlock price to show.
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
      setError(cause instanceof Error ? cause.message : String(cause));
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
        const paymaster = await fetchPaymasterClient(connection);
        const transactionPlan = await buildUnlockMapWithStarsPlan({
          connection,
          wallet: sessionWallet,
          ownerAuthority: owner,
          sessionToken: session.sessionToken,
          contentVersion: campaign.contentVersion,
          mapId,
          paymaster: paymaster.pubkey,
        });
        const signature = await submitSponsoredTransactionPlan({
          transactionPlan,
          wallet: sessionWallet,
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
    [campaign, connection, player, refresh],
  );

  return { campaign, economy, loading, loaded, unlocking, error, refresh, unlock };
}
