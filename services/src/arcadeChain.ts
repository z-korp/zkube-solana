import { PublicKey, type TransactionInstruction } from "@solana/web3.js";

import {
  DAILY_PAIR_COUNT,
  ARENA_BOARD_CAPACITY,
  ARENA_BOARD_CHUNK_CAPACITY,
  ARENA_BOARD_ENTRY_SIZE,
  MAX_BOARD_RENT_LAMPORTS,
  DAILY_RUN_CLOSE_OFFSET,
  RUN_RECOVERY_SECONDS,
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
import { dayIdAt, dailyPair, dailyIsScheduled as coreDailyIsScheduled, nextScheduledDaily as coreNextScheduledDaily } from "./zkubeCore.js";

export {
  DAILY_PAIR_COUNT,
  ARENA_BOARD_CAPACITY,
  ARENA_BOARD_CHUNK_CAPACITY,
  ARENA_BOARD_ENTRY_SIZE,
  MAX_BOARD_RENT_LAMPORTS,
  DAILY_RUN_CLOSE_OFFSET,
  RUN_RECOVERY_SECONDS,
  ARENA_ENTRY_LAMPORTS,
  CATALOG_VERSION,
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
export const DAILY_RECOVERY_DEADLINE_OFFSET =
  DAILY_RUN_CLOSE_OFFSET + RUN_RECOVERY_SECONDS;
/** Recurring authority covers at most the trailing 84 Dailies. */
export const KEEPER_RECENT_DAILY_CADENCES = 84;
export const MIN_SUPPORTED_DAY_ID = 4;
export const ENTRY_SPLIT_LAMPORTS = Object.freeze({
  followingDaily: ENTRY_DAILY_LAMPORTS,
  operator: ENTRY_OPERATOR_LAMPORTS,
});

export const KEEPER_PLAN_INSTRUCTION = Object.freeze({
  prepare_arena_daily: { instruction: "prepare_arena_daily", connection: "base", priority: 0 },
  activate_arena_daily: { instruction: "activate_arena_daily", connection: "base", priority: 1 },
  skip_suspended_arena_daily: { instruction: "skip_suspended_arena_daily", connection: "base", priority: 2 },
  finalize_arena_daily: { instruction: "finalize_arena_daily", connection: "base", priority: 8 },
  submit_arena_board_chunk: { instruction: "submit_arena_board_chunk", connection: "base", priority: 9 },
  archive_arena_daily: { instruction: "archive_arena_daily", connection: "base", priority: 10 },
  expire_daily_claims: { instruction: "expire_daily_claims", connection: "base", priority: 11 },
  close_arena_daily: { instruction: "close_arena_daily", connection: "base", priority: 12 },
  close_arena_player: { instruction: "close_arena_player", connection: "base", priority: 14 },
  finish_run: { instruction: "finish_run", connection: "ephemeral-rollup", priority: 3 },
  commit_run: { instruction: "commit_run", connection: "ephemeral-rollup", priority: 4 },
  consume_arena_run: { instruction: "consume_arena_run", connection: "base", priority: 6 },
  expire_unresolved_arena_run: { instruction: "expire_unresolved_arena_run", connection: "base", priority: 7 },
} as const);

export type KeeperOperation = keyof typeof KEEPER_PLAN_INSTRUCTION;

export const KEEPER_INSTRUCTION_ALLOWLIST = Object.freeze(
  Object.values(KEEPER_PLAN_INSTRUCTION).map(({ instruction }) => instruction),
);

export type DailyBoardKind = "score" | "theme";
export type RunLocation = "base" | "ephemeral_rollup" | "unavailable";

export interface KeeperPlanContext {
  dayId?: number;
  challengeDayId?: number;
  deadlineDayId?: number;
  followingDayId?: number;
  suspendedUntilDay?: number;
  pairIndex?: number;
  realmMapId?: number;
  launchCadenceId?: number;
  owner?: PublicKey;
  runId?: bigint;
  runLocation?: RunLocation;
  includeArenaPlayer?: boolean;
  predecessorRolloverApplied?: boolean;
  preactivation?: boolean;
  deadlineAt?: number;
  recoveryDeadlineAt?: number;
  potLamports?: bigint;
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
  payoutTotalLamports?: bigint;
  rolloverLamports?: bigint;
  boardKind?: DailyBoardKind;
  rentRecipient?: PublicKey;
  cadenceFunding?: PublicKey;
  arcadeConfig?: PublicKey;
  parentDailyClosed?: boolean;
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
  return dayIdAt(BigInt(nowUnix));
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
export const creditVaultPda = () => derivePda("credit_vault");
export const cadenceFundingPda = () => derivePda("cadence_funding");
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
  return coreDailyIsScheduled(dayId, suspendedUntilDay);
}

export function nextScheduledDaily(
  dayId: number,
  suspendedUntilDay: number,
): number {
  assertCadenceId(dayId, "day id");
  assertCadenceId(suspendedUntilDay, "suspended-until day");
  return coreNextScheduledDaily(dayId, suspendedUntilDay);
}

export function dailyPairForDay(
  dayId: number,
): { pairIndex: number; realmMapId: number; objective: { kind: number; value: number } } {
  assertCadenceId(dayId, "day id");
  return dailyPair(dayId);
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
