import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "@/utils/errors";
import { useSolanaConnection } from "./connectionContext";
import { fetchCampaignView, type CampaignView } from "./campaignClient";
import { useConnectedPlayer } from "./connectedPlayerContext";

export function useCampaignController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const [campaign, setCampaign] = useState<CampaignView | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchCampaignView({ connection, wallet });
      setCampaign(next);
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

  return {
    campaign,
    loading,
    loaded,
    error,
    refresh,
  };
}
