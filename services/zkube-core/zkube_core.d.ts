/* tslint:disable */
/* eslint-disable */

export function compareBoardEntries(left_metric: bigint, left_time: bigint, left_owner: Uint8Array, right_metric: bigint, right_time: bigint, right_owner: Uint8Array): number;

export function dailyBoardPools(pool: bigint, theme_qualified: number): Uint8Array;

export function dailyIsScheduled(day: number, suspended: number): boolean;

export function dailyPair(day: number): Uint32Array;

export function dailyWindow(day: number): BigInt64Array;

export function dayIdAt(timestamp: bigint): number;

export function nextScheduledDaily(day: number, suspended: number): number;

export function payoutPlan(pool: bigint, qualified_winners: number, entry_price: bigint, whole_unit: bigint): Uint8Array;

export function scheduledDailyWindow(day: number, suspended: number): Uint32Array;
