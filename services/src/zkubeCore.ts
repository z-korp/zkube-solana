// The generated Node target is freshness-checked against the Rust source.
// Protocol consumers decode only this
// generated boundary rather than carrying TypeScript rule mirrors.
import {
  dayIdAt, nextScheduledDaily,
  dailyWindow as encodedDailyWindow,
  scheduledDailyWindow as encodedScheduledDailyWindow, compareBoardEntries as wasmCompareBoardEntries,
} from "../zkube-core/zkube_core.js";
export { dayIdAt, nextScheduledDaily };

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
export function compareBoardEntries(leftMetric: bigint, leftTime: number, leftOwner: Uint8Array,
  rightMetric: bigint, rightTime: number, rightOwner: Uint8Array): number {
  return wasmCompareBoardEntries(leftMetric, BigInt(leftTime), leftOwner, rightMetric, BigInt(rightTime), rightOwner);
}
