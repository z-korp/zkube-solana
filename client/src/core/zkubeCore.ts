import {
  applyRunBonus,
  applyRunVrf,
  boardWidth,
  buildRunConfig,
  campaignMoveBudget,
  mergeCampaignStars,
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
  reconcileRunState,
  requestRunReroll,
  runEndReason,
  runLatchedStarSources,
  runScoreEligible,
} from "./generated/zkube_core";
import wasmUrl from "./generated/zkube_core_bg.wasm?url";
import {
  ARENA_ENTRY_LAMPORTS,
  SOL_PAYOUT_UNIT_LAMPORTS,
} from "./protocolVersions.generated";

export type ReplayMode = "ranked";
export type RunFinishReason = "abandon" | "deadline";
export type CoreRunMode = "campaign" | "daily";
export type CoreRunPhase =
  | "playing"
  | "awaitingVrf"
  | "levelComplete"
  | "finished";

export interface CoreRunToken {
  config: Uint8Array;
  state: Uint8Array;
}

export interface CoreConstraint {
  kind: number;
  value: number;
  requiredCount: number;
}

export interface CoreRunConfigInput {
  mode: CoreRunMode;
  rulesHash: Uint8Array;
  initialReplay: Uint8Array;
  maxMoves: number;
  bonusType: number;
  trigger: number;
  triggerThreshold: number;
  startingHeight: number;
  fixedTier: number;
  pointsRequired: number;
  primary: CoreConstraint;
  secondary: CoreConstraint;
  objective: CoreConstraint;
}

export interface CoreChainRunSnapshot {
  phase: CoreRunPhase;
  endReason: number;
  bonusType: number;
  bonusCharges: number;
  rerollCharges: number;
  comboCounter: number;
  maxCombo: number;
  primaryProgress: number;
  secondaryProgress: number;
  latchedStarSources: number;
  streak: number;
  chargesEarned: number;
  currentTier: number;
  levelLinesCleared: number;
  moves: number;
  actionCounter: number;
  vrfRequestCounter: number;
  pendingVrfCounter: number;
  score: number;
  dailyScore: number;
  objectiveTotal: bigint;
  pressureScore: number;
  grid: readonly number[];
  nextRow: readonly number[] | null;
  replayHash: Uint8Array;
}

export interface CoreRunSummary {
  scoreEligible: boolean;
  phase: CoreRunPhase;
  endReason: number;
  bonusType: number;
  bonusCharges: number;
  rerollCharges: number;
  comboCounter: number;
  maxCombo: number;
  primaryProgress: number;
  secondaryProgress: number;
  latchedStarSources: number;
  streak: number;
  chargesEarned: number;
  currentTier: number;
  levelLinesCleared: number;
  moves: number;
  actionCounter: number;
  lastVrfCounter: number;
  score: number;
  dailyScore: number;
  objectiveTotal: bigint;
  pressureScore: number;
  grid: number[];
  nextRow: number[] | null;
  replayHash: number[];
  rulesHash: number[];
}

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

/** Campaign difficulty is derived in core, never copied from a publication. */
export function coreMergeCampaignStars(stored: Uint8Array, incoming: Uint8Array): Uint8Array {
  return mergeCampaignStars(stored, incoming);
}

