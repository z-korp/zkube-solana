// The generated Node target and browser package come from the same Rust source
// and are freshness-checked together. Protocol consumers decode only this
// generated boundary rather than carrying TypeScript rule mirrors.
import {
  applyRunBonus,
  applyRunVrf,
  boardWidth as encodedBoardWidth,
  dailyBoardPools as encodedDailyBoardPools,
  dailyPairIndex as wasmDailyPairIndex,
  finishRun,
  initializeRun,
  payoutForRank as wasmPayoutForRank,
  payoutPlan as encodedPayoutPlan,
  playRunMove,
  requestRunReroll,
  runEndReason,
  runLatchedStarSources,
  runScoreEligible,
} from "../zkube-core/zkube_core.js";

export {
  applyRunBonus,
  applyRunVrf,
  finishRun,
  initializeRun,
  playRunMove,
  requestRunReroll,
  runEndReason,
  runLatchedStarSources,
  runScoreEligible,
};

export interface CorePayoutPlan {
  payouts: readonly bigint[];
  winnerCount: number;
  widthWinnerCount: number;
  denominator: bigint;
  capacityLimited: boolean;
  paidLamports: bigint;
  rolloverLamports: bigint;
}

export const dailyPairIndex = (dayId: number): number => wasmDailyPairIndex(dayId);

export function dailyBoardPools(
  poolLamports: bigint,
  themeQualifiedPlayers: number,
): { score: bigint; theme: bigint } {
  const bytes = encodedDailyBoardPools(poolLamports, themeQualifiedPlayers);
  requireLength(bytes, 16, "Daily board pools");
  return { score: u64(bytes, 0), theme: u64(bytes, 8) };
}

export function boardWidth(
  poolLamports: bigint,
  qualifiedPlayers: number,
  entryPriceLamports: bigint,
  wholeUnitLamports: bigint,
): { winnerCount: number; denominator: bigint } {
  const bytes = encodedBoardWidth(
    poolLamports,
    qualifiedPlayers,
    entryPriceLamports,
    wholeUnitLamports,
  );
  requireLength(bytes, 20, "board width");
  return { winnerCount: u32(bytes, 0), denominator: u128(bytes, 4) };
}

export function payoutPlan(
  poolLamports: bigint,
  qualifiedPlayers: number,
  capacity: number,
  entryPriceLamports: bigint,
  wholeUnitLamports: bigint,
): CorePayoutPlan {
  const bytes = encodedPayoutPlan(
    poolLamports,
    qualifiedPlayers,
    capacity,
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

export function payoutForRank(
  poolLamports: bigint,
  denominator: bigint,
  rank: number,
  wholeUnitLamports: bigint,
): bigint {
  return wasmPayoutForRank(
    poolLamports,
    u128Bytes(denominator),
    rank,
    wholeUnitLamports,
  );
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

function u128Bytes(value: bigint): Uint8Array {
  if (value < 0n || value > (1n << 128n) - 1n) {
    throw new Error("payout denominator is outside u128");
  }
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, value & ((1n << 64n) - 1n), true);
  view.setBigUint64(8, value >> 64n, true);
  return bytes;
}

function requireLength(bytes: Uint8Array, length: number, label: string): void {
  if (bytes.length !== length) throw new Error(`${label} encoding is invalid`);
}
