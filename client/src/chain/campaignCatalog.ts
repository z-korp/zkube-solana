export const CANONICAL_CAMPAIGN_MAP_COUNT = 10;
export const MAX_CAMPAIGN_MAPS = CANONICAL_CAMPAIGN_MAP_COUNT;
export const CAMPAIGN_CONTENT_VERSION = 2;

const BONUS_TRIGGER = {
  none: 0,
  atLeastLines: 1,
  cumulativeLines: 2,
  cumulativeScore: 3,
  exactLines: 4,
  perfectClear: 5,
  allBlockSizesOneMove: 6,
  comboMeterBoundary: 7,
} as const;

interface CampaignConstraintPublication {
  kind: number;
  value: number;
  requiredCount: number;
}

interface CampaignLevelPublication {
  level: number;
  pointsRequired: number;
  maxMoves: number;
  difficulty: number;
  primary: CampaignConstraintPublication;
  secondary: CampaignConstraintPublication;
  blockWeights: [number, number, number, number, number];
}

interface CampaignMapRulesPublication {
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
const EMPTY: CampaignConstraintPublication = {
  kind: NONE,
  value: 0,
  requiredCount: 0,
};

const DIFFICULTY_WEIGHTS: readonly [number, number, number, number, number][] =
  [
    [15, 30, 30, 15, 10],
    [15, 25, 30, 20, 10],
    [15, 25, 25, 20, 15],
    [10, 20, 25, 25, 20],
    [10, 20, 20, 25, 25],
    [5, 15, 20, 30, 30],
    [1, 15, 15, 35, 34],
    [1, 5, 10, 49, 35],
  ];

type ConstraintTuple = readonly [
  kind: number,
  value: number,
  requiredCount: number,
];
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

const cl = (lines: number, times: number): ConstraintTuple => [
  COMBO_LINES,
  lines,
  times,
];
const bb = (size: number, count: number): ConstraintTuple => [
  BREAK_BLOCKS,
  size,
  count,
];
const cm = (target: number): ConstraintTuple => [COMBO_METER, target, 1];

const CAMPAIGN_V2_MAPS: readonly AuthoredMap[] = [
  {
    mapId: 1,
    themeId: 1,
    mapRules: mapRules(
      21,
      22,
      1,
      3,
      BONUS_TRIGGER.atLeastLines,
      3,
      1,
      100,
      100,
      1,
      0,
      126,
      4,
    ),
    levels: [
      [10, 16, 0],
      [14, 20, 0],
      [18, 23, 0, cl(2, 1)],
      [24, 27, 0, cm(4)],
      [30, 31, 1, cl(2, 2)],
      [36, 35, 1, cm(6)],
      [43, 39, 1, cl(2, 3)],
      [50, 42, 2, cl(2, 4), cm(10)],
      [59, 46, 2, cl(3, 2), cm(14)],
      [68, 50, 3, cl(3, 3), cm(16)],
    ],
  },
  {
    mapId: 2,
    themeId: 2,
    mapRules: mapRules(
      23,
      24,
      2,
      1,
      BONUS_TRIGGER.exactLines,
      2,
      1,
      150,
      100,
      0,
      20,
      127,
      5,
    ),
    levels: [
      [12, 18, 1],
      [16, 21, 1, bb(1, 6)],
      [21, 24, 1, cl(2, 2)],
      [27, 27, 2, bb(2, 8)],
      [34, 30, 2, cl(2, 3)],
      [43, 34, 2, bb(1, 8), cl(2, 3)],
      [53, 38, 3, bb(3, 8)],
      [65, 42, 3, bb(2, 10), cl(3, 2)],
      [80, 46, 4, bb(3, 10), cl(3, 3)],
      [98, 50, 4, bb(4, 7), cl(3, 3)],
    ],
  },
  {
    mapId: 3,
    themeId: 3,
    mapRules: mapRules(
      25,
      26,
      3,
      2,
      BONUS_TRIGGER.atLeastLines,
      3,
      1,
      100,
      200,
      1,
      0,
      128,
      4,
    ),
    levels: [
      [14, 17, 1],
      [20, 20, 1, cl(2, 2)],
      [27, 23, 2, cm(6)],
      [35, 26, 2, cl(3, 2)],
      [44, 29, 2, cm(8)],
      [55, 32, 3, cm(9), cl(2, 3)],
      [68, 35, 3, cm(11), cl(3, 2)],
      [83, 38, 4, cm(13), cl(3, 3)],
      [101, 42, 4, cl(4, 1), cm(15)],
      [122, 46, 5, cl(4, 2), cm(20)],
    ],
  },
  {
    mapId: 4,
    themeId: 4,
    mapRules: mapRules(
      27,
      28,
      4,
      1,
      BONUS_TRIGGER.perfectClear,
      0,
      1,
      200,
      100,
      0,
      15,
      128,
      5,
    ),
    levels: [
      [16, 16, 2],
      [22, 19, 2, cl(2, 2)],
      [29, 22, 2, cm(6)],
      [37, 25, 3, cl(3, 1)],
      [46, 28, 3, cm(8)],
      [57, 31, 3, cl(3, 2), cm(10)],
      [69, 34, 4, cl(3, 3), cm(12)],
      [83, 38, 4, cl(4, 1), cm(14)],
      [99, 42, 5, cl(4, 1), cm(16)],
      [118, 46, 5, cl(4, 2), cm(18)],
    ],
  },
  {
    mapId: 5,
    themeId: 5,
    mapRules: mapRules(
      29,
      30,
      6,
      3,
      BONUS_TRIGGER.cumulativeLines,
      15,
      1,
      100,
      100,
      3,
      0,
      128,
      6,
    ),
    levels: [
      [18, 17, 2],
      [24, 20, 2, bb(2, 7)],
      [32, 23, 3, cl(2, 2)],
      [41, 26, 3, bb(3, 9)],
      [51, 29, 3, cl(2, 3), bb(1, 10)],
      [63, 32, 4, cl(3, 2), bb(1, 10)],
      [77, 35, 4, cl(3, 2), bb(2, 12)],
      [93, 38, 5, cl(3, 3), bb(3, 10)],
      [111, 42, 5, cl(4, 1), bb(4, 8)],
      [132, 46, 6, cl(4, 2), bb(4, 10)],
    ],
  },
  {
    mapId: 6,
    themeId: 6,
    mapRules: mapRules(
      31,
      32,
      7,
      2,
      BONUS_TRIGGER.allBlockSizesOneMove,
      0,
      1,
      100,
      200,
      1,
      10,
      128,
      5,
    ),
    levels: [
      [20, 16, 3],
      [27, 19, 3, bb(1, 8)],
      [35, 22, 3, cm(6)],
      [44, 25, 4, cm(8)],
      [55, 28, 4, bb(2, 9)],
      [68, 31, 4, cm(10), bb(3, 8)],
      [82, 34, 5, cm(12), bb(1, 10)],
      [98, 37, 5, cm(14), bb(3, 10)],
      [116, 40, 6, cm(17), bb(4, 8)],
      [137, 44, 6, cm(20), bb(4, 10)],
    ],
  },
  {
    mapId: 7,
    themeId: 7,
    mapRules: mapRules(
      33,
      34,
      5,
      1,
      BONUS_TRIGGER.exactLines,
      3,
      1,
      300,
      100,
      0,
      20,
      128,
      5,
    ),
    levels: [
      [22, 15, 3],
      [30, 18, 3, bb(1, 8)],
      [39, 21, 4, bb(1, 10)],
      [49, 24, 4, cm(7)],
      [61, 27, 4, bb(2, 10)],
      [75, 29, 5, bb(3, 9), cm(10)],
      [91, 31, 5, bb(1, 12), cm(12)],
      [109, 33, 6, bb(2, 12), cm(14)],
      [129, 36, 6, bb(4, 9), cm(16)],
      [152, 39, 7, bb(4, 12), cm(18)],
    ],
  },
  {
    mapId: 8,
    themeId: 8,
    mapRules: mapRules(
      35,
      36,
      8,
      2,
      BONUS_TRIGGER.perfectClear,
      0,
      2,
      100,
      200,
      0,
      0,
      128,
      6,
    ),
    levels: [
      [24, 16, 4],
      [33, 19, 4, bb(2, 8)],
      [43, 22, 4, cm(8)],
      [54, 25, 5, cm(10)],
      [67, 28, 5, bb(3, 9)],
      [82, 31, 5, bb(1, 10), cm(12)],
      [99, 34, 6, bb(2, 11), cm(14)],
      [118, 37, 6, bb(3, 10), cm(16)],
      [139, 40, 7, bb(4, 9), cm(19)],
      [163, 43, 7, bb(4, 11), cm(22)],
    ],
  },
  {
    mapId: 9,
    themeId: 9,
    mapRules: mapRules(
      37,
      38,
      9,
      2,
      BONUS_TRIGGER.comboMeterBoundary,
      8,
      1,
      100,
      200,
      2,
      0,
      128,
      6,
    ),
    levels: [
      [28, 15, 4],
      [38, 18, 4, cm(8)],
      [49, 21, 5, cm(10)],
      [61, 24, 5, bb(2, 9)],
      [75, 27, 5, cm(12)],
      [91, 30, 6, cm(14), bb(3, 9)],
      [109, 33, 6, cm(16), bb(2, 11)],
      [129, 36, 7, cm(18), bb(3, 11)],
      [151, 39, 7, cm(22), bb(4, 10)],
      [176, 42, 7, cm(26), bb(4, 12)],
    ],
  },
  {
    mapId: 10,
    themeId: 10,
    mapRules: mapRules(
      39,
      40,
      10,
      1,
      BONUS_TRIGGER.exactLines,
      4,
      1,
      250,
      250,
      0,
      30,
      129,
      7,
    ),
    levels: [
      [32, 15, 5],
      [44, 18, 5, cl(3, 1)],
      [58, 21, 6, cl(3, 2)],
      [73, 24, 6, bb(3, 8)],
      [90, 27, 6, cl(4, 1)],
      [110, 30, 7, cl(4, 2), bb(4, 8)],
      [132, 33, 7, cl(4, 2), bb(3, 10)],
      [156, 36, 7, cl(5, 1), bb(4, 10)],
      [183, 39, 7, cl(5, 2), bb(3, 12)],
      [214, 42, 7, cl(5, 2), bb(4, 12)],
    ],
  },
];

export function canonicalCampaignMap(
  contentVersion: number,
  mapId: number,
): CampaignMapPublication {
  assertU32(contentVersion, "contentVersion");
  if (contentVersion !== CAMPAIGN_CONTENT_VERSION) {
    throw new Error(
      `canonical Campaign release is bound to content version ${CAMPAIGN_CONTENT_VERSION}`,
    );
  }
  const authored = CAMPAIGN_V2_MAPS[mapId - 1];
  if (!authored || authored.mapId !== mapId) {
    throw new Error(
      `mapId must be between 1 and ${CANONICAL_CAMPAIGN_MAP_COUNT}`,
    );
  }
  if (authored.levels.length !== 10)
    throw new Error(`map ${mapId} must contain ten levels`);
  return {
    mapId,
    themeId: authored.themeId,
    enabled: true,
    mapRules: { ...authored.mapRules },
    levels: authored.levels.map((tuple, index) => level(index + 1, tuple)),
  };
}

function level(
  levelNumber: number,
  tuple: LevelTuple,
): CampaignLevelPublication {
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

function publicationConstraint(
  tuple?: ConstraintTuple,
): CampaignConstraintPublication {
  if (!tuple) return { ...EMPTY };
  return { kind: tuple[0], value: tuple[1], requiredCount: tuple[2] };
}

function assertU32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 0xffff_ffff) {
    throw new Error(`${label} must be a positive u32`);
  }
}
