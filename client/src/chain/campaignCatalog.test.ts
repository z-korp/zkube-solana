import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/campaign-v2.json";

import {
  CAMPAIGN_CONTENT_VERSION,
  CANONICAL_CAMPAIGN_MAP_COUNT,
  canonicalCampaignMap,
} from "./campaignCatalog";
import { TIER_BLOCK_WEIGHTS } from "./protocolVersions.generated";

const maps = () =>
  Array.from({ length: CANONICAL_CAMPAIGN_MAP_COUNT }, (_, index) =>
    canonicalCampaignMap(CAMPAIGN_CONTENT_VERSION, index + 1),
  );

describe("Campaign content v2", () => {
  it("publishes the generated catalog exactly", () => {
    expect(fixture.contentVersion).toBe(CAMPAIGN_CONTENT_VERSION);
    expect(
      maps().map((map) => ({
        mapId: map.mapId,
        rules: [
          map.mapRules.guardian.bonus,
          map.mapRules.guardian.trigger,
          map.mapRules.guardian.threshold,
          map.mapRules.startingRows,
        ],
        levels: map.levels.map((level) => [
          level.pointsRequired,
          level.maxMoves,
          level.difficulty,
          [
            level.primary.kind,
            level.primary.value,
            level.primary.requiredCount,
          ],
          [
            level.secondary.kind,
            level.secondary.value,
            level.secondary.requiredCount,
          ],
        ]),
      })),
    ).toEqual(fixture.maps);
    expect(TIER_BLOCK_WEIGHTS).toEqual(fixture.difficultyWeights);
  });

  it("keeps realm guardians, boss archetypes, and trigger semantics stable", () => {
    const published = maps();
    expect(published.map((map) => map.mapRules.activeMutatorId)).toEqual([
      21, 23, 25, 27, 29, 31, 33, 35, 37, 39,
    ]);
    expect(published.map((map) => map.mapRules.bossId)).toEqual([
      1, 2, 3, 4, 6, 7, 5, 8, 9, 10,
    ]);
    for (const map of published) {
      const { trigger, threshold } = map.mapRules.guardian;
      const readsThreshold = [1, 2, 4, 7, 8, 9].includes(trigger);
      expect(trigger).not.toBe(3);
      expect(threshold > 0).toBe(readsThreshold);
    }
  });

  it("rejects other releases and returns defensive publications", () => {
    expect(() => canonicalCampaignMap(1, 1)).toThrow(
      /bound to content version 2/,
    );
    expect(() => canonicalCampaignMap(2, 0)).toThrow(/mapId must be between/);
    expect(() => canonicalCampaignMap(2, 11)).toThrow(/mapId must be between/);

    const first = canonicalCampaignMap(2, 1);
    const pristine = canonicalCampaignMap(2, 1);
    first.levels[0].pointsRequired = 999;
    first.levels[0].primary.kind = 3;
    expect(canonicalCampaignMap(2, 1)).toEqual(pristine);
  });
});
