export const CANONICAL_CAMPAIGN_MAP_COUNT = 10;
export const MAX_CAMPAIGN_MAPS = 32;

export const BONUS_TRIGGER = {
  none: 0,
  atLeastLines: 1,
  cumulativeLines: 2,
  cumulativeScore: 3,
  exactLines: 4,
  perfectClear: 5,
  allBlockSizesOneMove: 6,
  comboMeterBoundary: 7,
} as const;

export interface CampaignConstraintPublication {
  kind: number;
  value: number;
  requiredCount: number;
}

export interface CampaignLevelPublication {
  level: number;
  pointsRequired: number;
  maxMoves: number;
  difficulty: number;
  primary: CampaignConstraintPublication;
  secondary: CampaignConstraintPublication;
  blockWeights: [number, number, number, number, number];
}

export interface CampaignMapRulesPublication {
  activeMutatorId: number;
  passiveMutatorId: number;
  bossId: number;
  scoreMultiplierX100: number;
  comboMultiplierX100: number;
  lineClearBonus: number;
  perfectClearBonus: number;
  starThresholdModifier: number;
  bonusType: number;
  bonusTriggerType: number;
  bonusThreshold: number;
  startingCharges: number;
  startingRows: number;
}

export interface CampaignMapPublication {
  mapId: number;
  themeId: number;
  enabled: boolean;
  mapRules: CampaignMapRulesPublication;
  levels: CampaignLevelPublication[];
}

const NONE = 0;
const COMBO_LINES = 1;
const BREAK_BLOCKS = 2;
const COMBO_METER = 3;
const EMPTY: CampaignConstraintPublication = { kind: NONE, value: 0, requiredCount: 0 };

const DIFFICULTY_WEIGHTS: readonly [number, number, number, number, number][] = [
  [15, 30, 30, 15, 10],
  [15, 25, 30, 20, 10],
  [15, 25, 25, 20, 15],
  [10, 20, 25, 25, 20],
  [10, 20, 20, 25, 25],
  [5, 15, 20, 30, 30],
  [1, 15, 15, 35, 34],
  [1, 5, 10, 49, 35],
];

type ConstraintTuple = readonly [kind: number, value: number, requiredCount: number];
type LevelTuple = readonly [
  pointsRequired: number,
  maxMoves: number,
  difficulty: number,
  primary?: ConstraintTuple,
  secondary?: ConstraintTuple,
];

interface AuthoredMap {
  mapId: number;
  themeId: number;
  mapRules: CampaignMapRulesPublication;
  levels: readonly LevelTuple[];
}

function mapRules(
  activeMutatorId: number,
  passiveMutatorId: number,
  bossId: number,
  bonusType: number,
  bonusTriggerType: number,
  bonusThreshold: number,
  startingCharges: number,
  scoreMultiplierX100: number,
  comboMultiplierX100: number,
  lineClearBonus: number,
  perfectClearBonus: number,
  starThresholdModifier: number,
  startingRows: number,
): CampaignMapRulesPublication {
  return {
    activeMutatorId,
    passiveMutatorId,
    bossId,
    scoreMultiplierX100,
    comboMultiplierX100,
    lineClearBonus,
    perfectClearBonus,
    starThresholdModifier,
    bonusType,
    bonusTriggerType,
    bonusThreshold,
    startingCharges,
    startingRows,
  };
}

const cl = (lines: number, times: number): ConstraintTuple => [COMBO_LINES, lines, times];
const bb = (size: number, count: number): ConstraintTuple => [BREAK_BLOCKS, size, count];
const cm = (target: number): ConstraintTuple => [COMBO_METER, target, 1];

