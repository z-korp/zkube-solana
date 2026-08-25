// @vitest-environment node
import { describe, expect, it } from "vitest";
import fixtures from "../../../fixtures/game-parity.json";
import {
  CAMPAIGN_CONTENT_VERSION,
  CANONICAL_CAMPAIGN_MAP_COUNT,
  canonicalCampaignMap,
} from "@/chain/campaignCatalog";
import { transformDataContractIntoBlock } from "@/utils/gridUtils";

describe("shared game parity fixtures", () => {
  it("renders every coherent Rust/Cairo row as the same block entities", () => {
    for (const fixture of fixtures.validRows) {
      const blocks = transformDataContractIntoBlock([fixture.cells]);
      expect(
        blocks.map(({ x, width }) => ({ x, width })),
        fixture.name,
      ).toEqual(fixture.blocks);
    }
  });

  it("renders every golden operation result without changing block entities", () => {
    for (const fixture of fixtures.gridCases) {
      for (const expected of fixture.expectedRows) {
        const reconstructed = Array(8).fill(0);
        for (const block of transformDataContractIntoBlock([expected.cells])) {
          reconstructed.fill(block.width, block.x, block.x + block.width);
        }
        expect(reconstructed, fixture.name).toEqual(expected.cells);
      }
    }
  });

  it("keeps each map snapshot in sync with the authored catalog", () => {
    for (const map of fixtures.mapCatalog) {
      const authored = canonicalCampaignMap(
        CAMPAIGN_CONTENT_VERSION,
        map.mapId,
      );
      expect(authored.themeId, `map ${map.mapId}`).toBe(map.themeId);
      expect(authored.mapRules.bossId, `map ${map.mapId}`).toBe(map.bossId);
    }
  });

  it("keeps every authored campaign map internally coherent", () => {
    const maps = Array.from(
      { length: CANONICAL_CAMPAIGN_MAP_COUNT },
      (_, index) => canonicalCampaignMap(CAMPAIGN_CONTENT_VERSION, index + 1),
    );
    expect(maps.map((map) => map.themeId)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(maps.map((map) => map.mapRules.bossId)).toEqual([
      1, 2, 3, 4, 6, 7, 5, 8, 9, 10,
    ]);

    for (const map of maps) {
      expect(map.levels).toHaveLength(10);
      expect(map.mapRules.startingRows).toBeGreaterThanOrEqual(4);
      for (const level of map.levels) {
        expect(
          level.blockWeights.reduce((sum, weight) => sum + weight, 0),
        ).toBe(100);
      }
    }
  });
});
