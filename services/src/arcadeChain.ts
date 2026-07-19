import { createHash } from "node:crypto";

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
  type Connection,
} from "@solana/web3.js";

export const ZKUBE_PROGRAM_ID = new PublicKey(
  "Dz9RaTXpp4vadhBS6oT3RPLjqTT4M4RVwfpowjumSJyd",
);
export const V4_ACCOUNT_VERSION = 1;
export const SECONDS_PER_DAY = 86_400;
export const DAILY_ENTRY_CLOSE_OFFSET = 23 * 60 * 60;

export type KeeperOperation =
  | "open_weekly_jackpot"
  | "open_arena_daily"
  | "consume_terminal_run"
  | "expire_stuck_arena_entry"
  | "finalize_arena_daily"
  | "rollup_arena_to_weekly"
  | "finalize_weekly_jackpot"
  | "sync_daily_finish"
  | "sync_weekly_finish"
  | "close_arena_player"
  | "close_weekly_player"
  | "cleanup_resolved_run"
  | "revoke_expired_session";

export interface KeeperInstructionPlan {
  operation: KeeperOperation;
  instruction: TransactionInstruction;
  context?: {
    dayId?: number;
    weekId?: number;
    owner?: PublicKey;
    runId?: bigint;
    receiptRentRecipient?: PublicKey;
    sessionSigner?: PublicKey;
  };
}

export function currentDayId(nowUnix: number): number {
  return Math.max(0, Math.floor(nowUnix / SECONDS_PER_DAY));
}

export function weekIdForDay(dayId: number): number {
  return Math.max(0, Math.floor((dayId + 3) / 7));
}

export function weekStartDay(weekId: number): number {
  return weekId * 7 - 3;
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
export const playerStatePda = (owner: PublicKey) =>
  derivePda("player", owner.toBytes());
export const playerFundingPda = (owner: PublicKey) =>
  derivePda("player_funding", owner.toBytes());
export const arenaPlayerPda = (daily: PublicKey, owner: PublicKey) =>
  derivePda("arena_player", daily.toBytes(), owner.toBytes());
export const weeklyPlayerPda = (weekly: PublicKey, owner: PublicKey) =>
  derivePda("weekly_player", weekly.toBytes(), owner.toBytes());
export const activeRunPda = (owner: PublicKey, runId: bigint) =>
  derivePda("run", Buffer.from("active"), owner.toBytes(), u64(runId));
export const runResolutionPda = (
  daily: PublicKey,
  owner: PublicKey,
  runId: bigint,
) => derivePda("run_resolution", daily.toBytes(), owner.toBytes(), u64(runId));

export async function discoverOpeningPlans(args: {
  connection: Connection;
  keeper: PublicKey;
  nowUnix: number;
  rulesVersion: number;
}): Promise<KeeperInstructionPlan[]> {
  const dayId = currentDayId(args.nowUnix);
  const weekId = weekIdForDay(dayId);
  const daily = arenaDailyPda(dayId);
  const weekly = weeklyJackpotPda(weekId);
  const [weeklyInfo, dailyInfo] = await args.connection.getMultipleAccountsInfo(
    [weekly, daily],
    "confirmed",
  );
  validateOptionalProgramAccount(weeklyInfo, weekly);
  validateOptionalProgramAccount(dailyInfo, daily);

  const plans: KeeperInstructionPlan[] = [];
  if (!weeklyInfo) {
    plans.push({
      operation: "open_weekly_jackpot",
      instruction: new TransactionInstruction({
        programId: ZKUBE_PROGRAM_ID,
        keys: metas([
          [arcadeConfigPda(), false, false],
          [weekly, true, false],
          [args.keeper, true, true],
          [args.keeper, false, true],
          [SystemProgram.programId, false, false],
        ]),
        data: instructionData("open_weekly_jackpot", u32(weekId)),
      }),
    });
  }
  if (!dailyInfo && args.nowUnix % SECONDS_PER_DAY < DAILY_ENTRY_CLOSE_OFFSET) {
    plans.push({
      operation: "open_arena_daily",
      instruction: new TransactionInstruction({
        programId: ZKUBE_PROGRAM_ID,
        keys: metas([
          [protocolPda(), false, false],
          [arcadeConfigPda(), false, false],
          [rulesCatalogPda(args.rulesVersion), false, false],
          [daily, true, false],
          [args.keeper, true, true],
          [args.keeper, false, true],
          [SystemProgram.programId, false, false],
        ]),
        data: instructionData("open_arena_daily", u32(dayId)),
      }),
    });
  }
  return plans;
}

export function validateOptionalProgramAccount(
  info: Awaited<ReturnType<Connection["getAccountInfo"]>>,
  address: PublicKey,
): void {
  if (!info) return;
  if (!info.owner.equals(ZKUBE_PROGRAM_ID)) {
    throw new Error(`keeper rejects foreign owner for ${address.toBase58()}`);
  }
  if (info.executable || info.data.length < 9 || info.data.length > 10_240) {
    throw new Error(`keeper rejects invalid account size for ${address.toBase58()}`);
  }
  if (info.data[8] !== V4_ACCOUNT_VERSION) {
    throw new Error(`keeper rejects account version for ${address.toBase58()}`);
  }
}

export function instructionData(name: string, args: Uint8Array = new Uint8Array()): Buffer {
  const discriminator = createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
  return Buffer.concat([discriminator, Buffer.from(args)]);
}

export function accountDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}

function metas(
  rows: Array<[PublicKey, boolean, boolean]>,
): AccountMeta[] {
  return rows.map(([pubkey, isWritable, isSigner]) => ({
    pubkey,
    isWritable,
    isSigner,
  }));
}

export function u32(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("cadence id is outside u32");
  }
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

export function u64(value: bigint): Buffer {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error("run id is outside u64");
  }
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}
