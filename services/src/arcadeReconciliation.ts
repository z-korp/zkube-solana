import { PublicKey } from "@solana/web3.js";

import {
  DAILY_ENTRY_CLOSE_OFFSET,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_POOL_SELECTION_SEED,
  DAILY_RUN_CLOSE_OFFSET,
  KEEPER_RECENT_DAILY_CADENCES,
  ARENA_BOARD_CAPACITY,
  ARENA_BOARD_CHUNK_CAPACITY,
  DAILY_POOL_CAPACITY,
  SECONDS_PER_DAY,
  arcadeArchivePda,
  assertCadenceId,
  assertLamports,
  assertPayoutLamports,
  assertSafeTimestamp,
  cadenceFundingPda,
  currentDayId,
  dailyContentSelection,
  dailyIsScheduled,
  nextScheduledDaily,
  playerFundingPda,
  validationOnlyPlan,
  type CompetitionKind,
  type DailyBoardKind,
  type KeeperInstructionPlan,
  type RunMode,
} from "./arcadeChain.js";
import { dailyBoardPools, rankWeightedPayoutPlan } from "./arcadeEconomy.js";

export type PeriodStatus = "funding" | "open" | "finalized";
export type RunLifecycle =
  | "prepared"
  | "delegated"
  | "awaiting_vrf"
  | "playing"
  | "terminal"
  | "unavailable";
export type RunLocation = "base" | "ephemeral_rollup" | "unavailable";

export interface WinnerSnapshot {
  board: DailyBoardKind;
  owner: PublicKey;
  payoutLamports: bigint;
  rank: number;
}

export interface SettlementSnapshot {
  winners: readonly WinnerSnapshot[];
  rolloverLamports: bigint;
  scoreCapacityLimited: boolean;
  themeCapacityLimited: boolean;
}

export interface BoardSourceSnapshot {
  source: PublicKey;
  owner: PublicKey;
  score: number;
  objectiveTotal: bigint;
  finalizedAt: number;
  replayHash: Uint8Array;
}

export interface BoardConstructionSnapshot {
  kind: DailyBoardKind;
  payoutCount: number;
  widthCount: number;
  cursor: number;
  sealed: boolean;
  claimedLamports: bigint;
  claimedCount: number;
  profileSyncCount: number;
  capacityLimited: boolean;
}

export interface DailySnapshot {
  dayId: number;
  status: PeriodStatus;
  finalizedAt: number;
  runsCloseAt: number;
  recoveryDeadlineAt: number;
  entriesPaid: bigint;
  entriesScored: bigint;
  entriesExpired: bigint;
  potLamports: bigint;
  predecessorRolloverRequired: boolean;
  predecessorRolloverApplied: boolean;
  scoreQualifiedPlayers: number;
  themeQualifiedPlayers: number;
  /** Finalized payout positions already reflected in durable PlayerState profiles. */
  scoreClaimedMask: bigint;
  themeClaimedMask: bigint;
  scoreProfileSyncMask: bigint;
  themeProfileSyncMask: bigint;
  claimsExpired: boolean;
  scoreSources?: readonly BoardSourceSnapshot[];
  themeSources?: readonly BoardSourceSnapshot[];
  scoreBoard?: BoardConstructionSnapshot;
  themeBoard?: BoardConstructionSnapshot;
  settlement?: SettlementSnapshot;
}

export interface ArenaPlayerClosureSnapshot {
  dayId: number;
  owner: PublicKey;
  rentRecipient: PublicKey;
}

export interface RunSnapshot {
  owner: PublicKey;
  runId: bigint;
  mode: RunMode;
  /** Required for ranked runs and absent for Campaign. */
  challengeDayId?: number;
  /** Ranked runs use their challenge day. */
  deadlineDayId?: number;
  arenaPlayerExists: boolean;
  lifecycle: RunLifecycle;
  location: RunLocation;
  acceptedActions: number;
  runsCloseAt?: number;
  recoveryDeadlineAt?: number;
  /** False means durable state has moved this id to the orphan reservation. */
  reservationActive: boolean;
}

export interface ArcadeArchiveSnapshot {
  address: PublicKey;
  cadenceFunding: PublicKey;
  firstDailyId: number;
  lastDailyId?: number;
  dailyRoot: string;
}

export interface CadenceArchiveCandidate {
  competition: CompetitionKind;
  cadenceId: number;
  canonicalJson?: string;
  fileSha256?: string;
  resultHash: string;
  requiredScoreProfileSyncMask: bigint;
  requiredThemeProfileSyncMask: bigint;
  claimsExpired: boolean;
  committed: boolean;
  closeEligible: boolean;
  closeEligibleAt: number;
}

