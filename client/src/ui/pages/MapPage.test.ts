import { describe, expect, it } from "vitest";

import type { CampaignMapView } from "@/solana/reboot/campaignClient";
import {
  levelIntentDestination,
  resolveCampaignMap,
  UNINITIALIZED_MAP_1,
} from "@/ui/components/map/mapLogic";

function campaignMap(mapId: number): CampaignMapView {
  return {
    ...UNINITIALIZED_MAP_1,
    mapId,
    themeId: mapId,
    levelStars: Array.from({ length: 10 }, () => 0),
  };
}

describe("MapPage campaign routing", () => {
  it("uses the authoritative map when campaign state exists", () => {
    const map = campaignMap(2);
    expect(resolveCampaignMap([map], 2, false)).toBe(map);
  });

  it("makes only Map 1 playable for an uninitialized career", () => {
    expect(resolveCampaignMap(null, 1, true)).toBeUndefined();
    expect(resolveCampaignMap(null, 1, false)).toBe(UNINITIALIZED_MAP_1);
    expect(resolveCampaignMap(null, 2, false)).toBeUndefined();
  });

  it("routes normal levels directly to play and guardians through reveal", () => {
    for (let level = 1; level < 10; level += 1) {
      expect(levelIntentDestination(level)).toBe("play");
    }
    expect(levelIntentDestination(10)).toBe("boss");
  });
});
