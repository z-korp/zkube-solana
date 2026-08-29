import {
  DAILY_MAX_MOVES,
  DAILY_PRESSURE_BLOCK_WEIGHTS,
  DAILY_PRESSURE_SCORE_MULTIPLIERS_X100,
  DAILY_PRESSURE_THRESHOLDS,
} from "./protocolVersions.generated";
import {
  DAILY_PAIR_COUNT,
  DAILY_PAIR_SELECTION_SEED,
  DAILY_THEMES,
} from "./dailyRules.generated";

const DAILY_PAIR_DRAW_DOMAIN = new TextEncoder().encode(
  "zkube-daily-pair-draw-v1",
);
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

export async function dailyContentSelection(
  dayId: number,
): Promise<{
  pairIndex: number;
  realmMapId: number;
  objective: DailyThemeView;
}> {
  assertDayId(dayId);
  const permutation = Array.from(
    { length: DAILY_PAIR_COUNT },
    (_, index) => index,
  );
  const cycleIndex = Math.floor(dayId / DAILY_PAIR_COUNT);
  for (let index = DAILY_PAIR_COUNT - 1; index > 0; index -= 1) {
    const swap = Number(
      (await pairHashU64(cycleIndex, index)) % BigInt(index + 1),
    );
    [permutation[index], permutation[swap]] = [
      permutation[swap]!,
      permutation[index]!,
    ];
  }
  const pairIndex = permutation[dayId % DAILY_PAIR_COUNT]!;
  return {
    pairIndex,
    realmMapId: Math.floor(pairIndex / DAILY_OBJECTIVE_COUNT) + 1,
    objective: DAILY_THEMES[pairIndex % DAILY_OBJECTIVE_COUNT]!,
  };
}

async function pairHashU64(cycleIndex: number, index: number): Promise<bigint> {
  const input = new Uint8Array(DAILY_PAIR_DRAW_DOMAIN.length + 32 + 4 + 1);
  let offset = 0;
  for (const bytes of [
    DAILY_PAIR_DRAW_DOMAIN,
    Uint8Array.from(DAILY_PAIR_SELECTION_SEED),
  ]) {
    input.set(bytes, offset);
    offset += bytes.length;
  }
  new DataView(input.buffer).setUint32(offset, cycleIndex, true);
  offset += 4;
  input[offset] = index;
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", input),
  );
  return new DataView(digest.buffer).getBigUint64(0, true);
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
  maxMoves: number;
}

export interface RawDailyPressureProfile {
  thresholds: readonly unknown[];
  scoreMultipliersX100: readonly unknown[];
  blockWeights: readonly (readonly unknown[])[];
  maxMoves: unknown;
}

export const CANONICAL_DAILY_PRESSURE: DailyPressureProfileView = {
  thresholds: [...DAILY_PRESSURE_THRESHOLDS],
  scoreMultipliersX100: [...DAILY_PRESSURE_SCORE_MULTIPLIERS_X100],
  blockWeights: DAILY_PRESSURE_BLOCK_WEIGHTS.map((weights) => [
    ...weights,
  ]) as DailyPressureProfileView["blockWeights"],
  maxMoves: DAILY_MAX_MOVES,
};

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
