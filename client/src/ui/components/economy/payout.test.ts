// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  DAILY_WEIGHTS,
  SEASON_WEIGHTS,
  WEEKLY_WEIGHTS,
  computePayouts,
} from "./payout";

const SOL = 1_000_000_000n;
const FLOOR_UNIT = 1_000_000n;

function sum(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

describe("computePayouts", () => {
  it("splits a clean full field exactly by weight", () => {
    expect(computePayouts(SOL, DAILY_WEIGHTS)).toEqual([
      450_000_000n,
      250_000_000n,
      150_000_000n,
      100_000_000n,
      50_000_000n,
    ]);
    expect(computePayouts(SOL, WEEKLY_WEIGHTS)).toEqual([
      600_000_000n,
      250_000_000n,
      150_000_000n,
    ]);
    // Season uses the same ladder as Daily.
    expect(computePayouts(SOL, SEASON_WEIGHTS)).toEqual(
      computePayouts(SOL, DAILY_WEIGHTS),
    );
  });

  it("returns one entry per weight, indexed by rank", () => {
    expect(computePayouts(SOL, DAILY_WEIGHTS)).toHaveLength(
      DAILY_WEIGHTS.length,
    );
  });

  it("renormalizes over the top places when the field is short", () => {
    const payouts = computePayouts(SOL, DAILY_WEIGHTS, 2);
    // 45/70 and 25/70 of the pot, each floored to 0.001 SOL.
    expect(payouts).toEqual([
      642_000_000n,
      357_000_000n,
      0n,
      0n,
      0n,
    ]);
    // The whole pot (minus rolled-forward dust) goes to the two real places.
    expect(sum(payouts)).toBeLessThanOrEqual(SOL);
    expect(SOL - sum(payouts)).toBeLessThan(FLOOR_UNIT * BigInt(2));
  });

  it("treats occupied >= field, undefined, and 0 correctly", () => {
    expect(computePayouts(SOL, WEEKLY_WEIGHTS, 9)).toEqual(
      computePayouts(SOL, WEEKLY_WEIGHTS),
    );
    expect(computePayouts(SOL, WEEKLY_WEIGHTS, undefined)).toEqual(
      computePayouts(SOL, WEEKLY_WEIGHTS),
    );
    expect(computePayouts(SOL, WEEKLY_WEIGHTS, 0)).toEqual([0n, 0n, 0n]);
  });

  it("floors tiny pots (and non-positive pots) down to zero", () => {
    // 0.0005 SOL: every share is below the 0.001 SOL floor.
    expect(computePayouts(500_000n, DAILY_WEIGHTS)).toEqual([
      0n,
      0n,
      0n,
      0n,
      0n,
    ]);
    expect(computePayouts(0n, DAILY_WEIGHTS)).toEqual([0n, 0n, 0n, 0n, 0n]);
    expect(computePayouts(-SOL, DAILY_WEIGHTS)).toEqual([0n, 0n, 0n, 0n, 0n]);
  });

  it("conserves value: payouts + dust equal the pot, all on the transfer unit", () => {
    const pot = 1_000_000_007n; // 1 SOL + 7 lamports of dust
    const payouts = computePayouts(pot, DAILY_WEIGHTS);
    const paid = sum(payouts);

    // Nothing is minted and nothing is lost: paid <= pot, dust is the rest.
    expect(paid).toBeLessThanOrEqual(pot);
    const dust = pot - paid;
    expect(dust).toBe(7n);

    // Every payout lands exactly on the 0.001 SOL transfer unit.
    for (const payout of payouts) {
      expect(payout % FLOOR_UNIT).toBe(0n);
    }
  });

  it("never mints value on an awkward renormalized pot", () => {
    const pot = 987_654_321n;
    const payouts = computePayouts(pot, SEASON_WEIGHTS, 3);
    expect(payouts[3]).toBe(0n);
    expect(payouts[4]).toBe(0n);
    expect(sum(payouts)).toBeLessThanOrEqual(pot);
    for (const payout of payouts) {
      expect(payout % FLOOR_UNIT).toBe(0n);
    }
  });
});