export interface ProtocolSnapshot {
  paused: boolean;
  launchDayId: number;
  rulesCatalog: PublicKey;
  contentVersion: number;
  selectionSeed: Uint8Array;
  catalogStartsDay: number;
  poolEntries: readonly {
    realmMapId: number;
    passiveMapId: number;
  }[];
  dailies: readonly DailySnapshot[];
  runs: readonly RunSnapshot[];
  /** Relationship-checked canonical PlayerState owners available for profile sync. */
  playerStateOwners: readonly PublicKey[];
  arenaPlayerClosures: readonly ArenaPlayerClosureSnapshot[];
  /** Present only when the deployed archive ABI has been fully validated. */
  archiveState?: ArcadeArchiveSnapshot;
  archiveCandidates?: readonly CadenceArchiveCandidate[];
}

export interface DomainQuarantine {
  kind: CompetitionKind;
  id: number;
  reason: string;
}

export interface ReconciliationDiscovery {
  plans: KeeperInstructionPlan[];
  quarantines: DomainQuarantine[];
}

export const EMPTY_PROTOCOL_SNAPSHOT: ProtocolSnapshot = Object.freeze({
  paused: true,
  launchDayId: 4,
  rulesCatalog: PublicKey.default,
  contentVersion: 0,
  selectionSeed: new Uint8Array(32),
  catalogStartsDay: 0,
  poolEntries: Object.freeze([]),
  dailies: Object.freeze([]),
  runs: Object.freeze([]),
  playerStateOwners: Object.freeze([]),
  arenaPlayerClosures: Object.freeze([]),
  archiveCandidates: Object.freeze([]),
});

/** Produces non-executable plans from a relationship-checked protocol snapshot. */
export function discoverReconciliation(args: {
  snapshot: ProtocolSnapshot;
  nowUnix: number;
}): ReconciliationDiscovery {
  assertSafeTimestamp(args.nowUnix);
  validateProtocolSnapshot(args.snapshot);
  const quarantines = collectDomainQuarantines(args.snapshot);
  const plans: KeeperInstructionPlan[] = [];
  const today = currentDayId(args.nowUnix);
  const oldestKeeperDay = Math.max(0, today - KEEPER_RECENT_DAILY_CADENCES);
  const dailyById = new Map(args.snapshot.dailies.map((daily) => [daily.dayId, daily]));
  const playerStateOwners = new Set(
    args.snapshot.playerStateOwners.map((owner) => owner.toBase58()),
  );
  const isQuarantined = (id: number) =>
    quarantines.some((quarantine) => quarantine.id === id);

  appendCadenceArchivePlan(
    plans,
    args.snapshot,
    today,
    args.nowUnix,
    isQuarantined,
  );

  if (!args.snapshot.paused) {
    const poolCount = args.snapshot.poolEntries.length;
    const activationCurrent = poolCount === 0
      ? undefined
      : dailyIsScheduled(today, args.snapshot.catalogStartsDay, poolCount)
        ? today
        : nextScheduledDaily(today - 1, args.snapshot.catalogStartsDay, poolCount);
    const activationFollowing = activationCurrent === undefined
      ? undefined
      : nextScheduledDaily(
        activationCurrent,
        args.snapshot.catalogStartsDay,
        poolCount,
      );
    for (const daily of args.snapshot.dailies) {
      if (daily.status !== "funding") continue;
      if (daily.dayId === activationCurrent &&
          args.nowUnix < today * SECONDS_PER_DAY + DAILY_ENTRY_CLOSE_OFFSET) {
        plans.push(validationOnlyPlan("activate_arena_daily", {
          dayId: daily.dayId,
          rulesCatalog: args.snapshot.rulesCatalog,
          catalogStartsDay: args.snapshot.catalogStartsDay,
          poolEntryCount: poolCount,
        }));
      } else if (daily.dayId === activationFollowing) {
        plans.push(validationOnlyPlan("activate_arena_daily", {
          dayId: daily.dayId,
          rulesCatalog: args.snapshot.rulesCatalog,
          preactivation: true,
          catalogStartsDay: args.snapshot.catalogStartsDay,
          poolEntryCount: poolCount,
        }));
      } else if (daily.dayId >= oldestKeeperDay && daily.dayId < today &&
          daily.predecessorRolloverApplied &&
          args.nowUnix >= daily.recoveryDeadlineAt) {
        plans.push(validationOnlyPlan("activate_arena_daily", {
          dayId: daily.dayId,
          rulesCatalog: args.snapshot.rulesCatalog,
          predecessorRolloverApplied: true,
          recoveryActivation: true,
          recoveryDeadlineAt: daily.recoveryDeadlineAt,
        }));
      }
    }
  }

  const missingDay = args.snapshot.poolEntries.length === 0
    ? undefined
    : firstMissingScheduledCadence(
      Math.max(args.snapshot.launchDayId, args.snapshot.catalogStartsDay),
      nextScheduledDaily(
        today,
        args.snapshot.catalogStartsDay,
        args.snapshot.poolEntries.length,
      ),
      dailyById,
      args.snapshot.catalogStartsDay,
      args.snapshot.poolEntries.length,
    );
  if (missingDay !== undefined && missingDay > args.snapshot.launchDayId &&
      missingDay >= oldestKeeperDay) {
    const content = dailyContentSelection(
      args.snapshot.selectionSeed,
      args.snapshot.catalogStartsDay,
      missingDay,
      args.snapshot.poolEntries.length,
    );
    const entry = args.snapshot.poolEntries[content.poolIndex];
    if (!entry) throw new Error("Daily pool selection is outside the published catalog");
    const predecessor = [...dailyById.keys()]
      .filter((dayId) => dayId < missingDay)
      .sort((left, right) => right - left)[0] ?? missingDay - 1;
    plans.push(validationOnlyPlan("prepare_arena_daily", {
      dayId: predecessor,
      followingDayId: missingDay,
      launchCadenceId: args.snapshot.launchDayId,
      rulesCatalog: args.snapshot.rulesCatalog,
      contentVersion: args.snapshot.contentVersion,
      selectionSeed: args.snapshot.selectionSeed,
      catalogStartsDay: args.snapshot.catalogStartsDay,
      poolEntryCount: args.snapshot.poolEntries.length,
      poolIndex: content.poolIndex,
      poolEntries: args.snapshot.poolEntries,
      realmMapId: entry.realmMapId,
      passiveMapId: entry.passiveMapId,
      cadenceFunding: cadenceFundingPda(),
    }));
  }

  for (const run of args.snapshot.runs) {
    if (run.mode === "campaign" ||
        (run.challengeDayId !== undefined && run.challengeDayId >= oldestKeeperDay)) {
      appendRunPlan(plans, run, args.nowUnix);
    }
  }

  for (const daily of args.snapshot.dailies) {
    if (daily.dayId < oldestKeeperDay || isQuarantined(daily.dayId)) continue;
    const resolved = daily.entriesScored + daily.entriesExpired;
    appendFinalizationPlan(
      plans,
      daily,
      args.nowUnix >= daily.runsCloseAt && resolved === daily.entriesPaid &&
        (!daily.predecessorRolloverRequired || daily.predecessorRolloverApplied),
      [...dailyById.keys()]
        .filter((dayId) => dayId > daily.dayId)
        .sort((left, right) => left - right)[0],
    );
    appendBoardConstructionPlans(plans, daily);
    appendProfileSyncPlans(plans, daily, playerStateOwners);
  }

  for (const candidate of args.snapshot.arenaPlayerClosures) {
    if (candidate.dayId < oldestKeeperDay || isQuarantined(candidate.dayId)) continue;
    plans.push(validationOnlyPlan("close_arena_player", {
      dayId: candidate.dayId,
      competition: "daily",
      owner: candidate.owner,
      rentRecipient: candidate.rentRecipient,
    }));
  }

  return {
    plans: plans.filter((plan) => !planTouchesQuarantine(plan, quarantines)),
    quarantines,
  };
}

