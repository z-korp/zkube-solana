import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";

import { ZKUBE_PROGRAM_ID } from "../../client/src/chain/constants.js";
import { IDL } from "../../client/src/chain/idl/index.js";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveEconomyConfigPda,
  deriveProtocolConfigPda,
  deriveRewardVaultPda,
  deriveWeeklyChallengePda,
  deriveWeeklyLeaderboardPda,
} from "../../client/src/chain/pdas.js";
import {
  REVOKE_SESSION_V2_DISCRIMINATOR,
} from "../../client/src/chain/sessionCleanup.js";
import { SESSION_KEYS_PROGRAM_ID } from "../../client/src/chain/sessionV2.js";
import type { TransactionPlan } from "../../client/src/chain/runPlan.js";

interface RawIdlInstruction {
  name: string;
  discriminator: number[];
  accounts: Array<{ name: string }>;
  args: unknown[];
}

const RAW_INSTRUCTIONS = (IDL as unknown as { instructions: RawIdlInstruction[] }).instructions;

const OPERATION_INSTRUCTION = new Map<string, string>([
  ["open_daily_challenge", "open_daily_challenge"],
  ["open_weekly_challenge", "open_weekly_challenge"],
  ["finalize_daily_challenge", "finalize_daily_challenge"],
  ["rollup_daily_to_weekly", "funded_rollup_daily_to_weekly"],
  ["finalize_weekly_challenge", "finalize_weekly_challenge"],
  ["forfeit_weekly_sol", "forfeit_weekly_sol"],
  ["close_daily_player", "close_daily_player"],
  ["close_daily_challenge", "close_daily_challenge"],
  ["close_weekly_player", "close_weekly_player"],
  ["close_weekly_challenge", "close_weekly_challenge"],
]);

export interface KeeperPlanPolicyInput {
  operation: string;
  plan: TransactionPlan;
  keeper: PublicKey;
  connection: Connection;
  nowUnix: number;
}

/**
 * Last-line signing policy for the independently funded keeper.
 *
 * The account fetchers and transaction builders validate dynamic account
 * ownership, discriminators, versions, and PDA relationships. This policy is
 * intentionally independent of those builders: immediately before signing it
 * constrains the layer, RPC, payer, signer set, program, discriminator, fixed
 * PDAs, and current cadence address.
 */
