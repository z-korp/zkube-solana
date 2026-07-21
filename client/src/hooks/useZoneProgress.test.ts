// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { CampaignMapView } from "@/chain/campaignClient";
import { campaignMapsToZones } from "./useZoneProgress";

const map = (overrides: Partial<CampaignMapView> = {}): CampaignMapView => ({
  mapId: 3,
  themeId: 8,
  enabled: true,
  unlocked: true,
  cleared: false,
  perfected: false,
  levelStars: [3, 2, 1, 0, 0, 0, 0, 0, 0, 0],
  levels: [],
  ...overrides,
});

describe("campaignMapsToZones", () => {
  it("projects guardian unlocks, theme, and one-based progress", () => {
    expect(campaignMapsToZones([map()])[0]).toMatchObject({
      zoneId: 3,
      themeId: 8,
      settingsId: 3,
      stars: 6,
      maxStars: 30,
      highestCleared: 3,
      isFree: true,
    });
  });

  it("uses cleared as authoritative and omits disabled catalogs", () => {
    const zones = campaignMapsToZones(
      [
        map({ cleared: true, enabled: true }),
        map({ mapId: 4, enabled: false }),
      ],
    );
    expect(zones).toHaveLength(1);
    expect(zones[0].highestCleared).toBe(10);
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

  it("keeps every placeholder map free of purchase pricing", () => {
    const zones = campaignMapsToZones(null);
    expect(zones.every((zone) => zone.isFree)).toBe(true);
  });

  it("does not invent a price for a locked guardian-gated map", () => {
    const zones = campaignMapsToZones([map({ unlocked: false })]);
    expect(zones[0].isFree).toBe(true);
  });
});