function appendBoardConstructionPlans(
  plans: KeeperInstructionPlan[],
  daily: DailySnapshot,
): void {
  if (daily.status !== "finalized") return;
  for (const kind of ["score", "theme"] as const) {
    const board = kind === "score" ? daily.scoreBoard : daily.themeBoard;
    const sources = kind === "score" ? daily.scoreSources : daily.themeSources;
    if (!board || board.sealed || !sources) continue;
    const entries = sources.slice(
      board.cursor,
      Math.min(board.payoutCount, board.cursor + ARENA_BOARD_CHUNK_CAPACITY),
    );
    if (entries.length === 0) {
      throw new Error(`${kind} board cannot advance to its computed width`);
    }
    plans.push(validationOnlyPlan("submit_arena_board_chunk", {
      competition: "daily",
      dayId: daily.dayId,
      boardKind: kind,
      boardCursor: board.cursor,
      boardPayoutCount: board.payoutCount,
      boardEntries: entries,
      sealBoard: board.cursor + entries.length === board.payoutCount,
    }));
  }
}

export function discoverReconciliationPlans(args: {
  snapshot: ProtocolSnapshot;
  nowUnix: number;
}): KeeperInstructionPlan[] {
  return discoverReconciliation(args).plans;
}

function appendCadenceArchivePlan(
  plans: KeeperInstructionPlan[],
  snapshot: ProtocolSnapshot,
  today: number,
  nowUnix: number,
  isQuarantined: (id: number) => boolean,
): void {
  const state = snapshot.archiveState;
  if (!state) return;
  const ordered = [...(snapshot.archiveCandidates ?? [])]
    .sort((left, right) => left.cadenceId - right.cadenceId);
  const nextArchiveId = state.lastDailyId === undefined ||
      state.lastDailyId < snapshot.launchDayId
    ? snapshot.launchDayId
    : ordered.find(({ cadenceId }) => cadenceId > state.lastDailyId!)?.cadenceId;
  const contextFor = (candidate: CadenceArchiveCandidate) => ({
    competition: "daily" as const,
    dayId: candidate.cadenceId,
    previousCadenceId: state.lastDailyId,
    archiveFirstCadenceId: state.firstDailyId,
    archiveCurrentRoot: state.dailyRoot,
    cadenceFunding: state.cadenceFunding,
    arcadeArchive: state.address,
    archiveCanonicalJson: candidate.canonicalJson,
    archiveFileSha256: candidate.fileSha256,
    archiveResultHash: candidate.resultHash,
    archiveCommitted: candidate.committed,
    claimsExpired: candidate.claimsExpired,
    requiredScoreProfileSyncMask: candidate.requiredScoreProfileSyncMask,
    requiredThemeProfileSyncMask: candidate.requiredThemeProfileSyncMask,
    closeEligibleAt: candidate.closeEligibleAt,
  });
  const nextArchive = ordered.find((candidate) =>
    !candidate.committed && candidate.cadenceId === nextArchiveId
  );
  if (nextArchive && nextArchive.cadenceId <= today &&
      !isQuarantined(nextArchive.cadenceId)) {
    plans.push(validationOnlyPlan(
      "archive_arena_daily",
      contextFor(nextArchive),
    ));
  }

  for (const candidate of ordered) {
    if (!candidate.committed || candidate.cadenceId > today ||
        isQuarantined(candidate.cadenceId)) continue;
    const context = contextFor(candidate);
    if (!candidate.claimsExpired && nowUnix >= candidate.closeEligibleAt) {
      if (snapshot.poolEntries.length === 0) continue;
      const followingDayId = nextScheduledDaily(
        today,
        snapshot.catalogStartsDay,
        snapshot.poolEntries.length,
      );
      const following = snapshot.dailies.find(({ dayId }) => dayId === followingDayId);
      const daily = snapshot.dailies.find(({ dayId }) => dayId === candidate.cadenceId);
      if ((following?.status === "funding" || following?.status === "open") &&
          daily?.settlement) {
        plans.push(validationOnlyPlan("expire_daily_claims", {
          ...context,
          followingDayId,
          rulesCatalog: snapshot.rulesCatalog,
          catalogStartsDay: snapshot.catalogStartsDay,
          poolEntryCount: snapshot.poolEntries.length,
          claimCloseAt: candidate.closeEligibleAt,
          unclaimedLamports: unclaimedPayoutLamports(daily),
        }));
      }
    } else if (candidate.closeEligible) {
      plans.push(validationOnlyPlan("close_arena_daily", context));
    }
  }
}

