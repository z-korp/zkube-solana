import { describe, expect, it } from "vitest";

import type { CampaignMapView } from "@/solana/reboot/campaignClient";
import { campaignMapsToZones } from "./useZoneProgress";

const map = (overrides: Partial<CampaignMapView> = {}): CampaignMapView => ({
  mapId: 3,
  themeId: 8,
  enabled: true,
  unlocked: true,
  purchased: false,
  cleared: false,
  perfected: false,
  starCost: 100n,
  usdcCost: 5_000_000n,
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
      starCost: 100,
      price: 5_000_000n,
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
});
