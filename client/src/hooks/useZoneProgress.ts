import { useMemo } from "react";

import { useCampaign } from "@/contexts/campaign";
import {
  ZONE_EMOJIS,
  ZONE_NAMES,
  type ZoneProgressData,
} from "@/config/profileData";
import type { CampaignMapView } from "@/chain/campaignClient";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { highestClearedLevel } from "@/utils/solanaDisplay";

export interface ZoneProgressResult {
  zones: ZoneProgressData[];
  totalStars: number;
  isLoading: boolean;
}

export function campaignMapsToZones(
  maps: readonly CampaignMapView[] | null,
  currentStars: number,
  fallbackZoneUnlockStars: number | null = null,
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
    // Map 1 is always free; paid maps never legitimately cost 0, so a zero
    // cost means the price is not known yet (placeholder or stale snapshot).
    const starCost =
      map.mapId === 1
        ? 0
        : map.starCost > 0n
          ? Number(map.starCost)
          : (fallbackZoneUnlockStars ?? undefined);
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
      starCost,
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
  const { campaign, economy, loading } = useCampaign();
  const { publicKey } = useConnectedPlayer();
  const isCurrentPlayer =
    Boolean(publicKey && (!playerAddress || playerAddress === publicKey.toBase58()));
  const fallbackZoneUnlockStars = economy
    ? Number(economy.zoneUnlockStars)
    : null;

  return useMemo(() => {
    if (!isCurrentPlayer) {
      return { zones: [], totalStars: 0, isLoading: false };
    }
    const zones = campaignMapsToZones(
      campaign?.maps ?? null,
      zStarBalance,
      fallbackZoneUnlockStars,
    );
    return {
      zones,
      totalStars: zones.reduce((sum, zone) => sum + zone.stars, 0),
      isLoading: loading,
    };
  }, [
    campaign?.maps,
    fallbackZoneUnlockStars,
    isCurrentPlayer,
    loading,
    zStarBalance,
  ]);
};
