/* @ts-self-types="./zkube_core.d.ts" */

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
 * @param {number} qualified_winners
 * @param {bigint} entry_price
 * @param {bigint} whole_unit
 * @returns {Uint8Array}
 */
function payoutPlan(pool, qualified_winners, entry_price, whole_unit) {
    const ret = wasm.payoutPlan(pool, qualified_winners, entry_price, whole_unit);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}
exports.payoutPlan = payoutPlan;

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
