import {
  default as initializeBindings,
  initSync,
  emptyContinuationRows,
  initialReplayCommitment,
  ladderPoints,
  ladderTier,
  ladderTierCount,
  ladderTierFloor,
  qualifiedPlayerId,
} from "./generated/zkube_core";
import wasmUrl from "./generated/zkube_core_bg.wasm?url";

export type ReplayMode = "ranked";

let initialized = false;
let initialization: Promise<void> | null = null;

/** Load the generated core once. Safe to call from any preview surface. */
export function initializeZkubeCore(): Promise<void> {
  if (initialized) return Promise.resolve();
  initialization ??= initializeBindings({ module_or_path: wasmUrl }).then(() => {
    initialized = true;
  });
  return initialization;
}

/** Node/test bootstrap; production code uses {@link initializeZkubeCore}. */
export function initializeZkubeCoreSync(module: BufferSource): void {
  if (initialized) return;
  initSync({ module });
  initialized = true;
}

export function coreEmptyContinuationRows(args: {
  requestCounter: number;
  vrfOutput: Uint8Array;
  rulesHash: Uint8Array;
  weights: readonly number[];
}): { seedRow: number[]; previewRow: number[] } {
  assertInitialized();
  if (
    !Number.isSafeInteger(args.requestCounter) ||
    args.requestCounter < 0 ||
    args.requestCounter > 0xffff_ffff
  ) {
    throw new Error("requestCounter must be a u32");
  }
  assertBytes32(args.vrfOutput, "vrfOutput");
  assertBytes32(args.rulesHash, "rulesHash");
  if (
    args.weights.length !== 5 ||
    args.weights.some(
      (weight) =>
        !Number.isSafeInteger(weight) || weight < 0 || weight > 0xffff,
    )
  ) {
    throw new Error("weights must contain five u16 values");
  }
  const rows = emptyContinuationRows(
    args.requestCounter,
    args.vrfOutput,
    args.rulesHash,
    Uint16Array.from(args.weights),
  );
  if (rows.length !== 16) {
    throw new Error("core returned an invalid continuation row pair");
  }
  return {
    seedRow: [...rows.slice(0, 8)],
    previewRow: [...rows.slice(8, 16)],
  };
}

/** Deterministic core boundary; callers never duplicate protocol hashing. */
export function corePlayerId(
  chainDomain: Uint8Array,
  rawAccount: Uint8Array,
): Uint8Array {
  assertInitialized();
  assertBytes32(chainDomain, "chainDomain");
  assertBytes32(rawAccount, "rawAccount");
  return qualifiedPlayerId(chainDomain, rawAccount);
}

export function coreLadderPoints(qualifiedEntrants: number, rank: number): number {
  assertInitialized();
  assertU32(qualifiedEntrants, "qualifiedEntrants");
  assertU32(rank, "rank");
  return ladderPoints(qualifiedEntrants, rank);
}

/**
 * Tier boundary, read from the core rather than restated here: the program
 * stores the tier it computes and this draws the same one, so a divergence
 * would show the player a rank they do not hold.
 */
export function coreLadderTier(points: bigint): number {
  assertInitialized();
  if (points < 0n) throw new Error("ladder points cannot be negative");
  return ladderTier(points);
}

/** Cumulative-point floor of a tier, saturating at the highest. */
export function coreLadderTierFloor(tier: number): bigint {
  assertInitialized();
  assertU32(tier, "tier");
  return ladderTierFloor(tier);
}

/** Number of named tiers the protocol defines. */
export function coreLadderTierCount(): number {
  assertInitialized();
  return ladderTierCount();
}

export function coreInitialReplayCommitment(args: {
  chainDomain: Uint8Array;
  challengeId: Uint8Array;
  rulesHash: Uint8Array;
  rawAccount: Uint8Array;
  runId: bigint;
  mode: ReplayMode;
}): Uint8Array {
  assertInitialized();
  assertBytes32(args.chainDomain, "chainDomain");
  assertBytes32(args.challengeId, "challengeId");
  assertBytes32(args.rulesHash, "rulesHash");
  assertBytes32(args.rawAccount, "rawAccount");
  if (args.runId <= 0n) throw new Error("runId must be positive");
  return initialReplayCommitment(
    args.chainDomain,
    args.challengeId,
    args.rulesHash,
    args.rawAccount,
    args.runId,
    0,
  );
}

export function decodeHex(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) {
    throw new Error("hex value is malformed");
  }
  return Uint8Array.from(
    { length: value.length / 2 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

export function encodeHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertBytes32(value: Uint8Array, label: string): void {
  if (value.length !== 32) throw new Error(`${label} must contain 32 bytes`);
}

function assertU32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${label} must be a u32`);
  }
}

function assertInitialized(): void {
  if (!initialized) throw new Error("zkube-core WASM is not initialized");
}