function appendRunPlan(
  plans: KeeperInstructionPlan[],
  run: RunSnapshot,
  nowUnix: number,
): void {
  const inProgress = ["prepared", "delegated", "awaiting_vrf", "playing"]
    .includes(run.lifecycle);
  const forceFinishEligible = ["delegated", "awaiting_vrf", "playing"]
    .includes(run.lifecycle);
  const context = {
    challengeDayId: run.challengeDayId,
    deadlineDayId: run.deadlineDayId,
    owner: run.owner,
    runId: run.runId,
    runMode: run.mode,
    runLocation: run.location,
    includeArenaPlayer: run.arenaPlayerExists,
    deadlineAt: run.runsCloseAt,
    recoveryDeadlineAt: run.recoveryDeadlineAt,
  } as const;

  if (run.mode === "ranked" && forceFinishEligible &&
      run.location === "ephemeral_rollup" && run.runsCloseAt !== undefined &&
      nowUnix >= run.runsCloseAt) {
    plans.push(validationOnlyPlan("force_finish_deadline", context));
    return;
  }
  if (run.mode === "ranked" && run.reservationActive &&
      (inProgress || run.lifecycle === "unavailable") &&
      run.recoveryDeadlineAt !== undefined && nowUnix >= run.recoveryDeadlineAt) {
    plans.push(validationOnlyPlan("expire_unresolved_arena_run", {
      ...context,
      includeArenaPlayer: true,
    }));
    return;
  }
  if (run.lifecycle === "terminal" && run.location === "ephemeral_rollup") {
    plans.push(validationOnlyPlan("commit_run", context));
    return;
  }
  if (run.reservationActive && run.lifecycle === "terminal" && run.location === "base") {
    plans.push(validationOnlyPlan(
      run.mode === "campaign" ? "consume_campaign_run" : "consume_arena_run",
      context,
    ));
    return;
  }
  if (!run.reservationActive && run.location === "base" &&
      run.recoveryDeadlineAt !== undefined && nowUnix >= run.recoveryDeadlineAt) {
    plans.push(validationOnlyPlan("cleanup_orphan_active_run", context));
  }
}

