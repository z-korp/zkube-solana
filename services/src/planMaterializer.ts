import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
  KEEPER_PLAN_INSTRUCTION,
  type KeeperInstructionPlan,
  type KeeperOperation,
  type KeeperPlanContext,
} from "./arcadeChain.js";

export interface ProtocolInstructionMaterializer {
  materialize(input: {
    operation: KeeperOperation;
    context: KeeperPlanContext;
    programId: PublicKey;
    keeper: PublicKey;
  }): Promise<readonly TransactionInstruction[]>;
}

export interface PlanMaterializerConfig {
  programId: PublicKey;
  keeper: PublicKey;
  protocol: ProtocolInstructionMaterializer;
}

export async function materializeKeeperPlan(
  plan: KeeperInstructionPlan,
  config: PlanMaterializerConfig,
): Promise<KeeperInstructionPlan> {
  if (plan.execution !== "validation_only" || plan.instruction || plan.instructions ||
      !plan.context) {
    throw new Error("only a validated semantic plan can be materialized");
  }
  const instructions = [...await config.protocol.materialize({
      operation: plan.operation,
      context: plan.context,
      programId: config.programId,
      keeper: config.keeper,
    })];
  const materialized: KeeperInstructionPlan = {
    ...plan,
    execution: "instruction",
    connection: KEEPER_PLAN_INSTRUCTION[plan.operation].connection,
    instruction: instructions[0],
    instructions,
  };
  assertMaterializedKeeperPlan(materialized, config);
  return materialized;
}

export function assertMaterializedKeeperPlan(
  plan: KeeperInstructionPlan,
  config: Pick<PlanMaterializerConfig, "programId" | "keeper">,
): void {
  if (plan.execution !== "instruction" || plan.instructions?.length !== 1 ||
      plan.instruction !== plan.instructions[0] || !plan.connection) {
    throw new Error("materialized keeper plan is incomplete or non-atomic");
  }
  const instruction = plan.instruction;
  if (!instruction.programId.equals(config.programId)) {
    throw new Error("materialized keeper plan targets a program outside the allowlist");
  }
  for (const account of instruction.keys) {
    if (account.isSigner && !account.pubkey.equals(config.keeper)) {
      throw new Error("materialized keeper plan introduces a non-keeper signer");
    }
  }
  const expectedConnection = KEEPER_PLAN_INSTRUCTION[plan.operation]?.connection;
  if (!expectedConnection || plan.connection !== expectedConnection) {
    throw new Error("materialized keeper plan uses the wrong connection boundary");
  }
}
