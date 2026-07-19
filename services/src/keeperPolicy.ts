import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";

import {
  arcadeConfigPda,
  activeRunPda,
  arenaDailyPda,
  arenaPlayerPda,
  currentDayId,
  instructionData,
  operatorRevenuePda,
  playerFundingPda,
  playerStatePda,
  protocolPda,
  runResolutionPda,
  rulesCatalogPda,
  weekIdForDay,
  weeklyJackpotPda,
  weeklyPlayerPda,
  ZKUBE_PROGRAM_ID,
  type KeeperInstructionPlan,
  u32,
} from "./arcadeChain.js";
import { deriveSessionPda, isRevokeSessionData, SESSION_KEYS_PROGRAM_ID } from "./sessionCleanup.js";

export interface KeeperPlanPolicyInput {
  plan: KeeperInstructionPlan;
  keeper: PublicKey;
  connection: Connection;
  nowUnix: number;
  rulesVersion: number;
}

export function assertKeeperPlanPolicy(input: KeeperPlanPolicyInput): void {
  const instruction = input.plan.instruction;
  if (input.plan.operation === "revoke_expired_session") {
    const owner = input.plan.context?.owner;
    const sessionSigner = input.plan.context?.sessionSigner;
    if (!owner || !sessionSigner || !instruction.programId.equals(SESSION_KEYS_PROGRAM_ID) ||
        !isRevokeSessionData(instruction.data)) {
      throw new Error("keeper policy rejects expired session context");
    }
    assertKeys(instruction.keys, [deriveSessionPda(owner, sessionSigner), owner, owner, SystemProgram.programId]);
    if (instruction.keys.some((meta) => meta.isSigner)) {
      throw new Error("keeper policy rejects a session signer");
    }
    return;
  }
  if (!instruction.programId.equals(ZKUBE_PROGRAM_ID)) {
    throw new Error("keeper policy rejects a foreign program");
  }
  for (const account of instruction.keys) {
    if (account.isSigner && !account.pubkey.equals(input.keeper)) {
      throw new Error("keeper policy rejects an unexpected signer");
    }
  }
  if (input.plan.operation === "open_weekly_jackpot") {
    const weekId = weekIdForDay(currentDayId(input.nowUnix));
    assertData(instruction, "open_weekly_jackpot", u32(weekId));
    assertKeys(instruction.keys, [
      arcadeConfigPda(),
      weeklyJackpotPda(weekId),
      input.keeper,
      input.keeper,
      SystemProgram.programId,
    ]);
    return;
  }
  if (input.plan.operation === "open_arena_daily") {
    const dayId = currentDayId(input.nowUnix);
    assertData(instruction, "open_arena_daily", u32(dayId));
    assertKeys(instruction.keys, [
      protocolPda(),
      arcadeConfigPda(),
      rulesCatalogPda(input.rulesVersion),
      arenaDailyPda(dayId),
      input.keeper,
      input.keeper,
      SystemProgram.programId,
    ]);
    return;
  }
  const context = input.plan.context;
  if (!context) throw new Error("keeper policy rejects missing operation context");
  const dayId = context.dayId;
  const weekId = context.weekId;
  const owner = context.owner;
  const runId = context.runId;
  if (input.plan.operation === "consume_terminal_run") {
    if (!owner || runId === undefined) throw new Error("keeper policy rejects incomplete run context");
    const run = activeRunPda(owner, runId);
    const funding = playerFundingPda(owner);
    if (matchesInstruction(instruction, "consume_campaign_run")) {
      assertKeys(instruction.keys, [run, playerStatePda(owner), owner, funding]);
      return;
    }
    if (dayId === undefined) throw new Error("keeper policy rejects missing Daily context");
    const daily = arenaDailyPda(dayId);
    if (matchesInstruction(instruction, "consume_arena_run")) {
      assertKeys(instruction.keys, [playerStatePda(owner), daily, arenaPlayerPda(daily, owner), operatorRevenuePda(), run, funding]);
      return;
    }
    if (matchesInstruction(instruction, "consume_practice_run")) {
      assertKeys(instruction.keys, [playerStatePda(owner), daily, instruction.keys[2]!.pubkey, run, funding]);
      const optionalArena = instruction.keys[2]!.pubkey;
      if (!optionalArena.equals(ZKUBE_PROGRAM_ID) && !optionalArena.equals(arenaPlayerPda(daily, owner))) {
        throw new Error("keeper policy rejects optional Practice board");
      }
      return;
    }
    throw new Error("keeper policy rejects terminal-run discriminator");
  }
  if (input.plan.operation === "expire_stuck_arena_entry") {
    if (dayId === undefined || !owner || runId === undefined) throw new Error("keeper policy rejects incomplete expiry context");
    const daily = arenaDailyPda(dayId);
    assertInstruction(instruction, "expire_stuck_arena_entry");
    assertKeys(instruction.keys, [operatorRevenuePda(), daily, arenaPlayerPda(daily, owner), playerStatePda(owner), owner, runResolutionPda(daily, owner, runId), SystemProgram.programId, input.keeper]);
    return;
  }
  if (input.plan.operation === "finalize_arena_daily") {
    if (dayId === undefined || weekId === undefined) throw new Error("keeper policy rejects incomplete Daily finalization context");
    assertInstruction(instruction, "finalize_arena_daily");
    assertPrefixAndTail(instruction.keys, [arenaDailyPda(dayId), weeklyJackpotPda(weekId), input.keeper], 5);
    return;
  }
  if (input.plan.operation === "rollup_arena_to_weekly") {
    if (dayId === undefined || weekId === undefined || !owner) throw new Error("keeper policy rejects incomplete rollup context");
    const daily = arenaDailyPda(dayId); const weekly = weeklyJackpotPda(weekId);
    assertInstruction(instruction, "funded_rollup_arena_to_weekly");
    assertKeys(instruction.keys, [daily, arenaPlayerPda(daily, owner), weekly, weeklyPlayerPda(weekly, owner), owner, playerFundingPda(owner), input.keeper, SystemProgram.programId, ZKUBE_PROGRAM_ID]);
    return;
  }
  if (input.plan.operation === "finalize_weekly_jackpot") {
    if (weekId === undefined) throw new Error("keeper policy rejects incomplete weekly finalization context");
    assertInstruction(instruction, "finalize_weekly_jackpot");
    const start = weekId * 7 - 3;
    assertPrefixAndTail(instruction.keys, [weeklyJackpotPda(weekId), weeklyJackpotPda(weekId + 1), input.keeper, ...Array.from({ length: 7 }, (_, offset) => arenaDailyPda(start + offset))], 3);
    return;
  }
  if (input.plan.operation === "sync_daily_finish" || input.plan.operation === "close_arena_player") {
    if (dayId === undefined || !owner) throw new Error("keeper policy rejects incomplete Daily player context");
    const daily = arenaDailyPda(dayId);
    if (input.plan.operation === "sync_daily_finish") {
      assertInstruction(instruction, "sync_daily_finish");
      assertKeys(instruction.keys, [daily, playerStatePda(owner), input.keeper]);
    } else {
      assertInstruction(instruction, "close_arena_player");
      assertKeys(instruction.keys, [daily, arenaPlayerPda(daily, owner), playerFundingPda(owner), input.keeper]);
    }
    return;
  }
  if (input.plan.operation === "sync_weekly_finish" || input.plan.operation === "close_weekly_player") {
    if (weekId === undefined || !owner) throw new Error("keeper policy rejects incomplete weekly player context");
    const weekly = weeklyJackpotPda(weekId);
    if (input.plan.operation === "sync_weekly_finish") {
      assertInstruction(instruction, "sync_weekly_finish");
      assertKeys(instruction.keys, [weekly, playerStatePda(owner), input.keeper]);
    } else {
      assertInstruction(instruction, "close_weekly_player");
      assertKeys(instruction.keys, [weekly, weeklyPlayerPda(weekly, owner), playerFundingPda(owner), input.keeper]);
    }
    return;
  }
  if (input.plan.operation === "cleanup_resolved_run") {
    if (dayId === undefined || !owner || runId === undefined || !context.receiptRentRecipient) throw new Error("keeper policy rejects incomplete cleanup context");
    assertInstruction(instruction, "cleanup_resolved_run");
    const daily = arenaDailyPda(dayId);
    assertKeys(instruction.keys, [activeRunPda(owner, runId), runResolutionPda(daily, owner, runId), playerFundingPda(owner), context.receiptRentRecipient, input.keeper]);
    return;
  }
  throw new Error(`keeper policy rejects operation ${input.plan.operation}`);
}

