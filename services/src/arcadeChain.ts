import { PublicKey, type TransactionInstruction } from "@solana/web3.js";

import {
  ARCADE_ACCOUNT_VERSION,
  ARENA_ENTRY_LAMPORTS,
  CATALOG_VERSION,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  ENTRY_DAILY_LAMPORTS,
  ENTRY_OPERATOR_LAMPORTS,
  PLAYER_STATE_ACCOUNT_VERSION,
  PLAYER_STATE_RESERVED_BYTES,
  PROTOCOL_ACCOUNT_VERSION,
  SECONDS_PER_DAY,
  SOL_PAYOUT_UNIT_LAMPORTS,
} from "./protocolVersions.generated.js";
import {
  DAILY_PAIR_COUNT,
  DAILY_PAIR_SELECTION_SEED,
  DAILY_THEMES,
} from "./dailyRules.generated.js";
import { dailyPairIndex as coreDailyPairIndex } from "./zkubeCore.js";

export {
  ARCADE_ACCOUNT_VERSION,
  ARENA_ENTRY_LAMPORTS,
  CATALOG_VERSION,
  DAILY_PAIR_COUNT,
  DAILY_PAIR_SELECTION_SEED,
  DAILY_REWARD_CLAIM_WINDOW_SECONDS,
  PLAYER_STATE_ACCOUNT_VERSION,
  PLAYER_STATE_RESERVED_BYTES,
  PROTOCOL_ACCOUNT_VERSION,
  SECONDS_PER_DAY,
  SOL_PAYOUT_UNIT_LAMPORTS,
};

export const ZKUBE_PROGRAM_ID = new PublicKey(
  "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd",
);
export const DAILY_RUN_CLOSE_OFFSET = 23 * 60 * 60 + 59 * 60;
export const RUN_RECOVERY_SECONDS = 6 * 60 * 60;
export const DAILY_RECOVERY_DEADLINE_OFFSET =
  DAILY_RUN_CLOSE_OFFSET + RUN_RECOVERY_SECONDS;
/** Recurring authority covers at most the trailing 84 Dailies. */
export const KEEPER_RECENT_DAILY_CADENCES = 84;
export const ARENA_BOARD_CAPACITY = 1_536;
export const ARENA_BOARD_CHUNK_CAPACITY = 10;
export const ARENA_BOARD_ENTRY_SIZE = 84;
export const ENTRY_SPLIT_LAMPORTS = Object.freeze({
  followingDaily: ENTRY_DAILY_LAMPORTS,
  operator: ENTRY_OPERATOR_LAMPORTS,
});

export const KEEPER_PLAN_INSTRUCTION = Object.freeze({
  prepare_arena_daily: "funded_prepare_arena_daily",
  activate_arena_daily: "activate_arena_daily",
  skip_suspended_arena_daily: "skip_suspended_arena_daily",
  finalize_arena_daily: "funded_finalize_arena_daily",
  submit_arena_board_chunk: "submit_arena_board_chunk",
  archive_arena_daily: "archive_arena_daily",
  expire_daily_claims: "expire_daily_claims",
  close_arena_daily: "close_arena_daily",
  finish_run: "finish_run",
  commit_run: "commit_run",
  consume_arena_run: "consume_arena_run",
  expire_unresolved_arena_run: "expire_unresolved_arena_run",
  cleanup_orphan_active_run: "cleanup_orphan_active_run",
} as const);

export type KeeperOperation = keyof typeof KEEPER_PLAN_INSTRUCTION;

export const KEEPER_INSTRUCTION_ALLOWLIST = Object.freeze(
  Object.values(KEEPER_PLAN_INSTRUCTION),
);

export type CompetitionKind = "daily";
export type DailyBoardKind = "score" | "theme";
export type RunMode = "ranked";
export type RunLocation = "base" | "ephemeral_rollup" | "unavailable";

export interface KeeperPlanContext {
  dayId?: number;
  challengeDayId?: number;
  deadlineDayId?: number;
  followingDayId?: number;
  competition?: CompetitionKind;
  suspendedUntilDay?: number;
  pairIndex?: number;
  realmMapId?: number;
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
  boardKind?: DailyBoardKind;
  rentRecipient?: PublicKey;
  cadenceFunding?: PublicKey;
  arcadeArchive?: PublicKey;
  archiveCommitted?: boolean;
  claimsExpired?: boolean;
  claimCloseAt?: number;
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
export const arenaDailyPda = (dayId: number) =>
  derivePda("arena_daily", u32(dayId));
export const arenaBoardPda = (daily: PublicKey, board: DailyBoardKind) =>
  derivePda("arena_board", daily.toBytes(), Buffer.from(board, "utf8"));
export const playerStatePda = (owner: PublicKey) =>
  derivePda("player", owner.toBytes());
export const arenaPlayerPda = (daily: PublicKey, owner: PublicKey) =>
  derivePda("arena_player", daily.toBytes(), owner.toBytes());
export const activeRunPda = (owner: PublicKey, runId: bigint) =>
  derivePda("run", Buffer.from("active"), owner.toBytes(), u64(runId));

export function dailyIsScheduled(
  dayId: number,
  suspendedUntilDay: number,
): boolean {
  assertCadenceId(dayId, "day id");
  assertCadenceId(suspendedUntilDay, "suspended-until day");
  return dayId >= suspendedUntilDay;
}

export function nextScheduledDaily(
  dayId: number,
  suspendedUntilDay: number,
): number {
  assertCadenceId(dayId, "day id");
  assertCadenceId(suspendedUntilDay, "suspended-until day");
  const candidate = Math.max(dayId + 1, suspendedUntilDay);
  assertCadenceId(candidate, "following scheduled day id");
  return candidate;
}

export function dailyContentSelection(
  dayId: number,
): { pairIndex: number; realmMapId: number; objective: { kind: number; value: number } } {
  assertCadenceId(dayId, "day id");
  const pairIndex = coreDailyPairIndex(dayId);
  return {
    pairIndex,
    realmMapId: Math.floor(pairIndex / DAILY_THEMES.length) + 1,
    objective: DAILY_THEMES[pairIndex % DAILY_THEMES.length]!,
  };
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
