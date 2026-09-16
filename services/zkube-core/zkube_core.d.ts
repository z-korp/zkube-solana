/* tslint:disable */
/* eslint-disable */

export function compareBoardEntries(left_metric: bigint, left_time: bigint, left_owner: Uint8Array, right_metric: bigint, right_time: bigint, right_owner: Uint8Array): number;

export function dailyWindow(day: number): BigInt64Array;

export function dayIdAt(timestamp: bigint): number;

export function nextScheduledDaily(day: number, suspended: number): number;

export function scheduledDailyWindow(day: number, suspended: number): Uint32Array;
