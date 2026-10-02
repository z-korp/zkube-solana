// The generated Node target is freshness-checked against the Rust source.
// Protocol consumers decode only this
// generated boundary rather than carrying TypeScript rule mirrors.
import {
  initSync, dayIdAt, preparableDaily,
  dailyWindow as encodedDailyWindow,
  compareBoardEntries as wasmCompareBoardEntries,
} from "../zkube-core/zkube_core.js";
import module from "./zkubeCoreWasm.js";

// One binding serves Node and the Worker; only the module's source differs.
initSync({ module });
export { dayIdAt, preparableDaily };

export function dailyWindow(day: number) {
  const values = encodedDailyWindow(day);
  if (values.length !== 3) throw new Error("invalid Daily window encoding");
  return { opensAt: Number(values[0]), runsCloseAt: Number(values[1]), recoveryDeadlineAt: Number(values[2]) };
}
export function compareBoardEntries(leftMetric: bigint, leftTime: number, leftOwner: Uint8Array,
  rightMetric: bigint, rightTime: number, rightOwner: Uint8Array): number {
  return wasmCompareBoardEntries(leftMetric, BigInt(leftTime), leftOwner, rightMetric, BigInt(rightTime), rightOwner);
}
