export const DAILY_SCORING_RULE_COUNT = 15;
export const CANONICAL_DAILY_SEASON_SEED = [
  122, 107, 117, 98, 101, 45, 100, 97, 105, 108, 121, 45, 115, 101, 97, 115,
  111, 110, 45, 49, 45, 112, 117, 98, 108, 105, 99, 45, 115, 101, 101, 100,
] as const;

const DAILY_SCORE_CLASSIC = 0;
const DAILY_SCORE_COMBO = 1;
const DAILY_SCORE_EXACT_LINES = 2;
const DAILY_SCORE_BLOCKS = 4;
const DAILY_SCORE_CLUTCH = 5;
const DAILY_SCORE_CLEAN = 6;
const DAILY_SCORE_SURVIVAL = 7;

export interface DailyScoringRuleView {
  id: number;
  family: number;
  kind: number;
  parameter: number;
  bonusMultiplierX100: number;
}

type DailyPressureThresholds = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
type DailyPressureMultipliers = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
type DailyBlockWeights = [number, number, number, number, number];

export interface DailyPressureProfileView {
  thresholds: DailyPressureThresholds;
  scoreMultipliersX100: DailyPressureMultipliers;
  blockWeights: [
    DailyBlockWeights,
    DailyBlockWeights,
    DailyBlockWeights,
    DailyBlockWeights,
    DailyBlockWeights,
    DailyBlockWeights,
    DailyBlockWeights,
    DailyBlockWeights,
  ];
  startingHeight: number;
  maxMoves: number;
}

export interface RawDailyScoringRule {
  id: unknown;
  family: unknown;
  kind: unknown;
  parameter: unknown;
  bonusMultiplierX100: unknown;
}

export interface RawDailyPressureProfile {
  thresholds: readonly unknown[];
  scoreMultipliersX100: readonly unknown[];
  blockWeights: readonly (readonly unknown[])[];
  startingHeight: unknown;
  maxMoves: unknown;
}

export const CANONICAL_DAILY_SCORING_RULES: readonly DailyScoringRuleView[] = [
  {
    id: 1,
    family: 0,
    kind: DAILY_SCORE_CLASSIC,
    parameter: 0,
    bonusMultiplierX100: 0,
  },
  {
    id: 2,
    family: 1,
    kind: DAILY_SCORE_COMBO,
    parameter: 2,
    bonusMultiplierX100: 200,
  },
  {
    id: 3,
    family: 1,
    kind: DAILY_SCORE_COMBO,
    parameter: 3,
    bonusMultiplierX100: 1_250,
  },
  {
    id: 4,
    family: 2,
    kind: DAILY_SCORE_EXACT_LINES,
    parameter: 1,
    bonusMultiplierX100: 100,
  },
  {
    id: 5,
    family: 2,
    kind: DAILY_SCORE_EXACT_LINES,
    parameter: 2,
    bonusMultiplierX100: 250,
  },
  {
    id: 6,
    family: 2,
    kind: DAILY_SCORE_EXACT_LINES,
    parameter: 3,
    bonusMultiplierX100: 1_250,
  },
  {
    id: 7,
    family: 3,
    kind: DAILY_SCORE_BLOCKS,
    parameter: 1,
    bonusMultiplierX100: 50,
  },
  {
    id: 8,
    family: 3,
    kind: DAILY_SCORE_BLOCKS,
    parameter: 2,
    bonusMultiplierX100: 125,
  },
  {
    id: 9,
    family: 3,
    kind: DAILY_SCORE_BLOCKS,
    parameter: 3,
    bonusMultiplierX100: 140,
  },
  {
    id: 10,
    family: 3,
    kind: DAILY_SCORE_BLOCKS,
    parameter: 4,
    bonusMultiplierX100: 200,
  },
  {
    id: 11,
    family: 4,
    kind: DAILY_SCORE_CLUTCH,
    parameter: 6,
    bonusMultiplierX100: 200,
  },
  {
    id: 12,
    family: 4,
    kind: DAILY_SCORE_CLUTCH,
    parameter: 7,
    bonusMultiplierX100: 270,
  },
  {
    id: 13,
    family: 5,
    kind: DAILY_SCORE_CLEAN,
    parameter: 2,
    bonusMultiplierX100: 450,
  },
  {
    id: 14,
    family: 5,
    kind: DAILY_SCORE_CLEAN,
    parameter: 3,
    bonusMultiplierX100: 250,
  },
  {
    id: 15,
    family: 6,
    kind: DAILY_SCORE_SURVIVAL,
    parameter: 0,
    bonusMultiplierX100: 100,
  },
  { id: 0, family: 0, kind: 0, parameter: 0, bonusMultiplierX100: 0 },
] as const;

export const CANONICAL_DAILY_PRESSURE: DailyPressureProfileView = {
  thresholds: [8, 18, 30, 42, 54, 66, 78],
  scoreMultipliersX100: [100, 110, 125, 140, 160, 180, 210, 250],
  blockWeights: [
    [25, 30, 25, 15, 5],
    [22, 28, 25, 18, 7],
    [20, 25, 25, 20, 10],
    [18, 22, 24, 22, 14],
    [16, 20, 22, 24, 18],
    [14, 18, 20, 26, 22],
    [12, 16, 18, 28, 26],
    [10, 14, 16, 30, 30],
  ],
  startingHeight: 4,
  maxMoves: 100,
};

