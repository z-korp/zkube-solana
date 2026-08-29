import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/campaign-v2.json";

import {
  CAMPAIGN_CONTENT_VERSION,
  CANONICAL_CAMPAIGN_MAP_COUNT,
  canonicalCampaignMap,
} from "./campaignCatalog";

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
          map.mapRules.lineClearBonus,
          map.mapRules.perfectClearBonus,
          map.mapRules.bonusType,
          map.mapRules.bonusTriggerType,
          map.mapRules.bonusThreshold,
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
    for (const map of maps()) {
      for (const level of map.levels) {
        expect(level.blockWeights).toEqual(
          fixture.difficultyWeights[level.difficulty],
        );
      }
    }
  });

  it("keeps realm mutators, boss archetypes, and trigger semantics stable", () => {
    const published = maps();
    expect(published.map((map) => map.mapRules.activeMutatorId)).toEqual([
      21, 23, 25, 27, 29, 31, 33, 35, 37, 39,
    ]);
    expect(published.map((map) => map.mapRules.passiveMutatorId)).toEqual([
      22, 24, 26, 28, 30, 32, 34, 36, 38, 40,
    ]);
    expect(published.map((map) => map.mapRules.bossId)).toEqual([
      1, 2, 3, 4, 6, 7, 5, 8, 9, 10,
    ]);
    for (const map of published) {
      const { bonusTriggerType, bonusThreshold } = map.mapRules;
      const readsThreshold = [1, 2, 4, 7, 8, 9].includes(bonusTriggerType);
      expect(bonusTriggerType).not.toBe(3);
      expect(bonusThreshold > 0).toBe(readsThreshold);
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
    first.levels[0].blockWeights[0] = 999;
    expect(canonicalCampaignMap(2, 1)).toEqual(pristine);
  });
});
