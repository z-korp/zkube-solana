import type { CampaignMapView } from "@/chain/campaignClient";
import { canonicalCampaignMap } from "@/chain/campaignCatalog";
import { mapLevelRuleSnapshot } from "@/chain/runPlan";
import type { PageId } from "@/stores/navigationStore";

const INITIAL_MAP_1 = canonicalCampaignMap(1, 1);

// A new identity has no PlayerState account yet. Map 1 remains playable,
// and its preview uses the same authored catalog that is published on-chain.
export const UNINITIALIZED_MAP_1: CampaignMapView = {
  mapId: 1,
  themeId: 1,
  enabled: true,
  unlocked: true,
  purchased: false,
  cleared: false,
  perfected: false,
  starCost: 0n,
  levelStars: Array.from({ length: 10 }, () => 0),
  levels: INITIAL_MAP_1.levels.map((level, index) =>
    mapLevelRuleSnapshot({
      ...level,
      ...INITIAL_MAP_1.mapRules,
      bossId: index === 9 ? INITIAL_MAP_1.mapRules.bossId : 0,
    }),
  ),
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
