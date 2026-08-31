import type { ClientCampaignMap } from "@/backend/client";
import {
  CAMPAIGN_CONTENT_VERSION,
  canonicalCampaignMap,
} from "@/core/campaignCatalog";
import { mapLevelRuleSnapshot } from "@/core/runProjection";

let initialMap1: ClientCampaignMap | undefined;

export function campaignZoneActionLabel(
  resumableZone: number | null,
  zoneId: number,
  zoneStars: number,
): "Resume" | "Continue" | "Enter" {
  if (resumableZone === zoneId) return "Resume";
  return zoneStars > 0 ? "Continue" : "Enter";
}

export function uninitializedMap1(): ClientCampaignMap {
  if (initialMap1) return initialMap1;
  const authored = canonicalCampaignMap(CAMPAIGN_CONTENT_VERSION, 1);
  initialMap1 = {
    mapId: 1,
    themeId: 1,
    enabled: true,
    locked: null,
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
export function unavailableMap(mapId: number): ClientCampaignMap {
  return {
    ...uninitializedMap1(),
    mapId,
    themeId: mapId,
    enabled: false,
    locked: "stars",
    levelStars: Array.from({ length: 10 }, () => 0),
  };
}

export function resolveCampaignMap(
  maps: readonly ClientCampaignMap[] | null,
  mapId: number,
  loading: boolean,
): ClientCampaignMap | undefined {
  const current = maps?.find((map) => map.mapId === mapId);
  if (current) return current;
  if (!loading && maps === null && mapId === 1) return uninitializedMap1();
  return undefined;
}
