import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateMapData } from "@/hooks/useMapData";
import type { ClientCampaignMap } from "@/backend/client";

const cases = JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/unity-store-pages-v1.json"), "utf8")) as Array<{
  name: string; realm: number; owned: boolean; previousCleared: boolean; stars: number[]; available: number[];
}>;

describe("store page selection agrees with the actual TypeScript map helper", () => {
  for (const row of cases) it(row.name, () => {
    // LocalRunClient/LocalBackendLive own realm locking; this shared case binds
    // the presentation-only first-uncleared/cleared selection to generateMapData.
    const locked = row.realm >= 4 && !row.owned ? "purchase" : row.realm > 1 && !row.previousCleared ? "stars" : null;
    const map = { mapId: row.realm, themeId: row.realm, levelStars: row.stars, enabled: true,
      locked, cleared: row.stars[9] > 0, levels: [] } as unknown as ClientCampaignMap;
    const actual = generateMapData({ map }).nodes.filter(node => node.state !== "locked").map(node => node.contractLevel);
    expect(actual).toEqual(row.available);
  });
});
