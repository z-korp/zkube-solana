// The generated Node target is freshness-checked against the Rust source.
// Protocol consumers decode only this
// generated boundary rather than carrying TypeScript rule mirrors.
import {
  dailyBoardPools as encodedDailyBoardPools,
  payoutPlan as encodedPayoutPlan,
  dayIdAt, dailyIsScheduled, nextScheduledDaily,
  dailyWindow as encodedDailyWindow, dailyPair as encodedDailyPair,
  scheduledDailyWindow as encodedScheduledDailyWindow, compareBoardEntries as wasmCompareBoardEntries,
} from "../zkube-core/zkube_core.js";
export { dayIdAt, dailyIsScheduled, nextScheduledDaily };

export interface CorePayoutPlan {
  payouts: readonly bigint[];
  winnerCount: number;
  widthWinnerCount: number;
  denominator: bigint;
  capacityLimited: boolean;
  paidLamports: bigint;
  rolloverLamports: bigint;
}


export function dailyBoardPools(
  poolLamports: bigint,
  themeQualifiedPlayers: number,
): { score: bigint; theme: bigint } {
  const bytes = encodedDailyBoardPools(poolLamports, themeQualifiedPlayers);
  requireLength(bytes, 16, "Daily board pools");
  return { score: u64(bytes, 0), theme: u64(bytes, 8) };
}


export function payoutPlan(
  poolLamports: bigint,
  qualifiedPlayers: number,
  entryPriceLamports: bigint,
  wholeUnitLamports: bigint,
): CorePayoutPlan {
  const bytes = encodedPayoutPlan(
    poolLamports,
    qualifiedPlayers,
    entryPriceLamports,
    wholeUnitLamports,
  );
  if (bytes.length < 41 || (bytes.length - 41) % 8 !== 0) {
    throw new Error("core returned a malformed payout plan");
  }
  const winnerCount = u32(bytes, 0);
  const payouts = Array.from({ length: (bytes.length - 41) / 8 }, (_, index) =>
    u64(bytes, 41 + index * 8));
  if (payouts.length !== winnerCount) {
    throw new Error("core payout count does not match its encoded plan");
  }
  return {
    payouts,
    winnerCount,
    widthWinnerCount: u32(bytes, 4),
    denominator: u128(bytes, 8),
    capacityLimited: bytes[24] === 1,
    paidLamports: u64(bytes, 25),
    rolloverLamports: u64(bytes, 33),
  };
}


function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(offset, true);
}

function u64(bytes: Uint8Array, offset: number): bigint {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getBigUint64(offset, true);
}

function u128(bytes: Uint8Array, offset: number): bigint {
  return u64(bytes, offset) | (u64(bytes, offset + 8) << 64n);
}


function requireLength(bytes: Uint8Array, length: number, label: string): void {
  if (bytes.length !== length) throw new Error(`${label} encoding is invalid`);
}

export function dailyWindow(day: number) {
  const values = encodedDailyWindow(day);
  if (values.length !== 3) throw new Error("invalid Daily window encoding");
  return { opensAt: Number(values[0]), runsCloseAt: Number(values[1]), recoveryDeadlineAt: Number(values[2]) };
}
export function scheduledDailyWindow(day: number, suspended: number) {
  const values = encodedScheduledDailyWindow(day, suspended);
  if (values.length !== 2) throw new Error("invalid scheduled window encoding");
  return { first: values[0]!, following: values[1]! };
}
export function dailyPair(day: number) {
  const values = encodedDailyPair(day);
  if (values.length !== 4) throw new Error("invalid Daily pair encoding");
  return { pairIndex: values[0]!, realmMapId: values[1]!, objective: { kind: values[2]!, value: values[3]! } };
}
export function compareBoardEntries(leftMetric: bigint, leftTime: number, leftOwner: Uint8Array,
  rightMetric: bigint, rightTime: number, rightOwner: Uint8Array): number {
  return wasmCompareBoardEntries(leftMetric, BigInt(leftTime), leftOwner, rightMetric, BigInt(rightTime), rightOwner);
}
