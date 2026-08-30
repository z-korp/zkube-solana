// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { ClientCampaignMap } from "@/backend/client";
import {
  resolveCampaignMap,
  uninitializedMap1,
} from "@/ui/components/map/mapLogic";

function campaignMap(mapId: number): ClientCampaignMap {
  return {
    ...uninitializedMap1(),
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
    expect(resolveCampaignMap(null, 1, false)).toBe(uninitializedMap1());
    expect(resolveCampaignMap(null, 2, false)).toBeUndefined();
  });
});
