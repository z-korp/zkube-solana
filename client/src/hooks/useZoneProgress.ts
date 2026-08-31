import { useMemo } from "react";

import {
  useCampaign,
  useConnectedPlayer,
  type ClientCampaignMap,
} from "@/backend/client";
import type { ZoneProgressData } from "@/config/profileData";

export interface ZoneProgressResult {
  zones: ZoneProgressData[];
  totalStars: number;
  isLoading: boolean;
}

export function campaignMapsToZones(
  maps: readonly ClientCampaignMap[] | null,
): ZoneProgressData[] {
  const source =
    maps && maps.length > 0
      ? maps.filter((map) => map.enabled)
      : Array.from(
          { length: 10 },
          (_, index): ClientCampaignMap => ({
            mapId: index + 1,
            themeId: index + 1,
            enabled: true,
            locked: index === 0 ? null : "stars",
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
      unlocked: map.locked === null,
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
  const { connectionStatus, publicKey } = useConnectedPlayer();
  const isCurrentPlayer =
    connectionStatus === "connected" &&
    (!publicKey || !playerAddress || playerAddress === publicKey);
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
  }, [campaign?.maps, isCurrentPlayer, loading]);
};