export function coreCampaignMoveBudget(level: number, tier: number): number {
  assertInitialized();
  assertUnsigned(level, 0xff, "level");
  assertUnsigned(tier, 0xff, "tier");
  return campaignMoveBudget(level, tier);
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

/** Rust owns the config codec and rejects cross-mode rule shapes. */
export function coreBuildRunConfig(args: CoreRunConfigInput): Uint8Array {
  assertInitialized();
  assertBytes32(args.rulesHash, "rulesHash");
  assertBytes32(args.initialReplay, "initialReplay");
  const campaign = args.mode === "campaign";
  return buildRunConfig(
    args.rulesHash,
    args.initialReplay,
    args.maxMoves,
    args.bonusType,
    args.trigger,
    args.triggerThreshold,
    args.startingHeight,
    campaign ? 0 : 1,
    campaign ? args.fixedTier : 0,
    campaign ? args.pointsRequired : 0,
    campaign ? args.primary.kind : 0,
    campaign ? args.primary.value : 0,
    campaign ? args.primary.requiredCount : 0,
    campaign ? args.secondary.kind : 0,
    campaign ? args.secondary.value : 0,
    campaign ? args.secondary.requiredCount : 0,
    campaign ? 0 : args.objective.kind,
    campaign ? 0 : args.objective.value,
  );
}

/** Chain recovery crosses back through Rust before becoming a local token. */
export function coreReconcileRunState(
  config: Uint8Array,
  snapshot: CoreChainRunSnapshot,
): Uint8Array {
  assertInitialized();
  assertBytes32(snapshot.replayHash, "replayHash");
  return reconcileRunState(
    config,
    corePhaseTag(snapshot.phase),
    snapshot.endReason,
    snapshot.bonusType,
    snapshot.bonusCharges,
    snapshot.rerollCharges,
    snapshot.comboCounter,
    snapshot.maxCombo,
    snapshot.primaryProgress,
    snapshot.secondaryProgress,
    snapshot.latchedStarSources,
    snapshot.streak,
    snapshot.chargesEarned,
    snapshot.currentTier,
    snapshot.levelLinesCleared,
    snapshot.moves,
    snapshot.actionCounter,
    snapshot.vrfRequestCounter,
    snapshot.pendingVrfCounter,
    snapshot.score,
    snapshot.dailyScore,
    snapshot.objectiveTotal,
    snapshot.pressureScore,
    Uint8Array.from(snapshot.grid),
    snapshot.nextRow === null
      ? new Uint8Array()
      : Uint8Array.from(snapshot.nextRow),
    snapshot.replayHash,
  );
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

export function coreRunSummary(state: Uint8Array): CoreRunSummary {
  assertInitialized();
  requireLength(state, 231, "Run state");
  if (state[0] !== 1) throw new Error("Run state version is unsupported");
  const endReason = runEndReason(state);
  const latchedStarSources = runLatchedStarSources(state);
  const hasNextRow = state[2] === 1;
  const phase = corePhase(state[1]);
  return {
    scoreEligible: runScoreEligible(state),
    phase,
    endReason,
    bonusType: state[3]!,
    bonusCharges: state[4]!,
    rerollCharges: state[5]!,
    comboCounter: state[6]!,
    maxCombo: state[7]!,
    primaryProgress: state[8]!,
    secondaryProgress: state[9]!,
    latchedStarSources,
    streak: state[11]!,
    chargesEarned: state[12]!,
    currentTier: state[13]!,
    levelLinesCleared: readU16(state, 14),
    moves: readU16(state, 16),
    actionCounter: readU32(state, 18),
    lastVrfCounter: readU32(state, 22),
    score: readU32(state, 26),
    dailyScore: readU32(state, 30),
    objectiveTotal: readU64(state, 34),
    pressureScore: readU32(state, 42),
    grid: [...state.slice(46, 126)],
    nextRow: hasNextRow ? [...state.slice(126, 134)] : null,
    replayHash: [...state.slice(134, 166)],
    rulesHash: [...state.slice(166, 198)],
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

export interface CoreRankPayoutPlan {
  payouts: bigint[];
  winnerCount: number;
  widthWinnerCount: number;
  denominator: bigint;
  capacityLimited: boolean;
  paidLamports: bigint;
  rolloverLamports: bigint;
}

export async function coreDailyPairIndex(dayId: number): Promise<number> {
  await initializeZkubeCore();
  assertU32(dayId, "dayId");
  return dailyPairIndex(dayId);
}

export function coreDailyBoardPools(
  potLamports: bigint,
  themeQualifiedPlayers: number,
): { score: bigint; theme: bigint } {
  assertInitialized();
  const bytes = dailyBoardPools(potLamports, themeQualifiedPlayers);
  requireLength(bytes, 16, "Daily board pools");
  return { score: readU64(bytes, 0), theme: readU64(bytes, 8) };
}

export function coreRankPayoutPlan(
  potLamports: bigint,
  qualifiedPlayers: number,
  capacity = qualifiedPlayers,
): CoreRankPayoutPlan {
  assertInitialized();
  const bytes = payoutPlan(
    potLamports,
    qualifiedPlayers,
    capacity,
    ARENA_ENTRY_LAMPORTS,
    SOL_PAYOUT_UNIT_LAMPORTS,
  );
  if (bytes.length < 41 || (bytes.length - 41) % 8 !== 0) {
    throw new Error("core returned a malformed payout plan");
  }
  const winnerCount = readU32(bytes, 0);
  const payouts = Array.from({ length: (bytes.length - 41) / 8 }, (_, index) =>
    readU64(bytes, 41 + index * 8),
  );
  if (payouts.length !== winnerCount) {
    throw new Error("core payout count does not match its encoded plan");
  }
  return {
    payouts,
    winnerCount,
    widthWinnerCount: readU32(bytes, 4),
    denominator: readU128(bytes, 8),
    capacityLimited: bytes[24] === 1,
    paidLamports: readU64(bytes, 25),
    rolloverLamports: readU64(bytes, 33),
  };
}

export function corePayoutForRank(
  poolLamports: bigint,
  denominator: bigint,
  rank: number,
): bigint {
  assertInitialized();
  return payoutForRank(
    poolLamports,
    writeU128(denominator),
    rank,
    SOL_PAYOUT_UNIT_LAMPORTS,
  );
}

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

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, true);
}

function readU16(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint16(offset, true);
}

function corePhase(tag: number | undefined): CoreRunPhase {
  if (tag === 1) return "playing";
  if (tag === 2) return "awaitingVrf";
  if (tag === 3) return "levelComplete";
  if (tag === 4) return "finished";
  throw new Error("Run state phase is invalid");
}

function corePhaseTag(phase: CoreRunPhase): number {
  if (phase === "playing") return 1;
  if (phase === "awaitingVrf") return 2;
  if (phase === "levelComplete") return 3;
  return 4;
}

function readU64(bytes: Uint8Array, offset: number): bigint {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getBigUint64(offset, true);
}

function readU128(bytes: Uint8Array, offset: number): bigint {
  return readU64(bytes, offset) | (readU64(bytes, offset + 8) << 64n);
}

function writeU128(value: bigint): Uint8Array {
  if (value < 0n || value > (1n << 128n) - 1n) {
    throw new Error("payout denominator is outside u128");
  }
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, value & ((1n << 64n) - 1n), true);
  view.setBigUint64(8, value >> 64n, true);
  return bytes;
}

function requireLength(bytes: Uint8Array, length: number, label: string): void {
  if (bytes.length !== length) throw new Error(`${label} encoding is invalid`);
}
