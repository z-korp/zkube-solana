/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const dayIdAt: (a: bigint) => [number, number, number];
export const dailyWindow: (a: number) => [number, number];
export const dailyIsScheduled: (a: number, b: number) => number;
export const scheduledDailyWindow: (a: number, b: number) => [number, number, number, number];
export const nextScheduledDaily: (a: number, b: number) => [number, number, number];
export const dailyPair: (a: number) => [number, number];
export const compareBoardEntries: (a: bigint, b: bigint, c: number, d: number, e: bigint, f: bigint, g: number, h: number) => [number, number, number];
export const dailyBoardPools: (a: bigint, b: number) => [number, number];
export const payoutPlan: (a: bigint, b: number, c: bigint, d: bigint) => [number, number, number, number];
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
