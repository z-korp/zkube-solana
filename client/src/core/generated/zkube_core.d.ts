/* tslint:disable */
/* eslint-disable */

export function abandonCampaignRun(config: Uint8Array, state: Uint8Array): Uint8Array;

export function applyCampaignBonus(config: Uint8Array, state: Uint8Array, row: number, column: number): Uint8Array;

export function applyDailySimulationBonus(config: Uint8Array, state: Uint8Array, action: number, row: number, column: number): Uint8Array;

export function applyDailySimulationVrf(config: Uint8Array, state: Uint8Array, request_counter: number, vrf_output: Uint8Array): Uint8Array;

export function campaignRunEarnedStars(state: Uint8Array): number;

export function campaignRunEndReason(state: Uint8Array): number;

export function dailySimulationScoreEligible(state: Uint8Array): boolean;

export function emptyContinuationRows(request_counter: number, vrf_output: Uint8Array, rules_hash: Uint8Array, weights: Uint16Array): Uint8Array;

export function finishDailySimulationAtDeadline(config: Uint8Array, state: Uint8Array): Uint8Array;

export function initialReplayCommitment(chain_domain: Uint8Array, challenge_id: Uint8Array, rules_hash: Uint8Array, raw_account: Uint8Array, run_id: bigint, mode_tag: number): Uint8Array;

export function initializeCampaignSimulation(config: Uint8Array): Uint8Array;

export function initializeDailySimulation(config: Uint8Array, request_counter: number, vrf_output: Uint8Array): Uint8Array;

export function playCampaignMove(config: Uint8Array, state: Uint8Array, expected_move: number, row: number, start: number, destination: number): Uint8Array;

export function playDailySimulationMove(config: Uint8Array, state: Uint8Array, action: number, expected_move: number, row: number, start: number, destination: number): Uint8Array;

export function qualifiedPlayerId(chain_domain: Uint8Array, raw_account: Uint8Array): Uint8Array;

export function weeklyMetricTags(week_id: number, rules_hash: Uint8Array): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly qualifiedPlayerId: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly initialReplayCommitment: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: bigint, j: number) => [number, number, number, number];
    readonly weeklyMetricTags: (a: number, b: number, c: number) => [number, number, number, number];
    readonly emptyContinuationRows: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly initializeDailySimulation: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly applyDailySimulationVrf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly playDailySimulationMove: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number, number];
    readonly applyDailySimulationBonus: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly finishDailySimulationAtDeadline: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly dailySimulationScoreEligible: (a: number, b: number) => [number, number, number];
    readonly initializeCampaignSimulation: (a: number, b: number) => [number, number, number, number];
    readonly playCampaignMove: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly applyCampaignBonus: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly abandonCampaignRun: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly campaignRunEarnedStars: (a: number, b: number) => [number, number, number];
    readonly campaignRunEndReason: (a: number, b: number) => [number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
