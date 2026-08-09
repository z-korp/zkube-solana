import { createHash } from "node:crypto";

import { PublicKey, type TransactionInstruction } from "@solana/web3.js";

import {
  ARCADE_ACCOUNT_VERSION,
  ARENA_ENTRY_LAMPORTS,
  DAILY_POOL_CAPACITY,
  DAILY_POOL_SELECTION_SEED,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  ENTRY_DAILY_LAMPORTS,
  ENTRY_OPERATOR_LAMPORTS,
  PLAYER_STATE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION,
  RULES_ACCOUNT_VERSION,
  SECONDS_PER_DAY,
  SOL_PAYOUT_UNIT_LAMPORTS,
} from "./protocolVersions.generated.js";

export {
  ARCADE_ACCOUNT_VERSION,
  ARENA_ENTRY_LAMPORTS,
  DAILY_POOL_CAPACITY,
  DAILY_POOL_SELECTION_SEED,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  PLAYER_STATE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION,
  RULES_ACCOUNT_VERSION,
  SECONDS_PER_DAY,
  SOL_PAYOUT_UNIT_LAMPORTS,
};

export const ZKUBE_PROGRAM_ID = new PublicKey(
  "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd",
);
export const DAILY_ENTRY_CLOSE_OFFSET = 23 * 60 * 60 + 45 * 60;
export const DAILY_RUN_CLOSE_OFFSET = 23 * 60 * 60 + 59 * 60;
export const RUN_RECOVERY_SECONDS = 6 * 60 * 60;
export const DAILY_RECOVERY_DEADLINE_OFFSET =
  DAILY_RUN_CLOSE_OFFSET + RUN_RECOVERY_SECONDS;
/** Recurring authority covers at most the trailing 84 Dailies. */
export const KEEPER_RECENT_DAILY_CADENCES = 84;
export const ARENA_BOARD_CAPACITY = 1_536;
export const ARENA_BOARD_CHUNK_CAPACITY = 10;
export const ARENA_BOARD_ENTRY_SIZE = 84;
const DAILY_POOL_DRAW_DOMAIN = Buffer.from("zkube-daily-pool-draw-v2", "utf8");
export const ENTRY_SPLIT_LAMPORTS = Object.freeze({
  followingDaily: ENTRY_DAILY_LAMPORTS,
  operator: ENTRY_OPERATOR_LAMPORTS,
});

export type KeeperOperation =
  | "prepare_arena_daily"
  | "activate_arena_daily"
  | "force_finish_deadline"
  | "commit_run"
  | "consume_campaign_run"
  | "consume_arena_run"
  | "expire_unresolved_arena_run"
  | "cleanup_orphan_active_run"
  | "finalize_arena_daily"
  | "submit_arena_board_chunk"
  | "expire_daily_claims"
  | "sync_daily_profile"
  | "archive_arena_daily"
  | "close_arena_daily"
  | "close_arena_player"
  | "revoke_expired_session";

export type CompetitionKind = "daily";
export type DailyBoardKind = "score" | "theme";
export type RunMode = "campaign" | "ranked";
export type RunLocation = "base" | "ephemeral_rollup" | "unavailable";

export interface KeeperPlanContext {
  dayId?: number;
  challengeDayId?: number;
  deadlineDayId?: number;
  followingDayId?: number;
  competition?: CompetitionKind;
  rulesCatalog?: PublicKey;
  contentVersion?: number;
  selectionSeed?: Uint8Array;
  catalogStartsDay?: number;
  poolEntryCount?: number;
  poolIndex?: number;
  poolEntries?: readonly {
    realmMapId: number;
    passiveMapId: number;
  }[];
  realmMapId?: number;
  passiveMapId?: number;
  launchCadenceId?: number;
  owner?: PublicKey;
  runId?: bigint;
  runMode?: RunMode;
  runLocation?: RunLocation;
  includeArenaPlayer?: boolean;
  predecessorRolloverApplied?: boolean;
  recoveryActivation?: boolean;
  preactivation?: boolean;
  deadlineAt?: number;
  recoveryDeadlineAt?: number;
  potLamports?: bigint;
  scorePayoutCount?: number;
  themePayoutCount?: number;
  scoreCapacityLimited?: boolean;
  themeCapacityLimited?: boolean;
  boardCursor?: number;
  boardPayoutCount?: number;
  boardEntries?: readonly {
    source: PublicKey;
    score: number;
    objectiveTotal: bigint;
    finalizedAt: number;
    replayHash: Uint8Array;
  }[];
  sealBoard?: boolean;
  payoutTotalLamports?: bigint;
  rolloverLamports?: bigint;
  /** Canonical payout-position bits this profile sync is expected to consume. */
  winnerPositionMask?: bigint;
  boardKind?: DailyBoardKind;
  rentRecipient?: PublicKey;
  cadenceFunding?: PublicKey;
  arcadeArchive?: PublicKey;
  archiveFirstCadenceId?: number;
  previousCadenceId?: number;
  archiveCurrentRoot?: string;
  archiveCanonicalJson?: string;
  archiveFileSha256?: string;
  archiveResultHash?: string;
  archiveCommitted?: boolean;
  claimsExpired?: boolean;
  requiredScoreProfileSyncMask?: bigint;
  requiredThemeProfileSyncMask?: bigint;
  claimCloseAt?: number;
  unclaimedLamports?: bigint;
  closeEligibleAt?: number;
  sessionSigner?: PublicKey;
  sessionAddress?: PublicKey;
  sessionValidUntil?: number;
}

