/* tslint:disable */
/* eslint-disable */

export function applyRunBonus(config: Uint8Array, state: Uint8Array, action: number, row: number, column: number): Uint8Array;

export function applyRunVrf(config: Uint8Array, state: Uint8Array, request_counter: number, vrf_output: Uint8Array): Uint8Array;

export function boardWidth(pool: bigint, qualified_winners: number, entry_price: bigint, whole_unit: bigint): Uint8Array;

export function buildRunConfig(rules_hash: Uint8Array, initial_replay: Uint8Array, max_moves: number, bonus: number, trigger: number, trigger_threshold: number, starting_height: number, tier_policy: number, fixed_tier: number, points_required: number, primary_kind: number, primary_value: number, primary_count: number, secondary_kind: number, secondary_value: number, secondary_count: number, objective_kind: number, objective_value: number): Uint8Array;

export function campaignMoveBudget(level: number, tier: number): number;

export function dailyBoardPools(pool: bigint, theme_qualified: number): Uint8Array;

export function dailyPairIndex(day_id: number): number;

export function emptyContinuationRows(request_counter: number, vrf_output: Uint8Array, rules_hash: Uint8Array, weights: Uint16Array): Uint8Array;

export function finishRun(config: Uint8Array, state: Uint8Array, reason_tag: number): Uint8Array;

export function initialReplayCommitment(chain_domain: Uint8Array, challenge_id: Uint8Array, rules_hash: Uint8Array, raw_account: Uint8Array, run_id: bigint, mode_tag: number): Uint8Array;

export function initializeRun(config: Uint8Array): Uint8Array;

export function ladderPoints(qualified_entrants: number, rank: number): number;

export function ladderTier(points: bigint): number;

export function ladderTierCount(): number;

export function ladderTierFloor(tier: number): bigint;

export function mergeCampaignStars(stored: Uint8Array, incoming: Uint8Array): Uint8Array;

export function payoutForRank(pool: bigint, denominator: Uint8Array, rank: number, whole_unit: bigint): bigint;

export function payoutPlan(pool: bigint, qualified_winners: number, capacity: number, entry_price: bigint, whole_unit: bigint): Uint8Array;

export function playRunMove(config: Uint8Array, state: Uint8Array, action: number, expected_move: number, row: number, start: number, destination: number): Uint8Array;

export function qualifiedPlayerId(chain_domain: Uint8Array, raw_account: Uint8Array): Uint8Array;

export function reconcileRunState(config: Uint8Array, phase: number, end_reason: number, bonus: number, bonus_charges: number, reroll_charges: number, combo_counter: number, max_combo: number, primary_progress: number, secondary_progress: number, latched_star_sources: number, streak: number, charges_earned: number, current_tier: number, level_lines_cleared: number, moves: number, action_counter: number, vrf_request_counter: number, pending_vrf_counter: number, score: number, daily_score: number, objective_total: bigint, pressure_score: number, grid: Uint8Array, next_row: Uint8Array, replay: Uint8Array): Uint8Array;

export function requestRunReroll(config: Uint8Array, state: Uint8Array, action: number): Uint8Array;

export function runEndReason(state: Uint8Array): number;

export function runLatchedStarSources(state: Uint8Array): number;

export function runScoreEligible(state: Uint8Array): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly qualifiedPlayerId: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly initialReplayCommitment: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: bigint, j: number) => [number, number, number, number];
    readonly emptyContinuationRows: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly ladderPoints: (a: number, b: number) => [number, number, number];
    readonly ladderTier: (a: bigint) => number;
    readonly ladderTierFloor: (a: number) => bigint;
    readonly ladderTierCount: () => number;
    readonly campaignMoveBudget: (a: number, b: number) => [number, number, number];
    readonly mergeCampaignStars: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly initializeRun: (a: number, b: number) => [number, number, number, number];
    readonly buildRunConfig: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number) => [number, number, number, number];
    readonly reconcileRunState: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: bigint, x: number, y: number, z: number, a1: number, b1: number, c1: number, d1: number) => [number, number, number, number];
    readonly applyRunVrf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly playRunMove: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number, number];
    readonly applyRunBonus: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly requestRunReroll: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly finishRun: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly runScoreEligible: (a: number, b: number) => [number, number, number];
    readonly runLatchedStarSources: (a: number, b: number) => [number, number, number];
    readonly runEndReason: (a: number, b: number) => [number, number, number];
    readonly dailyBoardPools: (a: bigint, b: number) => [number, number];
    readonly boardWidth: (a: bigint, b: number, c: bigint, d: bigint) => [number, number, number, number];
    readonly payoutPlan: (a: bigint, b: number, c: number, d: bigint, e: bigint) => [number, number, number, number];
    readonly payoutForRank: (a: bigint, b: number, c: number, d: number, e: bigint) => [bigint, number, number];
    readonly dailyPairIndex: (a: number) => number;
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
