import {
  applyRunBonus,
  applyRunVrf,
  boardWidth,
  dailyBoardPools,
  dailyPairIndex,
  default as initializeBindings,
  finishRun,
  initSync,
  emptyContinuationRows,
  initialReplayCommitment,
  initializeRun,
  ladderPoints,
  ladderTier,
  ladderTierCount,
  ladderTierFloor,
  payoutForRank,
  payoutPlan,
  playRunMove,
  qualifiedPlayerId,
  requestRunReroll,
  runEndReason,
  runLatchedStarSources,
  runScoreEligible,
} from "./generated/zkube_core";
import wasmUrl from "./generated/zkube_core_bg.wasm?url";

export type ReplayMode = "ranked";
export type RunFinishReason = "abandon" | "deadline";

let initialized = false;
let initialization: Promise<void> | null = null;

/** Load the generated core once. Safe to call from any preview surface. */
export function initializeZkubeCore(): Promise<void> {
  if (initialized) return Promise.resolve();
  initialization ??= initializeBindings({ module_or_path: wasmUrl }).then(
    () => {
      initialized = true;
    },
  );
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

export function coreLadderPoints(
  qualifiedEntrants: number,
  rank: number,
): number {
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

/** One state/config boundary drives both Campaign and Daily previews. */
export function coreInitializeRun(config: Uint8Array): Uint8Array {
  assertInitialized();
  return initializeRun(config);
}

export function coreApplyRunVrf(args: {
  config: Uint8Array;
  state: Uint8Array;
  requestCounter: number;
  vrfOutput: Uint8Array;
}): Uint8Array {
  assertInitialized();
  assertU32(args.requestCounter, "requestCounter");
  assertBytes32(args.vrfOutput, "vrfOutput");
  return applyRunVrf(
    args.config,
    args.state,
    args.requestCounter,
    args.vrfOutput,
  );
}

export function corePlayRunMove(args: {
  config: Uint8Array;
  state: Uint8Array;
  action: number;
  expectedMove: number;
  row: number;
  start: number;
  destination: number;
}): Uint8Array {
  assertInitialized();
  assertU32(args.action, "action");
  assertUnsigned(args.expectedMove, 0xffff, "expectedMove");
  assertUnsigned(args.row, 0xff, "row");
  assertUnsigned(args.start, 0xff, "start");
  assertUnsigned(args.destination, 0xff, "destination");
  return playRunMove(
    args.config,
    args.state,
    args.action,
    args.expectedMove,
    args.row,
    args.start,
    args.destination,
  );
}

export function coreApplyRunBonus(args: {
  config: Uint8Array;
  state: Uint8Array;
  action: number;
  row: number;
  column: number;
}): Uint8Array {
  assertInitialized();
  assertU32(args.action, "action");
  assertUnsigned(args.row, 0xff, "row");
  assertUnsigned(args.column, 0xff, "column");
  return applyRunBonus(
    args.config,
    args.state,
    args.action,
    args.row,
    args.column,
  );
}

export function coreRequestRunReroll(
  config: Uint8Array,
  state: Uint8Array,
  action: number,
): Uint8Array {
  assertInitialized();
  assertU32(action, "action");
  return requestRunReroll(config, state, action);
}

export function coreFinishRun(
  config: Uint8Array,
  state: Uint8Array,
  reason: RunFinishReason,
): Uint8Array {
  assertInitialized();
  return finishRun(config, state, reason === "abandon" ? 3 : 4);
}

export function coreRunSummary(state: Uint8Array): {
  scoreEligible: boolean;
  latchedStarSources: number;
  endReason: number;
} {
  assertInitialized();
  return {
    scoreEligible: runScoreEligible(state),
    latchedStarSources: runLatchedStarSources(state),
    endReason: runEndReason(state),
  };
}

/** Protocol exports consumed by the client economy boundary in brief 08. */
export const coreProtocol = {
  dailyPairIndex,
  dailyBoardPools,
  boardWidth,
  payoutPlan,
  payoutForRank,
} as const;

export function decodeHex(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) {
    throw new Error("hex value is malformed");
  }
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
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

function assertUnsigned(value: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} is outside its unsigned range`);
  }
}

function assertInitialized(): void {
  if (!initialized) throw new Error("zkube-core WASM is not initialized");
}
