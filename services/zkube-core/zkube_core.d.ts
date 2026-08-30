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

export function payoutForRank(pool: bigint, denominator: Uint8Array, rank: number, whole_unit: bigint): bigint;

export function payoutPlan(pool: bigint, qualified_winners: number, capacity: number, entry_price: bigint, whole_unit: bigint): Uint8Array;

export function playRunMove(config: Uint8Array, state: Uint8Array, action: number, expected_move: number, row: number, start: number, destination: number): Uint8Array;

export function qualifiedPlayerId(chain_domain: Uint8Array, raw_account: Uint8Array): Uint8Array;

export function reconcileRunState(config: Uint8Array, phase: number, end_reason: number, bonus: number, bonus_charges: number, reroll_charges: number, combo_counter: number, max_combo: number, primary_progress: number, secondary_progress: number, latched_star_sources: number, streak: number, charges_earned: number, current_tier: number, level_lines_cleared: number, moves: number, action_counter: number, vrf_request_counter: number, pending_vrf_counter: number, score: number, daily_score: number, objective_total: bigint, pressure_score: number, grid: Uint8Array, next_row: Uint8Array, replay: Uint8Array): Uint8Array;

export function requestRunReroll(config: Uint8Array, state: Uint8Array, action: number): Uint8Array;

export function runEndReason(state: Uint8Array): number;

export function runLatchedStarSources(state: Uint8Array): number;

export function runScoreEligible(state: Uint8Array): boolean;
