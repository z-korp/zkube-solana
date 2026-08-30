import type { CampaignMapView } from "@/chain/campaignClient";
import {
  CAMPAIGN_CONTENT_VERSION,
  canonicalCampaignMap,
} from "@/chain/campaignCatalog";
import { mapLevelRuleSnapshot } from "@/chain/runPlan";

let initialMap1: CampaignMapView | undefined;

export function uninitializedMap1(): CampaignMapView {
  if (initialMap1) return initialMap1;
  const authored = canonicalCampaignMap(CAMPAIGN_CONTENT_VERSION, 1);
  initialMap1 = {
    mapId: 1,
    themeId: 1,
    enabled: true,
    unlocked: true,
    cleared: false,
    perfected: false,
    levelStars: Array.from({ length: 10 }, () => 0),
    levels: authored.levels.map((level, index) =>
      mapLevelRuleSnapshot(
        {
          ...level,
          ...authored.mapRules,
          bossId: index === 9 ? authored.mapRules.bossId : 0,
        },
        1,
        index + 1,
        "campaign",
      ),
    ),
  };
  return initialMap1;
}

// A new identity has no PlayerState account yet. Map 1 remains playable,
// and its preview uses the same authored catalog that is published on-chain.
export function unavailableMap(mapId: number): CampaignMapView {
  return {
    ...uninitializedMap1(),
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
  if (!loading && maps === null && mapId === 1) return uninitializedMap1();
  return undefined;
}
