// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { CampaignMapView } from "@/chain/campaignClient";
import { campaignMapsToZones } from "./useZoneProgress";

const map = (overrides: Partial<CampaignMapView> = {}): CampaignMapView => ({
  mapId: 3,
  themeId: 8,
  enabled: true,
  unlocked: true,
  purchased: false,
  cleared: false,
  perfected: false,
  starCost: 20n,
  levelStars: [3, 2, 1, 0, 0, 0, 0, 0, 0, 0],
  levels: [],
  ...overrides,
});

describe("campaignMapsToZones", () => {
  it("projects authoritative costs, flags, theme, and one-based progress", () => {
    expect(campaignMapsToZones([map()], 44)[0]).toMatchObject({
      zoneId: 3,
      themeId: 8,
      settingsId: 3,
      stars: 6,
      maxStars: 30,
      highestCleared: 3,
      starCost: 20,
      currentStars: 44,
    });
  });

  it("uses cleared as authoritative and omits disabled catalogs", () => {
    const zones = campaignMapsToZones(
      [
        map({ cleared: true, enabled: true }),
        map({ mapId: 4, enabled: false }),
      ],
      0,
    );
    expect(zones).toHaveLength(1);
    expect(zones[0].highestCleared).toBe(10);
  });

  it("makes only Map 1 playable before career initialization", () => {
    const zones = campaignMapsToZones(null, 0);
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

  it("leaves placeholder unlock prices unknown instead of zero", () => {
    const zones = campaignMapsToZones(null, 0);
    expect(zones[0].starCost).toBe(0);
    expect(zones.slice(1).every((zone) => zone.starCost === undefined)).toBe(
      true,
    );
  });

  it("prices placeholder maps from the economy fallback when known", () => {
    const zones = campaignMapsToZones(null, 0, 20);
    expect(zones[0].starCost).toBe(0);
    expect(zones.slice(1).every((zone) => zone.starCost === 20)).toBe(true);
  });

  it("treats a zero cost on a paid map as unknown, never free", () => {
    const zones = campaignMapsToZones([map({ starCost: 0n })], 0, null);
    expect(zones[0].starCost).toBeUndefined();
  });
});