export function assertKeeperPlanPolicy(input: KeeperPlanPolicyInput): void {
  const { operation, plan, keeper, connection, nowUnix } = input;
  if (plan.layer !== "solana-base") {
    throw new Error("keeper policy rejects non-base-layer transactions");
  }
  if (plan.connection.rpcEndpoint !== connection.rpcEndpoint) {
    throw new Error("keeper policy rejects a different RPC connection");
  }
  if (!plan.feePayer.equals(keeper)) {
    throw new Error("keeper policy rejects a different fee payer");
  }
  if (plan.signers.length !== 0) {
    throw new Error("keeper policy rejects additional transaction signers");
  }
  if (plan.transaction.instructions.length !== 1) {
    throw new Error("keeper policy requires exactly one instruction");
  }

  const instruction = plan.transaction.instructions[0]!;
  for (const account of instruction.keys) {
    if (account.isSigner && !account.pubkey.equals(keeper)) {
      throw new Error("keeper policy rejects an unexpected instruction signer");
    }
  }

  if (operation === "revoke_expired_session") {
    assertSessionRevocation(instruction.programId, instruction.data, instruction.keys.length);
    return;
  }

  const expectedName = orphanInstruction(operation) ?? OPERATION_INSTRUCTION.get(operation);
  if (!expectedName) throw new Error(`keeper policy rejects operation ${operation}`);
  if (!instruction.programId.equals(ZKUBE_PROGRAM_ID)) {
    throw new Error("keeper policy rejects a foreign program");
  }
  const definition = RAW_INSTRUCTIONS.find((candidate) => candidate.name === expectedName);
  if (!definition) throw new Error(`keeper policy is missing IDL instruction ${expectedName}`);
  const discriminator = Buffer.from(definition.discriminator);
  if (
    instruction.data.length < discriminator.length
    || !instruction.data.subarray(0, discriminator.length).equals(discriminator)
  ) {
    throw new Error("keeper policy rejects an unexpected instruction discriminator");
  }
  if (instruction.keys.length !== definition.accounts.length) {
    throw new Error("keeper policy rejects an unexpected account layout");
  }
  const expectedDataLength = discriminator.length + (definition.args.length === 0 ? 0 : 4);
  if (instruction.data.length !== expectedDataLength) {
    throw new Error("keeper policy rejects an unexpected instruction payload");
  }

  assertNamedKeeperAccount(definition, instruction.keys, "caller", keeper);
  assertNamedKeeperAccount(definition, instruction.keys, "payer", keeper);

  if (expectedName === "open_daily_challenge") {
    const dayId = instruction.data.readUInt32LE(8);
    if (dayId !== Math.floor(nowUnix / 86_400)) {
      throw new Error("keeper policy rejects a non-current Daily");
    }
    const challenge = deriveDailyChallengePda(dayId);
    assertNamedAccount(definition, instruction.keys, "protocol", deriveProtocolConfigPda());
    assertNamedAccount(definition, instruction.keys, "economy_config", deriveEconomyConfigPda());
    assertNamedAccount(definition, instruction.keys, "daily_challenge", challenge);
    assertNamedAccount(
      definition,
      instruction.keys,
      "leaderboard",
      deriveDailyLeaderboardPda(challenge),
    );
    assertNamedAccount(definition, instruction.keys, "system_program", SystemProgram.programId);
  }

  if (expectedName === "open_weekly_challenge") {
    const weekId = instruction.data.readUInt32LE(8);
    const currentWeekId = Math.floor(Math.floor(nowUnix / 86_400) / 7);
    if (weekId !== currentWeekId) {
      throw new Error("keeper policy rejects a non-current Weekly");
    }
    const challenge = deriveWeeklyChallengePda(weekId);
    assertNamedAccount(definition, instruction.keys, "protocol", deriveProtocolConfigPda());
    assertNamedAccount(definition, instruction.keys, "economy_config", deriveEconomyConfigPda());
    assertNamedAccount(definition, instruction.keys, "weekly_challenge", challenge);
    assertNamedAccount(
      definition,
      instruction.keys,
      "leaderboard",
      deriveWeeklyLeaderboardPda(challenge),
    );
    assertNamedAccount(definition, instruction.keys, "reward_vault", deriveRewardVaultPda());
    assertNamedAccount(definition, instruction.keys, "system_program", SystemProgram.programId);
  }
}

function orphanInstruction(operation: string): string | null {
  if (operation === "finalize_orphaned_campaign_run") return "consume_campaign_run";
  if (operation === "finalize_orphaned_daily_run") return "consume_daily_run";
  return null;
}

function assertSessionRevocation(
  programId: PublicKey,
  data: Buffer,
  accountCount: number,
): void {
  if (!programId.equals(SESSION_KEYS_PROGRAM_ID)) {
    throw new Error("keeper policy rejects a foreign session program");
  }
  if (
    data.length !== REVOKE_SESSION_V2_DISCRIMINATOR.length
    || !data.equals(Buffer.from(REVOKE_SESSION_V2_DISCRIMINATOR))
    || accountCount !== 4
  ) {
    throw new Error("keeper policy rejects a malformed session revocation");
  }
}

function assertNamedKeeperAccount(
  definition: RawIdlInstruction,
  keys: TransactionPlan["transaction"]["instructions"][number]["keys"],
  name: string,
  keeper: PublicKey,
): void {
  if (definition.accounts.some((account) => account.name === name)) {
    assertNamedAccount(definition, keys, name, keeper);
  }
}

function assertNamedAccount(
  definition: RawIdlInstruction,
  keys: TransactionPlan["transaction"]["instructions"][number]["keys"],
  name: string,
  expected: PublicKey,
): void {
  const index = definition.accounts.findIndex((account) => account.name === name);
  if (index < 0 || !keys[index]?.pubkey.equals(expected)) {
    throw new Error(`keeper policy rejects ${name}`);
  }
}
