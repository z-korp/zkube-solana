import { describe, expect, it } from "vitest";
import fixtures from "../../../fixtures/game-parity.json";
import {
  CANONICAL_CAMPAIGN_MAP_COUNT,
  canonicalCampaignMap,
} from "@/chain/campaignCatalog";
import { transformDataContractIntoBlock } from "@/utils/gridUtils";
import { BOSS_IDENTITIES } from "@/config/bossIdentities";

const CAMPAIGN_WEIGHT_CURVE = [
  [15, 30, 30, 15, 10],
  [15, 25, 30, 20, 10],
  [15, 25, 25, 20, 15],
  [10, 20, 25, 25, 20],
  [10, 20, 20, 25, 25],
  [5, 15, 20, 30, 30],
  [1, 15, 15, 35, 34],
  [1, 5, 10, 49, 35],
] as const;

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

  it("keeps the canonical boss identity attached to each map snapshot", () => {
    for (const map of fixtures.mapCatalog) {
      expect(BOSS_IDENTITIES[map.bossId]?.name, `map ${map.mapId}`).toBe(map.bossName);
    }
  });

  it("keeps every authored campaign map internally coherent", () => {
    const maps = Array.from(
      { length: CANONICAL_CAMPAIGN_MAP_COUNT },
      (_, index) => canonicalCampaignMap(1, index + 1),
    );
    expect(maps.map((map) => map.themeId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(maps.map((map) => map.mapRules.bossId)).toEqual([1, 2, 3, 4, 6, 7, 5, 8, 9, 10]);
    expect(maps.map((map) => map.mapRules.bonusTriggerType)).toEqual([
      1, 4, 1, 5, 2, 6, 4, 5, 7, 4,
    ]);

    for (const map of maps) {
      expect(map.levels).toHaveLength(10);
      expect(map.mapRules.startingRows).toBeGreaterThanOrEqual(4);
      for (const level of map.levels) {
        expect(level.blockWeights.reduce((sum, weight) => sum + weight, 0)).toBe(100);
        expect(level.blockWeights).toEqual(CAMPAIGN_WEIGHT_CURVE[level.difficulty]);
      }
    }
  });

  it("keeps the approved Zone 1 authored curve exact", () => {
    const map = canonicalCampaignMap(1, 1);
    expect(
      map.levels.map((level) => ({
        level: level.level,
        pointsRequired: level.pointsRequired,
        maxMoves: level.maxMoves,
        difficulty: level.difficulty,
        primary: [
          level.primary.kind,
          level.primary.value,
          level.primary.requiredCount,
        ],
        secondary: [
          level.secondary.kind,
          level.secondary.value,
          level.secondary.requiredCount,
        ],
      })),
    ).toEqual([
      [10, 16, 0, [0, 0, 0], [0, 0, 0]],
      [14, 20, 0, [0, 0, 0], [0, 0, 0]],
      [18, 23, 0, [1, 2, 1], [0, 0, 0]],
      [24, 27, 0, [2, 1, 6], [0, 0, 0]],
      [30, 31, 1, [3, 4, 1], [0, 0, 0]],
      [36, 35, 1, [1, 2, 2], [0, 0, 0]],
      [43, 39, 1, [2, 2, 8], [0, 0, 0]],
      [50, 42, 2, [3, 8, 1], [2, 1, 8]],
      [59, 46, 2, [1, 2, 4], [2, 2, 10]],
      [68, 50, 3, [1, 3, 2], [3, 14, 1]],
    ].map(([pointsRequired, maxMoves, difficulty, primary, secondary], index) => ({
      level: index + 1,
      pointsRequired,
      maxMoves,
      difficulty,
      primary,
      secondary,
    })));

    expect(map.mapRules).toMatchObject({
      activeMutatorId: 1,
      passiveMutatorId: 2,
      bossId: 1,
      scoreMultiplierX100: 100,
      comboMultiplierX100: 100,
      lineClearBonus: 0,
      perfectClearBonus: 0,
      starThresholdModifier: 126,
      bonusType: 3,
      bonusTriggerType: 1,
      bonusThreshold: 3,
      startingCharges: 1,
      startingRows: 4,
    });
  });

  it("keeps authored levels version-stable and returns defensive copies", () => {
    const first = canonicalCampaignMap(1, 1);
    const later = canonicalCampaignMap(99, 1);
    expect(first).toEqual(later);

    first.levels[0].pointsRequired = 999;
    first.levels[0].primary.kind = 3;
    first.levels[0].blockWeights[0] = 999;
    expect(canonicalCampaignMap(1, 1).levels[0]).toEqual(later.levels[0]);

    expect(canonicalCampaignMap(1, 2)).toEqual(canonicalCampaignMap(2, 2));
  });
});