export function validateProtocolSnapshot(snapshot: ProtocolSnapshot): void {
  if (typeof snapshot.paused !== "boolean") {
    throw new Error("protocol pause state is invalid");
  }
  if (!(snapshot.rulesCatalog instanceof PublicKey) ||
      snapshot.rulesCatalog.equals(PublicKey.default)) {
    throw new Error("rules catalog identity is invalid");
  }
  assertCadenceId(snapshot.launchDayId, "launch day id");
  assertCadenceId(snapshot.contentVersion, "content version");
  assertCadenceId(snapshot.catalogStartsDay, "catalog start day");
  if (snapshot.contentVersion === 0 || snapshot.selectionSeed.length !== 32 ||
      snapshot.selectionSeed.some((byte, index) =>
        byte !== DAILY_POOL_SELECTION_SEED[index]) ||
      snapshot.poolEntries.length > DAILY_POOL_CAPACITY || snapshot.poolEntries.some((entry) =>
        !Number.isSafeInteger(entry.realmMapId) || entry.realmMapId < 0 ||
        entry.realmMapId > 32 || !Number.isSafeInteger(entry.passiveMapId) ||
        entry.passiveMapId < 1 || entry.passiveMapId > 32)) {
    throw new Error("Daily content catalog or launch day is invalid");
  }
  assertUnique(snapshot.dailies.map(({ dayId }) => dayId), "Daily id");
  assertUnique(snapshot.runs.map(({ owner, runId }) => `${owner.toBase58()}:${runId}`), "run");
  assertUnique(snapshot.playerStateOwners.map((owner) => owner.toBase58()), "PlayerState owner");
  assertUnique(
    snapshot.arenaPlayerClosures.map(({ dayId, owner }) => `${dayId}:${owner.toBase58()}`),
    "ArenaPlayer closure",
  );
  validateArchiveSnapshot(snapshot);

  for (const daily of snapshot.dailies) {
    assertCadenceId(daily.dayId, "day id");
    assertSafeTimestamp(daily.runsCloseAt);
    assertSafeTimestamp(daily.recoveryDeadlineAt);
    assertSafeTimestamp(daily.finalizedAt);
    const start = daily.dayId * SECONDS_PER_DAY;
    if (daily.runsCloseAt !== start + DAILY_RUN_CLOSE_OFFSET ||
        daily.recoveryDeadlineAt !== start + DAILY_RECOVERY_DEADLINE_OFFSET) {
      throw new Error("Daily timing does not match its cadence id");
    }
    validatePredecessorFlag(
      daily.dayId !== snapshot.launchDayId,
      daily.predecessorRolloverRequired,
      "Daily",
    );
    for (const [label, amount] of Object.entries({
      entriesPaid: daily.entriesPaid,
      entriesScored: daily.entriesScored,
      entriesExpired: daily.entriesExpired,
      pot: daily.potLamports,
    })) assertLamports(amount, `Daily ${label}`);
    if (daily.entriesScored + daily.entriesExpired > daily.entriesPaid) {
      throw new Error("Daily resolved entries exceed paid entries");
    }
    for (const [label, count] of Object.entries({
      scoreQualifiedPlayers: daily.scoreQualifiedPlayers,
      themeQualifiedPlayers: daily.themeQualifiedPlayers,
    })) assertCadenceId(count, `Daily ${label}`);
    if (!["funding", "open", "finalized"].includes(daily.status)) {
      throw new Error("Daily status is invalid");
    }
    if ((daily.status === "finalized") !== (daily.finalizedAt > 0) ||
        typeof daily.claimsExpired !== "boolean" ||
        (daily.claimsExpired && daily.status !== "finalized") ||
        !validPayoutMask(daily.scoreClaimedMask) ||
        !validPayoutMask(daily.themeClaimedMask)) {
      throw new Error("Daily claim state is invalid");
    }
    if (daily.status === "finalized") {
      for (const [label, board] of [
        ["Score", daily.scoreBoard],
        ["Theme", daily.themeBoard],
      ] as const) {
        if (!board || board.payoutCount > ARENA_BOARD_CAPACITY ||
            board.cursor > board.payoutCount ||
            board.sealed !== (board.cursor === board.payoutCount) ||
            board.claimedCount > board.payoutCount ||
            board.profileSyncCount > board.payoutCount) {
          throw new Error(`Daily ${label} board construction is invalid`);
        }
      }
    } else if (daily.scoreBoard || daily.themeBoard) {
      throw new Error("non-finalized Daily has payout board accounts");
    }
  }
  for (const run of snapshot.runs) validateRun(snapshot, run);
  validateParticipantClosures(snapshot);
}

