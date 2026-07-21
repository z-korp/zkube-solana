import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import {
  type KeeperInstructionPlan,
  type KeeperOperation,
  type KeeperPlanContext,
} from "./arcadeChain.js";
import {
  REVOKE_SESSION_V2_DISCRIMINATOR,
  SESSION_KEYS_PROGRAM_ID,
} from "./sessionCleanup.js";

export interface ProtocolInstructionMaterializer {
  materialize(input: {
    operation: Exclude<KeeperOperation, "revoke_expired_session">;
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
  const instructions = plan.operation === "revoke_expired_session"
    ? [revokeExpiredSessionInstruction(plan.context)]
    : [...await config.protocol.materialize({
      operation: plan.operation,
      context: plan.context,
      programId: config.programId,
      keeper: config.keeper,
    })];
  const materialized: KeeperInstructionPlan = {
    ...plan,
    execution: "instruction",
    connection: usesEphemeralRollup(plan.operation) ? "ephemeral-rollup" : "base",
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
  const expectedProgram = plan.operation === "revoke_expired_session"
    ? SESSION_KEYS_PROGRAM_ID
    : config.programId;
  if (!instruction.programId.equals(expectedProgram)) {
    throw new Error("materialized keeper plan targets a program outside the allowlist");
  }
  for (const account of instruction.keys) {
    if (account.isSigner && !account.pubkey.equals(config.keeper)) {
      throw new Error("materialized keeper plan introduces a non-keeper signer");
    }
  }
  const expectedConnection = usesEphemeralRollup(plan.operation)
    ? "ephemeral-rollup"
    : "base";
  if (plan.connection !== expectedConnection) {
    throw new Error("materialized keeper plan uses the wrong connection boundary");
  }
}

function revokeExpiredSessionInstruction(
  context: KeeperPlanContext,
): TransactionInstruction {
  const session = context.sessionAddress;
  const authority = context.owner;
  if (!session || !authority) {
    throw new Error("expired session context is incomplete");
  }
  return new TransactionInstruction({
    programId: SESSION_KEYS_PROGRAM_ID,
    keys: [
      { pubkey: session, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: REVOKE_SESSION_V2_DISCRIMINATOR,
  });
}

function usesEphemeralRollup(operation: KeeperOperation): boolean {
  return operation === "force_finish_deadline" || operation === "commit_run";
}
