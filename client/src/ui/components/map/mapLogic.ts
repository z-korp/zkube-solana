import type { CampaignMapView } from "@/chain/campaignClient";
import type { PageId } from "@/stores/navigationStore";

// A new identity has no CampaignProgress account until its first sponsored
// Map 1 run. The fallback must remain playable so that first run can create it.
export const UNINITIALIZED_MAP_1: CampaignMapView = {
  mapId: 1,
  themeId: 1,
  enabled: true,
  unlocked: true,
  purchased: false,
  cleared: false,
  perfected: false,
  starCost: 0n,
  usdcCost: 0n,
  levelStars: Array.from({ length: 10 }, () => 0),
  levels: [],
};

export function unavailableMap(mapId: number): CampaignMapView {
  return {
    ...UNINITIALIZED_MAP_1,
    mapId,
    themeId: mapId,
    enabled: false,
    unlocked: false,
    levelStars: Array.from({ length: 10 }, () => 0),
  };
}

export function resolveCampaignMap(
  maps: readonly CampaignMapView[] | null,
  mapId: number,
  loading: boolean,
): CampaignMapView | undefined {
  const current = maps?.find((map) => map.mapId === mapId);
  if (current) return current;
  if (!loading && maps === null && mapId === 1) return UNINITIALIZED_MAP_1;
  return undefined;
}

export function levelIntentDestination(level: number): PageId {
  return level === 10 ? "boss" : "play";
}