function collectDomainQuarantines(snapshot: ProtocolSnapshot): DomainQuarantine[] {
  const quarantines: DomainQuarantine[] = [];
  for (const daily of snapshot.dailies) {
    try {
      if (daily.status === "finalized" &&
          daily.entriesScored + daily.entriesExpired !== daily.entriesPaid) {
        throw new Error("finalized Daily retains unresolved paid entries");
      }
      validateSettlement(
        daily.potLamports,
        daily.scoreQualifiedPlayers,
        daily.themeQualifiedPlayers,
        daily.settlement,
      );
      validateProfileSyncMask(
        "score",
        daily.scoreProfileSyncMask,
        daily.settlement,
      );
      validateProfileSyncMask(
        "theme",
        daily.themeProfileSyncMask,
        daily.settlement,
      );
      validateClaimMask("score", daily.scoreClaimedMask, daily.settlement);
      validateClaimMask("theme", daily.themeClaimedMask, daily.settlement);
    } catch (error) {
      quarantines.push({
        kind: "daily",
        id: daily.dayId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return quarantines;
}

function planTouchesQuarantine(
  plan: KeeperInstructionPlan,
  quarantines: readonly DomainQuarantine[],
): boolean {
  if (plan.operation.startsWith("prepare_") || plan.operation.startsWith("activate_")) {
    return false;
  }
  if (!plan.context || plan.context.runMode === "campaign") return false;
  return quarantines.some(({ id }) =>
    plan.context?.dayId === id || plan.context?.challengeDayId === id);
}

function validateArchiveSnapshot(snapshot: ProtocolSnapshot): void {
  const candidates = snapshot.archiveCandidates ?? [];
  const state = snapshot.archiveState;
  if (candidates.length === 0 && !state) return;
  if (!state || !state.address.equals(arcadeArchivePda()) ||
      !state.cadenceFunding.equals(cadenceFundingPda()) ||
      !Number.isSafeInteger(state.firstDailyId) || state.firstDailyId < 0 ||
      !/^[0-9a-f]{64}$/.test(state.dailyRoot)) {
    throw new Error("Arcade archive or cadence funding identity is invalid");
  }
  if (state.lastDailyId !== undefined) {
    assertCadenceId(state.lastDailyId, "last archived Daily id");
  }
  assertUnique(candidates.map(({ cadenceId }) => cadenceId), "cadence archive");
  for (const candidate of candidates) {
    assertCadenceId(candidate.cadenceId, "archive cadence id");
    if (candidate.competition !== "daily" ||
        !/^[0-9a-f]{64}$/.test(candidate.resultHash) ||
        (candidate.committed
          ? candidate.canonicalJson !== undefined || candidate.fileSha256 !== undefined
          : candidate.canonicalJson === undefined ||
            !/^[0-9a-f]{64}$/.test(candidate.fileSha256 ?? ""))) {
      throw new Error("cadence archive identity or hashes are invalid");
    }
    if (candidate.canonicalJson !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(candidate.canonicalJson);
      } catch {
        throw new Error("cadence archive JSON is invalid");
      }
      if (JSON.stringify(sortJson(parsed)) !== candidate.canonicalJson) {
        throw new Error("cadence archive JSON is not canonical");
      }
    }
    const daily = snapshot.dailies.find(({ dayId }) => dayId === candidate.cadenceId);
    if (!daily || daily.status !== "finalized" ||
        !validPayoutMask(candidate.requiredScoreProfileSyncMask) ||
        !validPayoutMask(candidate.requiredThemeProfileSyncMask) ||
        typeof candidate.claimsExpired !== "boolean") {
      throw new Error("cadence archive candidate is not terminal");
    }
    assertSafeTimestamp(candidate.closeEligibleAt);
    if (candidate.closeEligibleAt !==
        daily.finalizedAt + DAILY_REWARD_CLAIM_WINDOW_SECONDS) {
      throw new Error("Daily archive claim-close time is invalid");
    }
    if (candidate.closeEligible && (!candidate.committed ||
        !candidate.claimsExpired ||
        daily.scoreProfileSyncMask !== candidate.requiredScoreProfileSyncMask ||
        daily.themeProfileSyncMask !== candidate.requiredThemeProfileSyncMask)) {
      throw new Error("uncommitted cadence archive cannot be close eligible");
    }
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]));
  }
  return value;
}

