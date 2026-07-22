/**
 * Prize-ladder payout math for the Arcade economy. Pure bigint arithmetic so
 * there is no float drift: pots are split by integer weights, then every share
 * is floored to the 0.001 SOL on-chain transfer unit. Dust below that unit is
 * not returned here — on chain it rolls forward to the next competition.
 *
 * These weights mirror the settlement split enforced on chain:
 *   Daily / Season pay 45/25/15/10/5; each Weekly skill board pays 60/25/15.
 * This module never touches money or the chain; it only mirrors the payout
 * shape for presentational components.
 */

/** English ordinal: 1 -> 1st, 2 -> 2nd, 3 -> 3rd, 4 -> 4th, 11 -> 11th, ... */
export function ordinal(rank: number): string {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

/** Daily prize weights, first through fifth place. */
export const DAILY_WEIGHTS = [45, 25, 15, 10, 5];
/** Weekly (per skill board) prize weights, first through third place. */
export const WEEKLY_WEIGHTS = [60, 25, 15];
/** Season prize weights, first through fifth place. */
export const SEASON_WEIGHTS = [45, 25, 15, 10, 5];

/** Every transfer floors to 0.001 SOL (1_000_000 lamports). */
const FLOOR_UNIT = 1_000_000n;

/**
 * Split `potLamports` across `weights` and floor each share to the 0.001 SOL
 * transfer unit. The returned array is always `weights.length` long: index `i`
 * holds the payout for rank `i + 1`.
 *
 * When `occupied` is provided and smaller than the field, the pot is
 * renormalized over just the top `occupied` weights (so a short field still
 * distributes the whole pot among the places that exist); the remaining ranks
 * return `0n`. `occupied` at or above the field size, or omitted, pays the full
 * ladder. `occupied === 0` (or a non-positive pot) pays nothing.
 *
 * Dust left by flooring is not returned; on chain it rolls forward.
 */
export function computePayouts(
  potLamports: bigint,
  weights: number[],
  occupied?: number,
): bigint[] {
  const count = weights.length;
  const result = new Array<bigint>(count).fill(0n);

  // Number of paying places: clamp to [0, count]; undefined pays the full field.
  const paying =
    occupied === undefined ? count : Math.max(0, Math.min(occupied, count));
  if (paying === 0 || potLamports <= 0n) return result;

  // Renormalize over the occupied top weights so the pot is fully allocated
  // across the places that exist.
  let totalWeight = 0n;
  for (let i = 0; i < paying; i += 1) totalWeight += BigInt(weights[i]);
  if (totalWeight <= 0n) return result;

  for (let i = 0; i < paying; i += 1) {
    const raw = (potLamports * BigInt(weights[i])) / totalWeight;
    // Floor to the transfer unit; the sub-unit remainder rolls forward.
    result[i] = (raw / FLOOR_UNIT) * FLOOR_UNIT;
  }
  return result;
}
