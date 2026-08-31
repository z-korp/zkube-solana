// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { ClientCampaignMap } from "@/backend/client";
import { campaignMapsToZones } from "./useZoneProgress";

const map = (
  overrides: Partial<ClientCampaignMap> = {},
): ClientCampaignMap => ({
  mapId: 3,
  themeId: 8,
  enabled: true,
  locked: null,
  cleared: false,
  perfected: false,
  levelStars: [3, 2, 1, 0, 0, 0, 0, 0, 0, 0],
  levels: [],
  ...overrides,
});

describe("campaignMapsToZones", () => {
  it("projects guardian unlocks and star progress", () => {
    expect(campaignMapsToZones([map()])[0]).toMatchObject({
      zoneId: 3,
      stars: 6,
      maxStars: 30,
      unlocked: true,
      cleared: false,
    });
  });

  it("uses cleared as authoritative and omits disabled catalogs", () => {
    const zones = campaignMapsToZones([
      map({ cleared: true, enabled: true }),
      map({ mapId: 4, enabled: false }),
    ]);
    expect(zones).toHaveLength(1);
    expect(zones[0].cleared).toBe(true);
  });

  it("makes only Map 1 playable before career initialization", () => {
    const zones = campaignMapsToZones(null);
    expect(zones).toHaveLength(10);
    expect(zones.map((zone) => zone.unlocked)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