function validateRun(snapshot: ProtocolSnapshot, run: RunSnapshot): void {
  if (!(run.owner instanceof PublicKey) || run.owner.equals(PublicKey.default)) {
    throw new Error("run owner is invalid");
  }
  if (run.runId < 1n || run.runId > 0xffff_ffff_ffff_ffffn) {
    throw new Error("run id is invalid");
  }
  if (!Number.isSafeInteger(run.acceptedActions) || run.acceptedActions < 0 ||
      run.acceptedActions > 0xffff_ffff) {
    throw new Error("run accepted-action count is invalid");
  }
  if (run.mode === "campaign") {
    if (run.challengeDayId !== undefined || run.deadlineDayId !== undefined ||
        run.arenaPlayerExists || run.runsCloseAt !== undefined ||
        run.recoveryDeadlineAt !== undefined) {
      throw new Error("Campaign run carries ranked cadence state");
    }
    return;
  }
  if (run.mode !== "ranked" || run.challengeDayId === undefined ||
      run.deadlineDayId !== run.challengeDayId) {
    throw new Error("ranked run cadence is invalid");
  }
  assertCadenceId(run.challengeDayId, "run challenge day");
  const daily = snapshot.dailies.find(({ dayId }) => dayId === run.challengeDayId);
  if (!daily || run.runsCloseAt !== daily.runsCloseAt ||
      run.recoveryDeadlineAt !== daily.recoveryDeadlineAt ||
      !run.arenaPlayerExists) {
    throw new Error("ranked run does not match its Daily");
  }
}

function validateParticipantClosures(snapshot: ProtocolSnapshot): void {
  for (const closure of snapshot.arenaPlayerClosures) {
    assertCadenceId(closure.dayId, "ArenaPlayer closure day");
    validateClosureRecipient(closure.owner, closure.rentRecipient, "ArenaPlayer");
    const daily = snapshot.dailies.find(({ dayId }) => dayId === closure.dayId);
    const candidate = snapshot.archiveCandidates?.find(({ cadenceId }) =>
      cadenceId === closure.dayId);
    if (!daily || daily.status !== "finalized" || !candidate?.committed) {
      throw new Error("ArenaPlayer closure is not archive eligible");
    }
  }
}

function validateClosureRecipient(
  owner: PublicKey,
  rentRecipient: PublicKey,
  label: string,
): void {
  if (!(owner instanceof PublicKey) || owner.equals(PublicKey.default) ||
      !rentRecipient.equals(playerFundingPda(owner))) {
    throw new Error(`${label} closure rent recipient is not canonical`);
  }
}

function appendFinalizationPlan(
  plans: KeeperInstructionPlan[],
  daily: DailySnapshot,
  ready: boolean,
  successorDayId: number | undefined,
): void {
  if (!ready || daily.status !== "open" || !daily.settlement ||
      successorDayId === undefined) return;
  const payoutTotal = daily.settlement.winners
    .reduce((sum, winner) => sum + winner.payoutLamports, 0n);
  plans.push(validationOnlyPlan("finalize_arena_daily", {
    competition: "daily",
    dayId: daily.dayId,
    followingDayId: successorDayId,
    scorePayoutCount: daily.settlement.winners
      .filter(({ board }) => board === "score").length,
    themePayoutCount: daily.settlement.winners
      .filter(({ board }) => board === "theme").length,
    scoreCapacityLimited: daily.settlement.scoreCapacityLimited,
    themeCapacityLimited: daily.settlement.themeCapacityLimited,
    payoutTotalLamports: payoutTotal,
    potLamports: payoutTotal + daily.settlement.rolloverLamports,
    rolloverLamports: daily.settlement.rolloverLamports,
    cadenceFunding: cadenceFundingPda(),
  }));
}

function appendProfileSyncPlans(
  plans: KeeperInstructionPlan[],
  daily: DailySnapshot,
  playerStateOwners: ReadonlySet<string>,
): void {
  if (daily.status !== "finalized" || !daily.settlement ||
      !daily.scoreBoard?.sealed || !daily.themeBoard?.sealed) return;
  for (const board of ["score", "theme"] as const) {
    const syncedMask = board === "score"
      ? daily.scoreProfileSyncMask
      : daily.themeProfileSyncMask;
    for (const winner of daily.settlement.winners) {
      if (winner.board !== board || winner.payoutLamports === 0n ||
          !playerStateOwners.has(winner.owner.toBase58())) continue;
      const bit = winnerPositionBit(winner);
      if ((syncedMask & bit) !== 0n) continue;
      plans.push(validationOnlyPlan("sync_daily_profile", {
        competition: "daily",
        boardKind: board,
        dayId: daily.dayId,
        owner: winner.owner,
        winnerPositionMask: bit,
      }));
    }
  }
}

