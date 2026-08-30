/* tslint:disable */
/* eslint-disable */

export function applyRunBonus(config: Uint8Array, state: Uint8Array, action: number, row: number, column: number): Uint8Array;

export function applyRunVrf(config: Uint8Array, state: Uint8Array, request_counter: number, vrf_output: Uint8Array): Uint8Array;

export function boardWidth(pool: bigint, qualified_winners: number, entry_price: bigint, whole_unit: bigint): Uint8Array;

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

export function requestRunReroll(config: Uint8Array, state: Uint8Array, action: number): Uint8Array;

export function runEndReason(state: Uint8Array): number;

export function runLatchedStarSources(state: Uint8Array): number;

export function runScoreEligible(state: Uint8Array): boolean;
