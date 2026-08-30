import { useMemo } from "react";

import { useCampaign } from "@/contexts/campaign";
import type { ZoneProgressData } from "@/config/profileData";
import type { CampaignMapView } from "@/backend/solana/content/campaignClient";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";

export interface ZoneProgressResult {
  zones: ZoneProgressData[];
  totalStars: number;
  isLoading: boolean;
}

export function campaignMapsToZones(
  maps: readonly CampaignMapView[] | null,
): ZoneProgressData[] {
  const source =
    maps && maps.length > 0
      ? maps.filter((map) => map.enabled)
      : Array.from(
          { length: 10 },
          (_, index): CampaignMapView => ({
            mapId: index + 1,
            themeId: index + 1,
            enabled: true,
            unlocked: index === 0,
            cleared: false,
            perfected: false,
            levelStars: Array.from({ length: 10 }, () => 0),
            levels: [],
          }),
        );

  return source.map((map) => {
    return {
      zoneId: map.mapId,
      stars: map.levelStars.reduce((sum, stars) => sum + stars, 0),
      maxStars: 30,
      unlocked: map.unlocked,
      cleared: map.cleared,
      levelStars: map.levelStars,
      bossCleared: map.cleared,
      perfectionClaimed: map.perfected,
    };
  });
}

export const useZoneProgress = (
  playerAddress: string | undefined,
): ZoneProgressResult => {
  const { campaign, loading } = useCampaign();
  const { publicKey } = useConnectedPlayer();
  const isCurrentPlayer =
    Boolean(publicKey && (!playerAddress || playerAddress === publicKey.toBase58()));
  return useMemo(() => {
    if (!isCurrentPlayer) {
      return { zones: [], totalStars: 0, isLoading: false };
    }
    const zones = campaignMapsToZones(campaign?.maps ?? null);
    return {
      zones,
      totalStars: zones.reduce((sum, zone) => sum + zone.stars, 0),
      isLoading: loading,
    };
  }, [
    campaign?.maps,
    isCurrentPlayer,
    loading,
  ]);
};
