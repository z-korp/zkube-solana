import { useMemo } from "react";

import { useCampaign } from "@/contexts/campaign";
import {
  ZONE_EMOJIS,
  ZONE_NAMES,
  type ZoneProgressData,
} from "@/config/profileData";
import type { CampaignMapView } from "@/chain/campaignClient";
import { useEmbeddedIdentity } from "@/chain/embeddedIdentityContext";
import { highestClearedLevel } from "@/utils/solanaDisplay";

export interface ZoneProgressResult {
  zones: ZoneProgressData[];
  totalStars: number;
  isLoading: boolean;
}

export function campaignMapsToZones(
  maps: readonly CampaignMapView[] | null,
  currentStars: number,
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
            purchased: false,
            cleared: false,
            perfected: false,
            starCost: 0n,
            levelStars: Array.from({ length: 10 }, () => 0),
            levels: [],
          }),
        );

  return source.map((map) => {
    const highestCleared = map.cleared
      ? 10
      : highestClearedLevel(map.levelStars);
    return {
      zoneId: map.mapId,
      themeId: map.themeId,
      settingsId: map.mapId,
      name: ZONE_NAMES[map.mapId] ?? `Zone ${map.mapId}`,
      emoji: ZONE_EMOJIS[map.mapId] ?? "🗺️",
      stars: map.levelStars.reduce((sum, stars) => sum + stars, 0),
      maxStars: 30,
      unlocked: map.unlocked,
      cleared: map.cleared,
      isFree: map.mapId === 1,
      starCost: Number(map.starCost),
      currentStars,
      levelStars: map.levelStars,
      highestCleared,
      bossCleared: map.cleared,
      perfectionClaimed: map.perfected,
    };
  });
}

export const useZoneProgress = (
  playerAddress: string | undefined,
  zStarBalance: number,
): ZoneProgressResult => {
  const { campaign, loading } = useCampaign();
  const { publicKey } = useEmbeddedIdentity();
  const isCurrentPlayer =
    !playerAddress || playerAddress === publicKey.toBase58();

  return useMemo(() => {
    if (!isCurrentPlayer) {
      return { zones: [], totalStars: 0, isLoading: false };
    }
    const zones = campaignMapsToZones(campaign?.maps ?? null, zStarBalance);
    return {
      zones,
      totalStars: zones.reduce((sum, zone) => sum + zone.stars, 0),
      isLoading: loading,
    };
  }, [campaign?.maps, isCurrentPlayer, loading, zStarBalance]);
};
