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

function constraintCode(constraint: {
  kind: number;
  value: number;
  requiredCount: number;
}): string {
  if (constraint.kind === 0) return "-";
  if (constraint.kind === 1) {
    return `CL${constraint.value}x${constraint.requiredCount}`;
  }
  if (constraint.kind === 2) {
    return `BB${constraint.value}x${constraint.requiredCount}`;
  }
  return `CM${constraint.value}`;
}

function levelConstraintCode(
  level: ReturnType<typeof maps>[number]["levels"][number],
): string {
  return (
    [level.primary, level.secondary]
      .filter((constraint) => constraint.kind !== 0)
      .map(constraintCode)
      .join("+") || "-"
  );
}

describe("Campaign content v2", () => {
  it("matches the shared Rust simulation fixture exactly", () => {
    expect(fixture.contentVersion).toBe(CAMPAIGN_CONTENT_VERSION);
    expect(
      maps().map((map) => ({
        mapId: map.mapId,
        rules: [
          map.mapRules.scoreMultiplierX100,
          map.mapRules.comboMultiplierX100,
          map.mapRules.lineClearBonus,
          map.mapRules.perfectClearBonus,
          map.mapRules.starThresholdModifier,
          map.mapRules.bonusType,
          map.mapRules.bonusTriggerType,
          map.mapRules.bonusThreshold,
          map.mapRules.startingCharges,
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

  it("locks each guardian's scoring and renewable bonus identity", () => {
    const rules = maps().map((map) => map.mapRules);
    expect(rules.map((rule) => rule.activeMutatorId)).toEqual([
      21, 23, 25, 27, 29, 31, 33, 35, 37, 39,
    ]);
    expect(rules.map((rule) => rule.passiveMutatorId)).toEqual([
      22, 24, 26, 28, 30, 32, 34, 36, 38, 40,
    ]);
    expect(rules.map((rule) => rule.scoreMultiplierX100)).toEqual([
      100, 150, 100, 200, 100, 100, 300, 100, 100, 250,
    ]);
    expect(rules.map((rule) => rule.comboMultiplierX100)).toEqual([
      100, 100, 200, 100, 100, 200, 100, 200, 200, 250,
    ]);
    expect(rules.map((rule) => rule.lineClearBonus)).toEqual([
      1, 0, 1, 0, 3, 1, 0, 0, 2, 0,
    ]);
    expect(rules.map((rule) => rule.perfectClearBonus)).toEqual([
      0, 20, 0, 15, 0, 10, 20, 0, 0, 30,
    ]);
    expect(rules.map((rule) => rule.starThresholdModifier)).toEqual([
      126, 127, 128, 128, 128, 128, 128, 128, 128, 129,
    ]);
    expect(rules.map((rule) => rule.bonusType)).toEqual([
      3, 1, 2, 1, 3, 2, 1, 2, 2, 1,
    ]);
    expect(rules.map((rule) => rule.bonusTriggerType)).toEqual([
      1, 4, 1, 5, 2, 6, 4, 5, 7, 4,
    ]);
    expect(rules.map((rule) => rule.bonusThreshold)).toEqual([
      3, 2, 3, 0, 15, 0, 3, 0, 8, 4,
    ]);
    expect(rules.map((rule) => rule.startingCharges)).toEqual([
      1, 1, 1, 1, 1, 1, 1, 2, 1, 1,
    ]);
    expect(rules.map((rule) => rule.startingRows)).toEqual([
      4, 5, 4, 5, 6, 5, 5, 6, 6, 7,
    ]);
  });

  it("locks all one hundred archetype-specific constraints", () => {
    const expected = [
      [
        "-",
        "-",
        "CL2x1",
        "CM4",
        "CL2x2",
        "CM6",
        "CL2x3",
        "CL2x4+CM10",
        "CL3x2+CM14",
        "CL3x3+CM16",
      ],
      [
        "-",
        "BB1x6",
        "CL2x2",
        "BB2x8",
        "CL2x3",
        "BB1x8+CL2x3",
        "BB3x8",
        "BB2x10+CL3x2",
        "BB3x10+CL3x3",
        "BB4x7+CL3x3",
      ],
      [
        "-",
        "CL2x2",
        "CM6",
        "CL3x2",
        "CM8",
        "CM9+CL2x3",
        "CM11+CL3x2",
        "CM13+CL3x3",
        "CL4x1+CM15",
        "CL4x2+CM20",
      ],
      [
        "-",
        "CL2x2",
        "CM6",
        "CL3x1",
        "CM8",
        "CL3x2+CM10",
        "CL3x3+CM12",
        "CL4x1+CM14",
        "CL4x1+CM16",
        "CL4x2+CM18",
      ],
      [
        "-",
        "BB2x7",
        "CL2x2",
        "BB3x9",
        "CL2x3+BB1x10",
        "CL3x2+BB1x10",
        "CL3x2+BB2x12",
        "CL3x3+BB3x10",
        "CL4x1+BB4x8",
        "CL4x2+BB4x10",
      ],
      [
        "-",
        "BB1x8",
        "CM6",
        "CM8",
        "BB2x9",
        "CM10+BB3x8",
        "CM12+BB1x10",
        "CM14+BB3x10",
        "CM17+BB4x8",
        "CM20+BB4x10",
      ],
      [
        "-",
        "BB1x8",
        "BB1x10",
        "CM7",
        "BB2x10",
        "BB3x9+CM10",
        "BB1x12+CM12",
        "BB2x12+CM14",
        "BB4x9+CM16",
        "BB4x12+CM18",
      ],
      [
        "-",
        "BB2x8",
        "CM8",
        "CM10",
        "BB3x9",
        "BB1x10+CM12",
        "BB2x11+CM14",
        "BB3x10+CM16",
        "BB4x9+CM19",
        "BB4x11+CM22",
      ],
      [
        "-",
        "CM8",
        "CM10",
        "BB2x9",
        "CM12",
        "CM14+BB3x9",
        "CM16+BB2x11",
        "CM18+BB3x11",
        "CM22+BB4x10",
        "CM26+BB4x12",
      ],
      [
        "-",
        "CL3x1",
        "CL3x2",
        "BB3x8",
        "CL4x1",
        "CL4x2+BB4x8",
        "CL4x2+BB3x10",
        "CL5x1+BB4x10",
        "CL5x2+BB3x12",
        "CL5x2+BB4x12",
      ],
    ];
    expect(maps().map((map) => map.levels.map(levelConstraintCode))).toEqual(
      expected,
    );

    const allowedKinds = [
      [1, 3],
      [1, 2],
      [1, 3],
      [1, 3],
      [1, 2],
      [2, 3],
      [2, 3],
      [2, 3],
      [2, 3],
      [1, 2],
    ];
    maps().forEach((map, mapIndex) => {
      const allowed = new Set([0, ...allowedKinds[mapIndex]]);
      for (const level of map.levels) {
        expect(allowed.has(level.primary.kind)).toBe(true);
        expect(allowed.has(level.secondary.kind)).toBe(true);
      }
    });
  });

  it("retains the approved score targets, move caps, and difficulty tiers", () => {
    const expected = [
      [
        [10, 16, 0],
        [14, 20, 0],
        [18, 23, 0],
        [24, 27, 0],
        [30, 31, 1],
        [36, 35, 1],
        [43, 39, 1],
        [50, 42, 2],
        [59, 46, 2],
        [68, 50, 3],
      ],
      [
        [12, 18, 1],
        [16, 21, 1],
        [21, 24, 1],
        [27, 27, 2],
        [34, 30, 2],
        [43, 34, 2],
        [53, 38, 3],
        [65, 42, 3],
        [80, 46, 4],
        [98, 50, 4],
      ],
      [
        [14, 17, 1],
        [20, 20, 1],
        [27, 23, 2],
        [35, 26, 2],
        [44, 29, 2],
        [55, 32, 3],
        [68, 35, 3],
        [83, 38, 4],
        [101, 42, 4],
        [122, 46, 5],
      ],
      [
        [16, 16, 2],
        [22, 19, 2],
        [29, 22, 2],
        [37, 25, 3],
        [46, 28, 3],
        [57, 31, 3],
        [69, 34, 4],
        [83, 38, 4],
        [99, 42, 5],
        [118, 46, 5],
      ],
      [
        [18, 17, 2],
        [24, 20, 2],
        [32, 23, 3],
        [41, 26, 3],
        [51, 29, 3],
        [63, 32, 4],
        [77, 35, 4],
        [93, 38, 5],
        [111, 42, 5],
        [132, 46, 6],
      ],
      [
        [20, 16, 3],
        [27, 19, 3],
        [35, 22, 3],
        [44, 25, 4],
        [55, 28, 4],
        [68, 31, 4],
        [82, 34, 5],
        [98, 37, 5],
        [116, 40, 6],
        [137, 44, 6],
      ],
      [
        [22, 15, 3],
        [30, 18, 3],
        [39, 21, 4],
        [49, 24, 4],
        [61, 27, 4],
        [75, 29, 5],
        [91, 31, 5],
        [109, 33, 6],
        [129, 36, 6],
        [152, 39, 7],
      ],
      [
        [24, 16, 4],
        [33, 19, 4],
        [43, 22, 4],
        [54, 25, 5],
        [67, 28, 5],
        [82, 31, 5],
        [99, 34, 6],
        [118, 37, 6],
        [139, 40, 7],
        [163, 43, 7],
      ],
      [
        [28, 15, 4],
        [38, 18, 4],
        [49, 21, 5],
        [61, 24, 5],
        [75, 27, 5],
        [91, 30, 6],
        [109, 33, 6],
        [129, 36, 7],
        [151, 39, 7],
        [176, 42, 7],
      ],
      [
        [32, 15, 5],
        [44, 18, 5],
        [58, 21, 6],
        [73, 24, 6],
        [90, 27, 6],
        [110, 30, 7],
        [132, 33, 7],
        [156, 36, 7],
        [183, 39, 7],
        [214, 42, 7],
      ],
    ];
    expect(
      maps().map((map) =>
        map.levels.map((level) => [
          level.pointsRequired,
          level.maxMoves,
          level.difficulty,
        ]),
      ),
    ).toEqual(expected);
  });
});
