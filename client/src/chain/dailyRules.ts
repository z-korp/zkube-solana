import {
  DAILY_MAX_MOVES,
  DAILY_PRESSURE_SCORE_MULTIPLIERS_X100,
  PRESSURE_STEP,
  TIER_BLOCK_WEIGHTS,
} from "./protocolVersions.generated";
import {
  DAILY_PAIR_COUNT,
  DAILY_THEMES,
} from "./dailyRules.generated";

export const DAILY_OBJECTIVE_COUNT = DAILY_THEMES.length;

export interface DailyThemeView {
  kind: number;
  value: number;
}

export function dailyIsScheduled(
  dayId: number,
  suspendedUntilDay: number,
): boolean {
  assertDayId(dayId);
  assertDayId(suspendedUntilDay);
  return dayId >= suspendedUntilDay;
}

export function nextScheduledDaily(
  dayId: number,
  suspendedUntilDay: number,
): number {
  assertDayId(dayId);
  assertDayId(suspendedUntilDay);
  const candidate = Math.max(dayId + 1, suspendedUntilDay);
  assertDayId(candidate);
  return candidate;
}

export function dailyContentFromPairIndex(
  dayId: number,
  pairIndex: number,
): {
  pairIndex: number;
  realmMapId: number;
  objective: DailyThemeView;
} {
  assertDayId(dayId);
  if (!Number.isInteger(pairIndex) || pairIndex < 0 || pairIndex >= DAILY_PAIR_COUNT) {
    throw new Error("Daily pair index is outside the protocol product");
  }
  return {
    pairIndex,
    realmMapId: Math.floor(pairIndex / DAILY_OBJECTIVE_COUNT) + 1,
    objective: DAILY_THEMES[pairIndex % DAILY_OBJECTIVE_COUNT]!,
  };
}

function assertDayId(dayId: number): void {
  if (!Number.isInteger(dayId) || dayId < 0 || dayId > 0xffff_ffff) {
    throw new Error("day id is outside u32");
  }
}

type DailyPressureThresholds = [number, number, number, number, number, number, number];
type DailyPressureMultipliers = [number, number, number, number, number, number, number, number];
type DailyBlockWeights = [number, number, number, number, number];

export interface DailyPressureProfileView {
  scoreMultipliersX100: DailyPressureMultipliers;
  maxMoves: number;
}

export interface RawDailyPressureProfile {
  scoreMultipliersX100: readonly unknown[];
  maxMoves: unknown;
}

export const CANONICAL_DAILY_PRESSURE: DailyPressureProfileView = {
  scoreMultipliersX100: [...DAILY_PRESSURE_SCORE_MULTIPLIERS_X100],
  maxMoves: DAILY_MAX_MOVES,
};

export const DAILY_TIER_BLOCK_WEIGHTS = TIER_BLOCK_WEIGHTS.map(
  (weights) => [...weights] as DailyBlockWeights,
);

export function dailyPressureThresholds(): DailyPressureThresholds {
  return Array.from({ length: 7 }, (_, index) => PRESSURE_STEP * (index + 1)) as DailyPressureThresholds;
}

export function mapDailyPressureProfile(
  pressure: RawDailyPressureProfile,
): DailyPressureProfileView {
  if (pressure.scoreMultipliersX100.length !== 8) {
    throw new Error("Decoded Daily pressure must contain exactly 8 tiers");
  }
  return {
    scoreMultipliersX100: pressure.scoreMultipliersX100.map(
      Number,
    ) as DailyPressureMultipliers,
    maxMoves: Number(pressure.maxMoves),
  };
}

export function dailyThemeName(theme: DailyThemeView | null | undefined): string {
  if (!theme) return "Unknown Daily Theme";
  if (theme.kind === 0) return "Classic Score";
  if (theme.kind === 1) return `Combo ${theme.value}+`;
  if (theme.kind === 4) return `Exact ${theme.value}`;
  if (theme.kind === 2) return `Break Width ${theme.value}`;
  if (theme.kind === 6) return "Guardian Triggers";
  if (theme.kind === 7) return "Bonus Lines";
  if (theme.kind === 8) return "Bonus Breaks";
  if (theme.kind === 17) return `Clutch Clears ${theme.value}+`;
  if (theme.kind === 18) return `Clean Clears ${theme.value}`;
  return "Unknown Daily Theme";
}
