import {
  DAILY_MAX_MOVES,
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

export function currentDailyDayId(
  nowUnix = Math.floor(Date.now() / 1_000),
): number {
  return Math.max(0, Math.floor(nowUnix / 86_400));
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

export interface DailyPressureProfileView {
  maxMoves: number;
}

export interface RawDailyPressureProfile {
  maxMoves: unknown;
}

export const CANONICAL_DAILY_PRESSURE: DailyPressureProfileView = {
  maxMoves: DAILY_MAX_MOVES,
};

export function mapDailyPressureProfile(
  pressure: RawDailyPressureProfile,
): DailyPressureProfileView {
  return {
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