const AUTHORED_MAPS: readonly AuthoredMap[] = [
  {
    mapId: 1,
    themeId: 1,
    mapRules: mapRules(1, 2, 1, 3, BONUS_TRIGGER.atLeastLines, 3, 1, 100, 100, 0, 0, 126, 4),
    levels: [
      [10, 16, 0], [14, 20, 0], [18, 23, 0, cl(2, 1)],
      [24, 27, 0, bb(1, 6)], [30, 31, 1, cm(4)], [36, 35, 1, cl(2, 2)],
      [43, 39, 1, bb(2, 8)], [50, 42, 2, cm(8), bb(1, 8)],
      [59, 46, 2, cl(2, 4), bb(2, 10)], [68, 50, 3, cl(3, 2), cm(14)],
    ],
  },
  {
    mapId: 2,
    themeId: 2,
    mapRules: mapRules(3, 4, 2, 1, BONUS_TRIGGER.exactLines, 2, 1, 125, 100, 0, 10, 127, 5),
    levels: [
      [12, 18, 1], [16, 21, 1, bb(1, 4)], [21, 24, 1, cl(2, 1)],
      [27, 27, 2, bb(2, 6)], [34, 30, 2, cm(4)], [43, 34, 2, cl(2, 2), bb(1, 6)],
      [53, 38, 3, bb(3, 6)], [65, 42, 3, cm(8), bb(2, 8)],
      [80, 46, 4, cl(3, 2), bb(3, 8)], [98, 50, 4, bb(4, 5), cl(3, 2)],
    ],
  },
  {
    mapId: 3,
    themeId: 3,
    mapRules: mapRules(5, 6, 3, 2, BONUS_TRIGGER.atLeastLines, 3, 1, 100, 150, 1, 0, 128, 4),
    levels: [
      [14, 17, 1], [20, 20, 1, cl(2, 1)], [27, 23, 2, cm(4)],
      [35, 26, 2, cl(3, 1)], [44, 29, 2, bb(2, 8)], [55, 32, 3, cm(7), cl(2, 2)],
      [68, 35, 3, bb(3, 7), cl(3, 1)], [83, 38, 4, cm(10), bb(2, 10)],
      [101, 42, 4, cl(4, 1), cm(12)], [122, 46, 5, cm(16), cl(4, 2)],
    ],
  },
  {
    mapId: 4,
    themeId: 4,
    mapRules: mapRules(7, 8, 4, 1, BONUS_TRIGGER.perfectClear, 0, 1, 125, 100, 0, 15, 128, 5),
    levels: [
      [16, 16, 2], [22, 19, 2, bb(1, 5)], [29, 22, 2, cl(2, 1)],
      [37, 25, 3, cm(4)], [46, 28, 3, bb(3, 6)], [57, 31, 3, cl(3, 1), bb(1, 6)],
      [69, 34, 4, cm(8), bb(2, 8)], [83, 38, 4, cl(3, 2), bb(3, 7)],
      [99, 42, 5, cm(12), bb(4, 5)], [118, 46, 5, cl(4, 2), cm(15)],
    ],
  },
  {
    mapId: 5,
    themeId: 5,
    mapRules: mapRules(9, 10, 6, 3, BONUS_TRIGGER.cumulativeLines, 15, 1, 100, 100, 1, 0, 128, 6),
    levels: [
      [18, 17, 2], [24, 20, 2, bb(2, 5)], [32, 23, 3, cl(2, 1)],
      [41, 26, 3, cm(5)], [51, 29, 3, bb(3, 7)], [63, 32, 4, cl(3, 1), bb(1, 8)],
      [77, 35, 4, cm(9), bb(2, 10)], [93, 38, 5, cl(3, 2), bb(3, 8)],
      [111, 42, 5, cm(13), bb(4, 6)], [132, 46, 6, cl(4, 2), bb(4, 8)],
    ],
  },
  {
    mapId: 6,
    themeId: 6,
    mapRules: mapRules(11, 12, 7, 2, BONUS_TRIGGER.allBlockSizesOneMove, 0, 1, 100, 150, 0, 10, 128, 5),
    levels: [
      [20, 16, 3], [27, 19, 3, bb(1, 6)], [35, 22, 3, cl(2, 1)],
      [44, 25, 4, cm(5)], [55, 28, 4, bb(2, 7)], [68, 31, 4, cl(3, 1), bb(3, 6)],
      [82, 34, 5, cm(9), bb(1, 8)], [98, 37, 5, cl(3, 2), bb(3, 8)],
      [116, 40, 6, cm(13), bb(4, 6)], [137, 44, 6, cm(16), bb(4, 8)],
    ],
  },
  {
    mapId: 7,
    themeId: 7,
    mapRules: mapRules(13, 14, 5, 1, BONUS_TRIGGER.exactLines, 3, 1, 175, 100, 0, 0, 128, 5),
    levels: [
      [22, 15, 3], [30, 18, 3, cl(2, 1)], [39, 21, 4, bb(1, 5)],
      [49, 24, 4, cm(5)], [61, 27, 4, bb(2, 7)], [75, 29, 5, cl(3, 1), bb(3, 6)],
      [91, 31, 5, cm(9), bb(1, 8)], [109, 33, 6, cl(4, 1), bb(2, 8)],
      [129, 36, 6, cm(13), bb(4, 6)], [152, 39, 7, cm(16), bb(4, 8)],
    ],
  },
  {
    mapId: 8,
    themeId: 8,
    mapRules: mapRules(15, 16, 8, 3, BONUS_TRIGGER.perfectClear, 0, 2, 100, 200, 0, 0, 128, 6),
    levels: [
      [24, 16, 4], [33, 19, 4, bb(2, 6)], [43, 22, 4, cl(2, 1)],
      [54, 25, 5, cm(5)], [67, 28, 5, bb(3, 7)], [82, 31, 5, cl(3, 1), bb(1, 8)],
      [99, 34, 6, cm(9), bb(2, 9)], [118, 37, 6, cl(4, 1), bb(3, 8)],
      [139, 40, 7, cm(14), bb(4, 7)], [163, 43, 7, bb(4, 8), cm(17)],
    ],
  },
  {
    mapId: 9,
    themeId: 9,
    mapRules: mapRules(17, 18, 9, 2, BONUS_TRIGGER.comboMeterBoundary, 8, 1, 100, 200, 1, 0, 128, 6),
    levels: [
      [28, 15, 4], [38, 18, 4, cl(2, 1)], [49, 21, 5, cm(4)],
      [61, 24, 5, bb(2, 6)], [75, 27, 5, cm(7)], [91, 30, 6, cl(3, 1), bb(3, 6)],
      [109, 33, 6, cm(10), bb(2, 8)], [129, 36, 7, cl(4, 1), cm(12)],
      [151, 39, 7, cm(16), bb(4, 7)], [176, 42, 7, cm(20), bb(4, 9)],
    ],
  },
  {
    mapId: 10,
    themeId: 10,
    mapRules: mapRules(19, 20, 10, 1, BONUS_TRIGGER.exactLines, 4, 1, 150, 200, 0, 20, 129, 7),
    levels: [
      [32, 15, 5], [44, 18, 5, cm(5)], [58, 21, 6, cl(3, 1)],
      [73, 24, 6, bb(3, 6)], [90, 27, 6, cm(9)], [110, 30, 7, cl(4, 1), bb(4, 6)],
      [132, 33, 7, cm(13), bb(3, 8)], [156, 36, 7, cl(5, 1), bb(4, 8)],
      [183, 39, 7, cm(18), cl(4, 2)], [214, 42, 7, cl(5, 2), bb(4, 10)],
    ],
  },
];