export function mapDailyScoringRule(
  rule: RawDailyScoringRule,
): DailyScoringRuleView {
  return {
    id: Number(rule.id),
    family: Number(rule.family),
    kind: Number(rule.kind),
    parameter: Number(rule.parameter),
    bonusMultiplierX100: Number(rule.bonusMultiplierX100),
  };
}

export function mapDailyPressureProfile(
  pressure: RawDailyPressureProfile,
): DailyPressureProfileView {
  if (pressure.thresholds.length !== 7) {
    throw new Error("Decoded Daily pressure must contain exactly 7 thresholds");
  }
  if (
    pressure.scoreMultipliersX100.length !== 8 ||
    pressure.blockWeights.length !== 8
  ) {
    throw new Error("Decoded Daily pressure must contain exactly 8 tiers");
  }
  const blockWeights = pressure.blockWeights.map((weights) => {
    if (weights.length !== 5) {
      throw new Error(
        "Decoded Daily pressure tier must contain exactly 5 block weights",
      );
    }
    return weights.map(Number) as DailyBlockWeights;
  }) as DailyPressureProfileView["blockWeights"];
  return {
    thresholds: pressure.thresholds.map(Number) as DailyPressureThresholds,
    scoreMultipliersX100: pressure.scoreMultipliersX100.map(
      Number,
    ) as DailyPressureMultipliers,
    blockWeights,
    startingHeight: Number(pressure.startingHeight),
    maxMoves: Number(pressure.maxMoves),
  };
}

export function dailyScoringRuleName(
  rule: DailyScoringRuleView | null | undefined,
): string {
  if (!rule) return "Unknown Daily Rule";
  switch (rule.kind) {
    case DAILY_SCORE_CLASSIC:
      return "Classic Score";
    case DAILY_SCORE_COMBO:
      return `${rule.parameter}+ Line Combos`;
    case DAILY_SCORE_EXACT_LINES:
      return `Exact ${rule.parameter} Precision`;
    case DAILY_SCORE_BLOCKS:
      return `Size ${rule.parameter} Hunter`;
    case DAILY_SCORE_CLUTCH:
      return `Clutch at Height ${rule.parameter}`;
    case DAILY_SCORE_CLEAN:
      return `Clean Clears at Height ${rule.parameter}`;
    case DAILY_SCORE_SURVIVAL:
      return "Pressure Survival";
    default:
      return "Unknown Daily Rule";
  }
}

export function dailyScoringRuleDescription(
  rule: DailyScoringRuleView | null | undefined,
): string {
  if (!rule) return "This challenge uses an unsupported scoring rule.";
  switch (rule.kind) {
    case DAILY_SCORE_CLASSIC:
      return "Every normal engine point counts toward the Daily score.";
    case DAILY_SCORE_COMBO:
      return `Normal score always counts. Clears of ${rule.parameter}+ lines earn an amplified challenge bonus before pressure.`;
    case DAILY_SCORE_EXACT_LINES:
      return `Normal score always counts. Clearing exactly ${rule.parameter} ${rule.parameter === 1 ? "line" : "lines"} repeats that clear's raw value as a challenge bonus.`;
    case DAILY_SCORE_BLOCKS:
      return `Normal score always counts. Each size-${rule.parameter} block destroyed adds a weighted challenge bonus before pressure.`;
    case DAILY_SCORE_CLUTCH:
      return `Start at height ${rule.parameter}+ and clear lines to repeat the clear's raw value as a challenge bonus.`;
    case DAILY_SCORE_CLEAN:
      return `End at height ${rule.parameter} or lower after a clear to repeat its raw value as a challenge bonus.`;
    case DAILY_SCORE_SURVIVAL:
      return "Every completed move earns a challenge bonus, amplified by the current pressure tier.";
    default:
      return "This challenge uses an unsupported scoring rule.";
  }
}

export function dailyScoringRuleStatus(
  rule: DailyScoringRuleView | null | undefined,
  occupiedHeight: number,
): string {
  if (!rule) return "Objective unavailable";
  switch (rule.kind) {
    case DAILY_SCORE_CLASSIC:
      return "Every engine point counts";
    case DAILY_SCORE_COMBO:
      return `Qualify by clearing ${rule.parameter}+ lines`;
    case DAILY_SCORE_EXACT_LINES:
      return `Qualify by clearing exactly ${rule.parameter}`;
    case DAILY_SCORE_BLOCKS:
      return `Destroy size-${rule.parameter} blocks`;
    case DAILY_SCORE_CLUTCH:
      return occupiedHeight >= rule.parameter
        ? `ARMED at height ${occupiedHeight}`
        : `Build to height ${rule.parameter} · now ${occupiedHeight}`;
    case DAILY_SCORE_CLEAN:
      return occupiedHeight <= rule.parameter
        ? `CLEAN at height ${occupiedHeight}`
        : `Clear down to height ${rule.parameter} · now ${occupiedHeight}`;
    case DAILY_SCORE_SURVIVAL:
      return "Every completed move qualifies";
    default:
      return "Unsupported objective";
  }
}
