/* @ts-self-types="./zkube_core.d.ts" */

/**
 * @param {Uint8Array} config
 * @param {Uint8Array} state
 * @param {number} action
 * @param {number} row
 * @param {number} column
 * @returns {Uint8Array}
 */
export function applyRunBonus(config, state, action, row, column) {
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

/**
 * @param {Uint8Array} config
 * @param {Uint8Array} state
 * @param {number} request_counter
 * @param {Uint8Array} vrf_output
 * @returns {Uint8Array}
 */
export function applyRunVrf(config, state, request_counter, vrf_output) {
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

/**
 * @param {bigint} pool
 * @param {number} qualified_winners
 * @param {bigint} entry_price
 * @param {bigint} whole_unit
 * @returns {Uint8Array}
 */
export function boardWidth(pool, qualified_winners, entry_price, whole_unit) {
    const ret = wasm.boardWidth(pool, qualified_winners, entry_price, whole_unit);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

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
export function buildRunConfig(rules_hash, initial_replay, max_moves, bonus, trigger, trigger_threshold, starting_height, tier_policy, fixed_tier, points_required, primary_kind, primary_value, primary_count, secondary_kind, secondary_value, secondary_count, objective_kind, objective_value) {
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

/**
 * @param {bigint} pool
 * @param {number} theme_qualified
 * @returns {Uint8Array}
 */
export function dailyBoardPools(pool, theme_qualified) {
    const ret = wasm.dailyBoardPools(pool, theme_qualified);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {number} day_id
 * @returns {number}
 */
export function dailyPairIndex(day_id) {
    const ret = wasm.dailyPairIndex(day_id);
    return ret >>> 0;
}

/**
 * @param {number} request_counter
 * @param {Uint8Array} vrf_output
 * @param {Uint8Array} rules_hash
 * @param {Uint16Array} weights
 * @returns {Uint8Array}
 */
export function emptyContinuationRows(request_counter, vrf_output, rules_hash, weights) {
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

/**
 * @param {Uint8Array} config
 * @param {Uint8Array} state
 * @param {number} reason_tag
 * @returns {Uint8Array}
 */
export function finishRun(config, state, reason_tag) {
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

/**
 * @param {Uint8Array} chain_domain
 * @param {Uint8Array} challenge_id
 * @param {Uint8Array} rules_hash
 * @param {Uint8Array} raw_account
 * @param {bigint} run_id
 * @param {number} mode_tag
 * @returns {Uint8Array}
 */
export function initialReplayCommitment(chain_domain, challenge_id, rules_hash, raw_account, run_id, mode_tag) {
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

/**
 * @param {Uint8Array} config
 * @returns {Uint8Array}
 */
export function initializeRun(config) {
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

/**
 * @param {number} qualified_entrants
 * @param {number} rank
 * @returns {number}
 */
export function ladderPoints(qualified_entrants, rank) {
    const ret = wasm.ladderPoints(qualified_entrants, rank);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {bigint} points
 * @returns {number}
 */
export function ladderTier(points) {
    const ret = wasm.ladderTier(points);
    return ret;
}

/**
 * @returns {number}
 */
export function ladderTierCount() {
    const ret = wasm.ladderTierCount();
    return ret;
}

/**
 * @param {number} tier
 * @returns {bigint}
 */
export function ladderTierFloor(tier) {
    const ret = wasm.ladderTierFloor(tier);
    return BigInt.asUintN(64, ret);
}

/**
 * @param {bigint} pool
 * @param {Uint8Array} denominator
 * @param {number} rank
 * @param {bigint} whole_unit
 * @returns {bigint}
 */
export function payoutForRank(pool, denominator, rank, whole_unit) {
    const ptr0 = passArray8ToWasm0(denominator, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.payoutForRank(pool, ptr0, len0, rank, whole_unit);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return BigInt.asUintN(64, ret[0]);
}

/**
 * @param {bigint} pool
 * @param {number} qualified_winners
 * @param {number} capacity
 * @param {bigint} entry_price
 * @param {bigint} whole_unit
 * @returns {Uint8Array}
 */
export function payoutPlan(pool, qualified_winners, capacity, entry_price, whole_unit) {
    const ret = wasm.payoutPlan(pool, qualified_winners, capacity, entry_price, whole_unit);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

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
export function playRunMove(config, state, action, expected_move, row, start, destination) {
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

/**
 * @param {Uint8Array} chain_domain
 * @param {Uint8Array} raw_account
 * @returns {Uint8Array}
 */
export function qualifiedPlayerId(chain_domain, raw_account) {
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
export function reconcileRunState(config, phase, end_reason, bonus, bonus_charges, reroll_charges, combo_counter, max_combo, primary_progress, secondary_progress, latched_star_sources, streak, charges_earned, current_tier, level_lines_cleared, moves, action_counter, vrf_request_counter, pending_vrf_counter, score, daily_score, objective_total, pressure_score, grid, next_row, replay) {
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

/**
 * @param {Uint8Array} config
 * @param {Uint8Array} state
 * @param {number} action
 * @returns {Uint8Array}
 */
export function requestRunReroll(config, state, action) {
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

/**
 * @param {Uint8Array} state
 * @returns {number}
 */
export function runEndReason(state) {
    const ptr0 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.runEndReason(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {Uint8Array} state
 * @returns {number}
 */
export function runLatchedStarSources(state) {
    const ptr0 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.runLatchedStarSources(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {Uint8Array} state
 * @returns {boolean}
 */
export function runScoreEligible(state) {
    const ptr0 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.runScoreEligible(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}
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
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedUint16ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('zkube_core_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