export function canonicalCampaignMap(
  contentVersion: number,
  mapId: number,
): CampaignMapPublication {
  assertU32(contentVersion, "contentVersion");
  const authored = AUTHORED_MAPS[mapId - 1];
  if (!authored || authored.mapId !== mapId) {
    throw new Error(`mapId must be between 1 and ${CANONICAL_CAMPAIGN_MAP_COUNT}`);
  }
  if (authored.levels.length !== 10) throw new Error(`map ${mapId} must contain ten levels`);
  return {
    mapId,
    themeId: authored.themeId,
    enabled: true,
    mapRules: { ...authored.mapRules },
    levels: authored.levels.map((tuple, index) => level(index + 1, tuple)),
  };
}

function level(levelNumber: number, tuple: LevelTuple): CampaignLevelPublication {
  const [pointsRequired, maxMoves, difficulty, primary, secondary] = tuple;
  return {
    level: levelNumber,
    pointsRequired,
    maxMoves,
    difficulty,
    primary: publicationConstraint(primary),
    secondary: publicationConstraint(secondary),
    blockWeights: [...DIFFICULTY_WEIGHTS[difficulty]],
  };
}

function publicationConstraint(tuple?: ConstraintTuple): CampaignConstraintPublication {
  if (!tuple) return { ...EMPTY };
  return { kind: tuple[0], value: tuple[1], requiredCount: tuple[2] };
}

function assertU32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 0xffff_ffff) {
    throw new Error(`${label} must be a positive u32`);
  }
}
