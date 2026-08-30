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
 * @param {number} day_id
 * @returns {number}
 */
function dailyPairIndex(day_id) {
    const ret = wasm.dailyPairIndex(day_id);
    return ret >>> 0;
}
exports.dailyPairIndex = dailyPairIndex;

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

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
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
