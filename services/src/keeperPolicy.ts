import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";

import {
  arcadeConfigPda,
  arenaDailyPda,
  currentDayId,
  protocolPda,
  rulesCatalogPda,
  weekIdForDay,
  weeklyJackpotPda,
  ZKUBE_PROGRAM_ID,
  type KeeperInstructionPlan,
} from "./arcadeChain.js";

export interface KeeperPlanPolicyInput {
  plan: KeeperInstructionPlan;
  keeper: PublicKey;
  connection: Connection;
  nowUnix: number;
  rulesVersion: number;
}

export function assertKeeperPlanPolicy(input: KeeperPlanPolicyInput): void {
  const instruction = input.plan.instruction;
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
  throw new Error(`keeper policy rejects operation ${input.plan.operation}`);
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