function matchesInstruction(instruction: KeeperInstructionPlan["instruction"], name: string): boolean {
  return instruction.data.subarray(0, 8).equals(instructionData(name).subarray(0, 8));
}

function assertInstruction(instruction: KeeperInstructionPlan["instruction"], name: string): void {
  if (instruction.data.length !== 8 || !matchesInstruction(instruction, name)) {
    throw new Error("keeper policy rejects an unexpected instruction discriminator");
  }
}

function assertData(instruction: KeeperInstructionPlan["instruction"], name: string, args: Uint8Array): void {
  if (!instruction.data.equals(instructionData(name, args))) {
    throw new Error("keeper policy rejects unexpected instruction data");
  }
}

function assertPrefixAndTail(actual: KeeperInstructionPlan["instruction"]["keys"], prefix: PublicKey[], maximumTail: number): void {
  if (actual.length < prefix.length || actual.length > prefix.length + maximumTail ||
      prefix.some((key, index) => !actual[index]?.pubkey.equals(key)) ||
      actual.slice(prefix.length).some((meta) => meta.isSigner || !meta.isWritable)) {
    throw new Error("keeper policy rejects an unexpected payout layout");
  }
}

function assertKeys(
  actual: KeeperInstructionPlan["instruction"]["keys"],
  expected: PublicKey[],
): void {
  if (
    actual.length !== expected.length ||
    expected.some((key, index) => !actual[index]?.pubkey.equals(key))
  ) {
    throw new Error("keeper policy rejects an unexpected account layout");
  }
}
