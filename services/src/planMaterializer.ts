import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
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
  if (!instruction.programId.equals(config.programId)) {
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

function usesEphemeralRollup(operation: KeeperOperation): boolean {
  switch (operation) {
    case "finish_run":
    case "commit_run":
      return true;
    case "prepare_arena_daily":
    case "activate_arena_daily":
    case "skip_suspended_arena_daily":
    case "consume_campaign_run":
    case "consume_arena_run":
    case "expire_unresolved_arena_run":
    case "cleanup_orphan_active_run":
    case "finalize_arena_daily":
    case "submit_arena_board_chunk":
    case "expire_daily_claims":
    case "archive_arena_daily":
    case "close_arena_daily":
      return false;
    default:
      throw new Error(`keeper operation is outside the exact allowlist: ${String(operation)}`);
  }
}