function validateProfileSyncMask(
  board: DailyBoardKind,
  syncedMask: bigint,
  settlement: SettlementSnapshot | undefined,
): void {
  if (!validPayoutMask(syncedMask)) {
    throw new Error("daily profile sync mask is invalid");
  }
  if (syncedMask === 0n) return;
  if (!settlement) {
    throw new Error("daily profile sync mask has no finalized settlement");
  }
  const winnerMask = settlement.winners.reduce(
    (mask, winner) => winner.board === board && winner.payoutLamports > 0n
      ? mask | winnerPositionBit(winner)
      : mask,
    0n,
  );
  if ((syncedMask & ~winnerMask) !== 0n) {
    throw new Error("daily profile sync mask references a non-winner");
  }
}

function validateClaimMask(
  board: DailyBoardKind,
  claimedMask: bigint,
  settlement: SettlementSnapshot | undefined,
): void {
  if (!validPayoutMask(claimedMask)) {
    throw new Error("daily claim mask is invalid");
  }
  if (claimedMask === 0n) return;
  if (!settlement) throw new Error("daily claim mask has no finalized settlement");
  const winnerMask = settlement.winners.reduce(
    (mask, winner) => winner.board === board && winner.payoutLamports > 0n
      ? mask | winnerPositionBit(winner)
      : mask,
    0n,
  );
  if ((claimedMask & ~winnerMask) !== 0n) {
    throw new Error("daily claim mask references a non-winner");
  }
}

function winnerPositionBit(winner: WinnerSnapshot): bigint {
  return 1n << BigInt(winner.rank - 1);
}

function unclaimedPayoutLamports(daily: DailySnapshot): bigint {
  if (!daily.settlement) return 0n;
  return daily.settlement.winners.reduce((sum, winner) => {
    const claimedMask = winner.board === "score"
      ? daily.scoreClaimedMask
      : daily.themeClaimedMask;
    return (claimedMask & winnerPositionBit(winner)) === 0n
      ? sum + winner.payoutLamports
      : sum;
  }, 0n);
}

function validateSettlement(
  potLamports: bigint,
  scoreQualifiedPlayers: number,
  themeQualifiedPlayers: number,
  settlement: SettlementSnapshot | undefined,
): void {
  if (!settlement) return;
  if (settlement.winners.length > ARENA_BOARD_CAPACITY * 2) {
    throw new Error("daily has too many payout positions");
  }
  assertLamports(settlement.rolloverLamports, "daily rollover");
  const pools = dailyBoardPools(potLamports, themeQualifiedPlayers);
  let payouts = 0n;
  for (const board of ["score", "theme"] as const) {
    const ordered = settlement.winners
      .filter((winner) => winner.board === board)
      .sort((left, right) => left.rank - right.rank);
    assertUnique(ordered.map(({ owner }) => owner.toBase58()), `${board} board winner`);
    assertContiguousRanks(ordered);
    const qualified = board === "score" ? scoreQualifiedPlayers : themeQualifiedPlayers;
    const plan = rankWeightedPayoutPlan(
      pools[board],
      qualified,
      ARENA_BOARD_CAPACITY,
    );
    if (ordered.length !== plan.winnerCount) {
      throw new Error(`${board} winner count does not match the canonical board width`);
    }
    const limited = board === "score"
      ? settlement.scoreCapacityLimited
      : settlement.themeCapacityLimited;
    if (limited !== plan.capacityLimited) {
      throw new Error(`${board} capacity condition is not canonical`);
    }
    ordered.forEach((winner, index) => {
      assertPayoutLamports(winner.payoutLamports, `${board} payout`);
      if (winner.payoutLamports !== plan.payouts[index]) {
        throw new Error("winner payout does not match the canonical rank curve");
      }
      payouts += winner.payoutLamports;
    });
  }
  if (payouts + settlement.rolloverLamports !== potLamports) {
    throw new Error("daily payouts and rollover do not conserve the pot");
  }
}

function assertContiguousRanks(winners: readonly WinnerSnapshot[]): void {
  winners.forEach((winner, index) => {
    if (!Number.isSafeInteger(winner.rank) || winner.rank !== index + 1) {
      throw new Error("daily winner ranks are not contiguous");
    }
  });
}

function firstMissingScheduledCadence<T>(
  first: number,
  lastInclusive: number,
  values: ReadonlyMap<number, T>,
  startsDay: number,
  entryCount: number,
): number | undefined {
  for (let id = first; id <= lastInclusive; id += 1) {
    if (!dailyIsScheduled(id, startsDay, entryCount)) continue;
    if (!values.has(id)) return id;
  }
  return undefined;
}

function validPayoutMask(mask: bigint): boolean {
  const maximumMask = (1n << BigInt(ARENA_BOARD_CAPACITY)) - 1n;
  return mask >= 0n && mask <= maximumMask;
}

function validatePredecessorFlag(expected: boolean, actual: boolean, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} predecessor rollover requirement is invalid`);
  }
}

function assertUnique(values: readonly (number | string)[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} values are not unique`);
  }
}
