import { PublicKey, type TransactionInstruction } from "@solana/web3.js";

export const ZKUBE_PROGRAM_ID = new PublicKey(
  "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd",
);
export const PROTOCOL_ACCOUNT_VERSION = 1;
export const ARCADE_ACCOUNT_VERSION = 2;
export const SECONDS_PER_DAY = 86_400;
export const DAYS_PER_WEEK = 7;
export const DAYS_PER_SEASON = 28;
export const DAILY_ENTRY_CLOSE_OFFSET = 23 * 60 * 60;
export const DAILY_RUN_CLOSE_OFFSET = 23 * 60 * 60 + 30 * 60;
export const RUN_RECOVERY_SECONDS = 6 * 60 * 60;
export const DAILY_RECOVERY_DEADLINE_OFFSET =
  DAILY_RUN_CLOSE_OFFSET + RUN_RECOVERY_SECONDS;
export const PERIOD_SETTLEMENT_DELAY_SECONDS =
  DAILY_RUN_CLOSE_OFFSET + RUN_RECOVERY_SECONDS - SECONDS_PER_DAY;
/** Recurring authority covers at most the trailing three 28-day Seasons. */
export const KEEPER_RECENT_DAILY_CADENCES = 84;
export const KEEPER_RECENT_WEEKLY_CADENCES = 12;
export const KEEPER_RECENT_SEASON_CADENCES = 3;
export const ARENA_ENTRY_LAMPORTS = 20_000_000n;
export const SOL_PAYOUT_UNIT_LAMPORTS = 1_000_000n;
export const ENTRY_SPLIT_LAMPORTS = Object.freeze({
  followingDaily: 12_000_000n,
  followingWeekly: 4_000_000n,
  followingSeason: 2_000_000n,
  operator: 2_000_000n,
});

export type KeeperOperation =
  | "prepare_arena_daily"
  | "prepare_weekly_jackpot"
  | "prepare_season"
  | "activate_arena_daily"
  | "activate_weekly_jackpot"
  | "activate_season"
  | "force_finish_deadline"
  | "commit_run"
  | "consume_campaign_run"
  | "consume_arena_run"
  | "consume_practice_run"
  | "expire_unresolved_arena_run"
  | "cleanup_orphan_active_run"
  | "initialize_season_player"
  | "rollup_arena_to_season"
  | "seal_arena_season_rollups"
  | "finalize_arena_daily"
  | "finalize_weekly_jackpot"
  | "finalize_season"
  | "revoke_expired_session";

export type CompetitionKind = "daily" | "weekly" | "season";
export type RunMode = "campaign" | "ranked" | "practice";
export type RunLocation = "base" | "ephemeral_rollup" | "unavailable";

export interface KeeperPlanContext {
  dayId?: number;
  challengeDayId?: number;
  deadlineDayId?: number;
  followingDayId?: number;
  finalDayId?: number;
  weekId?: number;
  followingWeekId?: number;
  seasonId?: number;
  followingSeasonId?: number;
  competition?: CompetitionKind;
  rulesCatalog?: PublicKey;
  launchCadenceId?: number;
  owner?: PublicKey;
  owners?: readonly PublicKey[];
  runId?: bigint;
  runMode?: RunMode;
  runLocation?: RunLocation;
  includeArenaPlayer?: boolean;
  predecessorRolloverApplied?: boolean;
  recoveryActivation?: boolean;
  sealedDailies?: number;
  deadlineAt?: number;
  recoveryDeadlineAt?: number;
  potLamports?: bigint;
  payoutLamports?: readonly bigint[];
  payoutTotalLamports?: bigint;
  rolloverLamports?: bigint;
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

/** Monday-aligned week 0 starts on 1970-01-05. */
export function weekIdForDay(dayId: number): number {
  assertCadenceId(dayId, "day id");
  if (dayId < 4) throw new Error("week cadence predates Monday epoch");
  return Math.floor((dayId - 4) / DAYS_PER_WEEK);
}

export function weekStartDay(weekId: number): number {
  assertCadenceId(weekId, "week id");
  return checkedCadenceProduct(weekId, DAYS_PER_WEEK, 4, "week start day");
}

/** Monday-aligned 28-day Season 0 starts on 1970-01-05. */
export function seasonIdForDay(dayId: number): number {
  assertCadenceId(dayId, "day id");
  if (dayId < 4) throw new Error("Season cadence predates Monday epoch");
  return Math.floor((dayId - 4) / DAYS_PER_SEASON);
}

export function seasonStartDay(seasonId: number): number {
  assertCadenceId(seasonId, "season id");
  return checkedCadenceProduct(seasonId, DAYS_PER_SEASON, 4, "Season start day");
}

export function fundingPeriodsForDay(dayId: number) {
  assertCadenceId(dayId, "day id");
  const weekId = weekIdForDay(dayId);
  const seasonId = seasonIdForDay(dayId);
  if (dayId === 0xffff_ffff || weekId === 0xffff_ffff || seasonId === 0xffff_ffff) {
    throw new Error("following cadence overflows u32");
  }
  return Object.freeze({
    qualificationDayId: dayId,
    qualificationWeekId: weekId,
    qualificationSeasonId: seasonId,
    dailyFundingDayId: dayId + 1,
    weeklyFundingWeekId: weekId + 1,
    seasonFundingSeasonId: seasonId + 1,
  });
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
export const rulesCatalogPda = (version: number) =>
  derivePda("daily_rules", u32(version));
export const arenaDailyPda = (dayId: number) =>
  derivePda("arena_daily", u32(dayId));
export const weeklyJackpotPda = (weekId: number) =>
  derivePda("weekly_jackpot", u32(weekId));
export const seasonPda = (seasonId: number) =>
  derivePda("season", u32(seasonId));
export const playerStatePda = (owner: PublicKey) =>
  derivePda("player", owner.toBytes());
export const playerFundingPda = (owner: PublicKey) =>
  derivePda("player_funding", owner.toBytes());
export const arenaPlayerPda = (daily: PublicKey, owner: PublicKey) =>
  derivePda("arena_player", daily.toBytes(), owner.toBytes());
export const seasonPlayerPda = (season: PublicKey, owner: PublicKey) =>
  derivePda("season_player", season.toBytes(), owner.toBytes());
export const activeRunPda = (owner: PublicKey, runId: bigint) =>
  derivePda("run", Buffer.from("active"), owner.toBytes(), u64(runId));

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

function checkedCadenceProduct(
  id: number,
  multiplier: number,
  offset: number,
  label: string,
): number {
  const value = id * multiplier + offset;
  if (!Number.isSafeInteger(value) || value > 0xffff_ffff) {
    throw new Error(`${label} is outside u32`);
  }
  return value;
}
