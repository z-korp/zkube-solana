/* @ts-self-types="./zkube_core.d.ts" */

/**
 * @param {Uint8Array} config
 * @param {Uint8Array} state
 * @param {number} action
 * @param {number} row
 * @param {number} column
 * @returns {Uint8Array}
 */
function applyRunBonus(config, state, action, row, column) {
    const ptr0 = passArray8ToWasm0(config, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.applyRunBonus(ptr0, len0, ptr1, len1, action, row, column);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}
exports.applyRunBonus = applyRunBonus;

/**
 * @param {Uint8Array} config
 * @param {Uint8Array} state
 * @param {number} request_counter
 * @param {Uint8Array} vrf_output
 * @returns {Uint8Array}
 */
function applyRunVrf(config, state, request_counter, vrf_output) {
    const ptr0 = passArray8ToWasm0(config, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(vrf_output, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.applyRunVrf(ptr0, len0, ptr1, len1, request_counter, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}
exports.applyRunVrf = applyRunVrf;

/**
 * @param {bigint} pool
 * @param {number} qualified_winners
 * @param {bigint} entry_price
 * @param {bigint} whole_unit
 * @returns {Uint8Array}
 */
function boardWidth(pool, qualified_winners, entry_price, whole_unit) {
    const ret = wasm.boardWidth(pool, qualified_winners, entry_price, whole_unit);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}
exports.boardWidth = boardWidth;

/**
 * @param {Uint8Array} rules_hash
 * @param {Uint8Array} initial_replay
 * @param {number} max_moves
 * @param {number} bonus
 * @param {number} trigger
 * @param {number} trigger_threshold
 * @param {number} starting_height
 * @param {number} tier_policy
 * @param {number} fixed_tier
 * @param {number} points_required
 * @param {number} primary_kind
 * @param {number} primary_value
 * @param {number} primary_count
 * @param {number} secondary_kind
 * @param {number} secondary_value
 * @param {number} secondary_count
 * @param {number} objective_kind
 * @param {number} objective_value
 * @returns {Uint8Array}
 */
function buildRunConfig(rules_hash, initial_replay, max_moves, bonus, trigger, trigger_threshold, starting_height, tier_policy, fixed_tier, points_required, primary_kind, primary_value, primary_count, secondary_kind, secondary_value, secondary_count, objective_kind, objective_value) {
    const ptr0 = passArray8ToWasm0(rules_hash, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(initial_replay, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.buildRunConfig(ptr0, len0, ptr1, len1, max_moves, bonus, trigger, trigger_threshold, starting_height, tier_policy, fixed_tier, points_required, primary_kind, primary_value, primary_count, secondary_kind, secondary_value, secondary_count, objective_kind, objective_value);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}
exports.buildRunConfig = buildRunConfig;

/**
 * @param {number} level
 * @param {number} tier
 * @returns {number}
 */
function campaignMoveBudget(level, tier) {
    const ret = wasm.campaignMoveBudget(level, tier);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}
exports.campaignMoveBudget = campaignMoveBudget;

/**
 * @param {bigint} left_metric
 * @param {bigint} left_time
 * @param {Uint8Array} left_owner
 * @param {bigint} right_metric
 * @param {bigint} right_time
 * @param {Uint8Array} right_owner
 * @returns {number}
 */
function compareBoardEntries(left_metric, left_time, left_owner, right_metric, right_time, right_owner) {
    const ptr0 = passArray8ToWasm0(left_owner, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(right_owner, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.compareBoardEntries(left_metric, left_time, ptr0, len0, right_metric, right_time, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}
exports.compareBoardEntries = compareBoardEntries;

/**
 * @param {bigint} pool
 * @param {number} theme_qualified
 * @returns {Uint8Array}
 */
function dailyBoardPools(pool, theme_qualified) {
    const ret = wasm.dailyBoardPools(pool, theme_qualified);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}
exports.dailyBoardPools = dailyBoardPools;

/**
 * @param {number} day
 * @param {number} suspended
 * @returns {boolean}
 */
function dailyIsScheduled(day, suspended) {
    const ret = wasm.dailyIsScheduled(day, suspended);
    return ret !== 0;
}
exports.dailyIsScheduled = dailyIsScheduled;

/**
 * @param {number} day
 * @returns {Uint32Array}
 */
function dailyPair(day) {
    const ret = wasm.dailyPair(day);
    var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}
exports.dailyPair = dailyPair;

/**
 * @param {number} day_id
 * @returns {number}
 */
function dailyPairIndex(day_id) {
    const ret = wasm.dailyPairIndex(day_id);
    return ret >>> 0;
}
exports.dailyPairIndex = dailyPairIndex;

/**
 * @param {number} day
 * @returns {BigInt64Array}
 */
function dailyWindow(day) {
    const ret = wasm.dailyWindow(day);
    var v1 = getArrayI64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}
exports.dailyWindow = dailyWindow;

/**
 * @param {bigint} timestamp
 * @returns {number}
 */
function dayIdAt(timestamp) {
    const ret = wasm.dayIdAt(timestamp);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}
exports.dayIdAt = dayIdAt;

/**
 * @param {number} request_counter
 * @param {Uint8Array} vrf_output
 * @param {Uint8Array} rules_hash
 * @param {Uint16Array} weights
 * @returns {Uint8Array}
 */
function emptyContinuationRows(request_counter, vrf_output, rules_hash, weights) {
    const ptr0 = passArray8ToWasm0(vrf_output, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(rules_hash, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray16ToWasm0(weights, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.emptyContinuationRows(request_counter, ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}
exports.emptyContinuationRows = emptyContinuationRows;

/**
 * @param {Uint8Array} config
 * @param {Uint8Array} state
 * @param {number} reason_tag
 * @returns {Uint8Array}
 */
function finishRun(config, state, reason_tag) {
    const ptr0 = passArray8ToWasm0(config, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.finishRun(ptr0, len0, ptr1, len1, reason_tag);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}
exports.finishRun = finishRun;

/**
 * @param {Uint8Array} chain_domain
 * @param {Uint8Array} challenge_id
 * @param {Uint8Array} rules_hash
 * @param {Uint8Array} raw_account
 * @param {bigint} run_id
 * @param {number} mode_tag
 * @returns {Uint8Array}
 */
function initialReplayCommitment(chain_domain, challenge_id, rules_hash, raw_account, run_id, mode_tag) {
    const ptr0 = passArray8ToWasm0(chain_domain, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(challenge_id, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(rules_hash, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(raw_account, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.initialReplayCommitment(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, run_id, mode_tag);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v5 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v5;
}
exports.initialReplayCommitment = initialReplayCommitment;

/**
 * @param {Uint8Array} config
 * @returns {Uint8Array}
 */
function initializeRun(config) {
    const ptr0 = passArray8ToWasm0(config, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.initializeRun(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}
exports.initializeRun = initializeRun;

/**
 * @param {number} qualified_entrants
 * @param {number} rank
 * @returns {number}
 */
function ladderPoints(qualified_entrants, rank) {
    const ret = wasm.ladderPoints(qualified_entrants, rank);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}
exports.ladderPoints = ladderPoints;

/**
 * @param {bigint} points
 * @returns {number}
 */
function ladderTier(points) {
    const ret = wasm.ladderTier(points);
    return ret;
}
exports.ladderTier = ladderTier;

/**
 * @returns {number}
 */
function ladderTierCount() {
    const ret = wasm.ladderTierCount();
    return ret;
}
exports.ladderTierCount = ladderTierCount;

/**
 * @param {number} tier
 * @returns {bigint}
 */
function ladderTierFloor(tier) {
    const ret = wasm.ladderTierFloor(tier);
    return BigInt.asUintN(64, ret);
}
exports.ladderTierFloor = ladderTierFloor;

/**
 * @param {Uint8Array} stored
 * @param {Uint8Array} incoming
 * @returns {Uint8Array}
 */
function mergeCampaignStars(stored, incoming) {
    const ptr0 = passArray8ToWasm0(stored, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(incoming, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.mergeCampaignStars(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}
exports.mergeCampaignStars = mergeCampaignStars;

/**
 * @param {number} day
 * @param {number} suspended
 * @returns {number}
 */
function nextScheduledDaily(day, suspended) {
    const ret = wasm.nextScheduledDaily(day, suspended);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}
exports.nextScheduledDaily = nextScheduledDaily;

/**
 * @param {bigint} pool
 * @param {Uint8Array} denominator
 * @param {number} rank
 * @param {bigint} whole_unit
 * @returns {bigint}
 */
function payoutForRank(pool, denominator, rank, whole_unit) {
    const ptr0 = passArray8ToWasm0(denominator, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.payoutForRank(pool, ptr0, len0, rank, whole_unit);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return BigInt.asUintN(64, ret[0]);
}
exports.payoutForRank = payoutForRank;

/**
 * @param {bigint} pool
 * @param {number} qualified_winners
 * @param {number} capacity
 * @param {bigint} entry_price
 * @param {bigint} whole_unit
 * @returns {Uint8Array}
 */
function payoutPlan(pool, qualified_winners, capacity, entry_price, whole_unit) {
    const ret = wasm.payoutPlan(pool, qualified_winners, capacity, entry_price, whole_unit);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}
exports.payoutPlan = payoutPlan;

/**
 * @param {Uint8Array} config
 * @param {Uint8Array} state
 * @param {number} action
 * @param {number} expected_move
 * @param {number} row
 * @param {number} start
 * @param {number} destination
 * @returns {Uint8Array}
 */
function playRunMove(config, state, action, expected_move, row, start, destination) {
    const ptr0 = passArray8ToWasm0(config, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.playRunMove(ptr0, len0, ptr1, len1, action, expected_move, row, start, destination);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}
exports.playRunMove = playRunMove;

/**
 * @param {Uint8Array} chain_domain
 * @param {Uint8Array} raw_account
 * @returns {Uint8Array}
 */
function qualifiedPlayerId(chain_domain, raw_account) {
    const ptr0 = passArray8ToWasm0(chain_domain, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(raw_account, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.qualifiedPlayerId(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}
exports.qualifiedPlayerId = qualifiedPlayerId;

/**
 * @param {Uint8Array} config
 * @param {number} phase
 * @param {number} end_reason
 * @param {number} bonus
 * @param {number} bonus_charges
 * @param {number} reroll_charges
 * @param {number} combo_counter
 * @param {number} max_combo
 * @param {number} primary_progress
 * @param {number} secondary_progress
 * @param {number} latched_star_sources
 * @param {number} streak
 * @param {number} charges_earned
 * @param {number} current_tier
 * @param {number} level_lines_cleared
 * @param {number} moves
 * @param {number} action_counter
 * @param {number} vrf_request_counter
 * @param {number} pending_vrf_counter
 * @param {number} score
 * @param {number} daily_score
 * @param {bigint} objective_total
 * @param {number} pressure_score
 * @param {Uint8Array} grid
 * @param {Uint8Array} next_row
 * @param {Uint8Array} replay
 * @returns {Uint8Array}
 */
function reconcileRunState(config, phase, end_reason, bonus, bonus_charges, reroll_charges, combo_counter, max_combo, primary_progress, secondary_progress, latched_star_sources, streak, charges_earned, current_tier, level_lines_cleared, moves, action_counter, vrf_request_counter, pending_vrf_counter, score, daily_score, objective_total, pressure_score, grid, next_row, replay) {
    const ptr0 = passArray8ToWasm0(config, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(grid, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(next_row, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(replay, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.reconcileRunState(ptr0, len0, phase, end_reason, bonus, bonus_charges, reroll_charges, combo_counter, max_combo, primary_progress, secondary_progress, latched_star_sources, streak, charges_earned, current_tier, level_lines_cleared, moves, action_counter, vrf_request_counter, pending_vrf_counter, score, daily_score, objective_total, pressure_score, ptr1, len1, ptr2, len2, ptr3, len3);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v5 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v5;
}
exports.reconcileRunState = reconcileRunState;

/**
 * @param {Uint8Array} config
 * @param {Uint8Array} state
 * @param {number} action
 * @returns {Uint8Array}
 */
function requestRunReroll(config, state, action) {
    const ptr0 = passArray8ToWasm0(config, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.requestRunReroll(ptr0, len0, ptr1, len1, action);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}
exports.requestRunReroll = requestRunReroll;

/**
 * @param {Uint8Array} state
 * @returns {number}
 */
function runEndReason(state) {
    const ptr0 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.runEndReason(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}
exports.runEndReason = runEndReason;

/**
 * @param {Uint8Array} state
 * @returns {number}
 */
function runLatchedStarSources(state) {
    const ptr0 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.runLatchedStarSources(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}
exports.runLatchedStarSources = runLatchedStarSources;

/**
 * @param {Uint8Array} state
 * @returns {boolean}
 */
function runScoreEligible(state) {
    const ptr0 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.runScoreEligible(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}
exports.runScoreEligible = runScoreEligible;

/**
 * @param {number} day
 * @param {number} suspended
 * @returns {Uint32Array}
 */
function scheduledDailyWindow(day, suspended) {
    const ret = wasm.scheduledDailyWindow(day, suspended);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}
exports.scheduledDailyWindow = scheduledDailyWindow;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_960c155d3d49e4c2: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./zkube_core_bg.js": import0,
    };
}

function getArrayI64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getBigInt64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedBigInt64ArrayMemory0 = null;
function getBigInt64ArrayMemory0() {
    if (cachedBigInt64ArrayMemory0 === null || cachedBigInt64ArrayMemory0.byteLength === 0) {
        cachedBigInt64ArrayMemory0 = new BigInt64Array(wasm.memory.buffer);
    }
    return cachedBigInt64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray16ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 2, 2) >>> 0;
    getUint16ArrayMemory0().set(arg, ptr / 2);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/zkube_core_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasm = new WebAssembly.Instance(wasmModule, __wbg_get_imports()).exports;
wasm.__wbindgen_start();