/**
 * Discovery produces relationship-checked semantic plans. Instruction bytes
 * and account metas are attached only by the exact checked-in Anchor-IDL
 * materializer, after keeper policy validation.
 */
export interface KeeperInstructionPlan {
  operation: KeeperOperation;
  execution: "validation_only" | "instruction";
  connection?: "base" | "ephemeral-rollup";
  context?: KeeperPlanContext;
  instruction?: TransactionInstruction;
  instructions?: readonly TransactionInstruction[];
}

export function validationOnlyPlan(
  operation: KeeperOperation,
  context: KeeperPlanContext,
): KeeperInstructionPlan {
  return { operation, execution: "validation_only", context };
}

export function currentDayId(nowUnix: number): number {
  assertSafeTimestamp(nowUnix);
  return Math.floor(nowUnix / SECONDS_PER_DAY);
}

export function assertCadenceId(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${label} is outside u32`);
  }
}

export function assertSafeTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("timestamp must be a non-negative safe integer");
  }
}

export function assertLamports(value: bigint, label: string): void {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`${label} is outside u64`);
  }
}

export function assertPayoutLamports(value: bigint, label: string): void {
  assertLamports(value, label);
  if (value % SOL_PAYOUT_UNIT_LAMPORTS !== 0n) {
    throw new Error(`${label} is not floored to 0.001 SOL`);
  }
}

export function derivePda(seed: string, ...parts: Uint8Array[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...parts.map((part) => Buffer.from(part))],
    ZKUBE_PROGRAM_ID,
  )[0];
}

export const protocolPda = () => derivePda("protocol");
export const arcadeConfigPda = () => derivePda("arcade");
export const operatorRevenuePda = () => derivePda("operator_revenue");
export const creditVaultPda = () => derivePda("credit_vault");
export const cadenceFundingPda = () => derivePda("cadence_funding");
export const arcadeArchivePda = () => derivePda("arcade_archive");
export const rulesCatalogPda = (version: number) =>
  derivePda("daily_rules", u32(version));
export const mapCatalogPda = (contentVersion: number, mapId: number) => {
  assertCadenceId(contentVersion, "content version");
  if (!Number.isSafeInteger(mapId) || mapId < 1 || mapId > 32) {
    throw new Error("map id is outside the supported range");
  }
  return derivePda("map", u32(contentVersion), Uint8Array.from([mapId]));
};
export const arenaDailyPda = (dayId: number) =>
  derivePda("arena_daily", u32(dayId));
export const arenaBoardPda = (daily: PublicKey, board: DailyBoardKind) =>
  derivePda("arena_board", daily.toBytes(), Buffer.from(board, "utf8"));
export const playerStatePda = (owner: PublicKey) =>
  derivePda("player", owner.toBytes());
export const playerFundingPda = (owner: PublicKey) =>
  derivePda("player_funding", owner.toBytes());
export const arenaPlayerPda = (daily: PublicKey, owner: PublicKey) =>
  derivePda("arena_player", daily.toBytes(), owner.toBytes());
export const activeRunPda = (owner: PublicKey, runId: bigint) =>
  derivePda("run", Buffer.from("active"), owner.toBytes(), u64(runId));

export function dailyIsScheduled(
  dayId: number,
  startsDay: number,
  entryCount: number,
): boolean {
  assertCadenceId(dayId, "day id");
  assertCadenceId(startsDay, "catalog start day");
  assertPoolEntryCount(entryCount);
  return entryCount > 0 && dayId >= startsDay;
}

export function nextScheduledDaily(
  dayId: number,
  startsDay: number,
  entryCount: number,
): number {
  assertCadenceId(dayId, "day id");
  assertPoolEntryCount(entryCount);
  if (entryCount === 0) throw new Error("no paid Daily is scheduled");
  const candidate = Math.max(dayId + 1, startsDay);
  assertCadenceId(candidate, "following scheduled day id");
  return candidate;
}

export function dailyContentSelection(
  selectionSeed: Uint8Array,
  startsDay: number,
  dayId: number,
  entryCount: number,
): { poolIndex: number } {
  if (selectionSeed.length !== 32) throw new Error("Daily selection seed must be 32 bytes");
  if (!dailyIsScheduled(dayId, startsDay, entryCount)) {
    throw new Error("no paid Daily is scheduled");
  }
  const pool = Array.from({ length: DAILY_POOL_CAPACITY }, (_, index) => index);
  const cycleIndex = Math.floor(dayId / entryCount);
  for (let index = entryCount - 1; index > 0; index -= 1) {
    const swap = Number(poolHashU64(selectionSeed, cycleIndex, index) % BigInt(index + 1));
    [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
  }
  return { poolIndex: pool[dayId % entryCount]! };
}

function poolHashU64(
  seed: Uint8Array,
  cycleIndex: number,
  index: number,
): bigint {
  const digest = createHash("sha256")
    .update(DAILY_POOL_DRAW_DOMAIN)
    .update(seed)
    .update(u32(cycleIndex))
    .update(Uint8Array.from([index]))
    .digest();
  return digest.readBigUInt64LE(0);
}

function assertPoolEntryCount(entryCount: number): void {
  if (!Number.isSafeInteger(entryCount) || entryCount < 0 || entryCount > DAILY_POOL_CAPACITY) {
    throw new Error("Daily pool entry count is invalid");
  }
}

export function u32(value: number): Buffer {
  assertCadenceId(value, "cadence id");
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

export function u64(value: bigint): Buffer {
  assertLamports(value, "u64 value");
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}
