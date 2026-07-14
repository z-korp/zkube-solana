export const DAILY_SCORING_RULE_CAPACITY = 16;
export const DAILY_SCORING_RULE_COUNT = 14;
export const CANONICAL_DAILY_SEASON_SEED = [
  122, 107, 117, 98, 101, 45, 100, 97, 105, 108, 121, 45, 115, 101, 97, 115,
  111, 110, 45, 49, 45, 112, 117, 98, 108, 105, 99, 45, 115, 101, 101, 100,
] as const;

export const DAILY_SCORE_CLASSIC = 0;
export const DAILY_SCORE_COMBO = 1;
export const DAILY_SCORE_EXACT_LINES = 2;
export const DAILY_SCORE_TOTAL_LINES = 3;
export const DAILY_SCORE_BLOCKS = 4;
export const DAILY_SCORE_CLUTCH = 5;
export const DAILY_SCORE_CLEAN = 6;
export const DAILY_SCORE_SURVIVAL = 7;

export interface DailyScoringRuleView {
  id: number;
  family: number;
  kind: number;
  parameter: number;
}

export type DailyPressureThresholds = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type DailyPressureMultipliers = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type DailyBlockWeights = [number, number, number, number, number];

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
}

export interface RawDailyPressureProfile {
  thresholds: readonly unknown[];
  scoreMultipliersX100: readonly unknown[];
  blockWeights: readonly (readonly unknown[])[];
  startingHeight: unknown;
  maxMoves: unknown;
}

export const CANONICAL_DAILY_SCORING_RULES: readonly DailyScoringRuleView[] = [
  { id: 1, family: 0, kind: DAILY_SCORE_CLASSIC, parameter: 0 },
  { id: 2, family: 1, kind: DAILY_SCORE_COMBO, parameter: 2 },
  { id: 3, family: 1, kind: DAILY_SCORE_COMBO, parameter: 3 },
  { id: 4, family: 2, kind: DAILY_SCORE_EXACT_LINES, parameter: 1 },
  { id: 5, family: 2, kind: DAILY_SCORE_TOTAL_LINES, parameter: 0 },
  { id: 6, family: 3, kind: DAILY_SCORE_BLOCKS, parameter: 1 },
  { id: 7, family: 3, kind: DAILY_SCORE_BLOCKS, parameter: 2 },
  { id: 8, family: 3, kind: DAILY_SCORE_BLOCKS, parameter: 3 },
  { id: 9, family: 3, kind: DAILY_SCORE_BLOCKS, parameter: 4 },
  { id: 10, family: 4, kind: DAILY_SCORE_CLUTCH, parameter: 6 },
  { id: 11, family: 4, kind: DAILY_SCORE_CLUTCH, parameter: 7 },
  { id: 12, family: 5, kind: DAILY_SCORE_CLEAN, parameter: 2 },
  { id: 13, family: 5, kind: DAILY_SCORE_CLEAN, parameter: 3 },
  { id: 14, family: 6, kind: DAILY_SCORE_SURVIVAL, parameter: 0 },
  { id: 0, family: 0, kind: 0, parameter: 0 },
  { id: 0, family: 0, kind: 0, parameter: 0 },
] as const;

export const CANONICAL_DAILY_PRESSURE: DailyPressureProfileView = {
  thresholds: [15, 40, 80, 150, 280, 500, 900],
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
  maxMoves: 180,
};

export function mapDailyScoringRule(
  rule: RawDailyScoringRule,
): DailyScoringRuleView {
  return {
    id: Number(rule.id),
    family: Number(rule.family),
    kind: Number(rule.kind),
    parameter: Number(rule.parameter),
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
      return "Single-Line Precision";
    case DAILY_SCORE_TOTAL_LINES:
      return "Line Rush";
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
      return "Featured score equals the engine score.";
    case DAILY_SCORE_COMBO:
      return `Only clears of ${rule.parameter} or more lines score; bigger combos are worth increasingly more.`;
    case DAILY_SCORE_EXACT_LINES:
      return "Only moves that clear exactly one line score.";
    case DAILY_SCORE_TOTAL_LINES:
      return "Every line cleared adds one featured point.";
    case DAILY_SCORE_BLOCKS:
      return `Each size ${rule.parameter} block destroyed by a normal move adds one featured point.`;
    case DAILY_SCORE_CLUTCH:
      return `Clear lines while the stack starts at height ${rule.parameter} or higher; bigger clears score more.`;
    case DAILY_SCORE_CLEAN:
      return `Lines score only when the board ends the move at height ${rule.parameter} or lower.`;
    case DAILY_SCORE_SURVIVAL:
      return "Every completed move scores more as the pressure tier rises.";
    default:
      return "This challenge uses an unsupported scoring rule.";
  }
}
