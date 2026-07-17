import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";

import { ZKUBE_PROGRAM_ID } from "../../client/src/chain/constants.js";
import { IDL } from "../../client/src/chain/idl/index.js";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  deriveEconomyConfigPda,
  derivePlayerFundingPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveRewardVaultPda,
  deriveWeeklyChallengePda,
  deriveWeeklyLeaderboardPda,
  deriveWeeklyPlayerPda,
} from "../../client/src/chain/pdas.js";
import { REVOKE_SESSION_V2_DISCRIMINATOR } from "../../client/src/chain/sessionCleanup.js";
import { SESSION_KEYS_PROGRAM_ID } from "../../client/src/chain/sessionV2.js";
import type { TransactionPlan } from "../../client/src/chain/runPlan.js";

interface RawIdlInstruction {
  name: string;
  discriminator: number[];
  accounts: Array<{ name: string; writable?: boolean; signer?: boolean }>;
  args: unknown[];
}

const RAW_INSTRUCTIONS = (
  IDL as unknown as { instructions: RawIdlInstruction[] }
).instructions;

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
const MAX_DAILY_LOOKBACK = 400;
const MAX_WEEKLY_LOOKBACK = 104;

export interface KeeperPlanPolicyInput {
  operation: string;
  plan: TransactionPlan;
  keeper: PublicKey;
  connection: Connection;
  nowUnix: number;
  dailyRulesCatalog: PublicKey;
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
    assertSessionRevocation(
      instruction.programId,
      instruction.data,
      instruction.keys,
    );
    return;
  }

  const expectedName =
    orphanInstruction(operation) ?? OPERATION_INSTRUCTION.get(operation);
  if (!expectedName)
    throw new Error(`keeper policy rejects operation ${operation}`);
  if (!instruction.programId.equals(ZKUBE_PROGRAM_ID)) {
    throw new Error("keeper policy rejects a foreign program");
  }
  const definition = RAW_INSTRUCTIONS.find(
    (candidate) => candidate.name === expectedName,
  );
  if (!definition)
    throw new Error(`keeper policy is missing IDL instruction ${expectedName}`);
  const discriminator = Buffer.from(definition.discriminator);
  if (
    instruction.data.length < discriminator.length ||
    !instruction.data.subarray(0, discriminator.length).equals(discriminator)
  ) {
    throw new Error(
      "keeper policy rejects an unexpected instruction discriminator",
    );
  }
  const remainingAccountCount =
    expectedName === "finalize_weekly_challenge" ||
    expectedName === "close_weekly_challenge"
      ? 7
      : 0;
  if (
    instruction.keys.length !==
    definition.accounts.length + remainingAccountCount
  ) {
    throw new Error("keeper policy rejects an unexpected account layout");
  }
  const expectedDataLength =
    discriminator.length + (definition.args.length === 0 ? 0 : 4);
  if (instruction.data.length !== expectedDataLength) {
    throw new Error("keeper policy rejects an unexpected instruction payload");
  }

  assertNamedKeeperAccount(definition, instruction.keys, "caller", keeper);
  assertNamedKeeperAccount(definition, instruction.keys, "payer", keeper);
  assertIdlAccountFlags(definition, instruction.keys);

  if (expectedName === "open_daily_challenge") {
    const dayId = instruction.data.readUInt32LE(8);
    if (dayId !== Math.floor(nowUnix / 86_400)) {
      throw new Error("keeper policy rejects a non-current Daily");
    }
    const challenge = deriveDailyChallengePda(dayId);
    assertNamedAccount(
      definition,
      instruction.keys,
      "protocol",
      deriveProtocolConfigPda(),
    );
    assertNamedAccount(
      definition,
      instruction.keys,
      "economy_config",
      deriveEconomyConfigPda(),
    );
    assertNamedAccount(
      definition,
      instruction.keys,
      "daily_rules_catalog",
      input.dailyRulesCatalog,
    );
    assertNamedAccount(
      definition,
      instruction.keys,
      "daily_challenge",
      challenge,
    );
    assertNamedAccount(
      definition,
      instruction.keys,
      "leaderboard",
      deriveDailyLeaderboardPda(challenge),
    );
    assertNamedAccount(
      definition,
      instruction.keys,
      "system_program",
      SystemProgram.programId,
    );
  }

  if (expectedName === "open_weekly_challenge") {
    const weekId = instruction.data.readUInt32LE(8);
    const currentWeekId = currentWeeklyId(nowUnix);
    if (weekId !== currentWeekId) {
      throw new Error("keeper policy rejects a non-current Weekly");
    }
    const challenge = deriveWeeklyChallengePda(weekId);
    assertNamedAccount(
      definition,
      instruction.keys,
      "protocol",
      deriveProtocolConfigPda(),
    );
    assertNamedAccount(
      definition,
      instruction.keys,
      "economy_config",
      deriveEconomyConfigPda(),
    );
    assertNamedAccount(
      definition,
      instruction.keys,
      "weekly_challenge",
      challenge,
    );
    assertNamedAccount(
      definition,
      instruction.keys,
      "leaderboard",
      deriveWeeklyLeaderboardPda(challenge),
    );
    assertNamedAccount(
      definition,
      instruction.keys,
      "reward_vault",
      deriveRewardVaultPda(),
    );
    assertNamedAccount(
      definition,
      instruction.keys,
      "system_program",
      SystemProgram.programId,
    );
  }

  assertDynamicAccountRelationships({
    expectedName,
    definition,
    keys: instruction.keys,
    nowUnix,
  });
}

function assertDynamicAccountRelationships(args: {
  expectedName: string;
  definition: RawIdlInstruction;
  keys: TransactionPlan["transaction"]["instructions"][number]["keys"];
  nowUnix: number;
}): void {
  const { expectedName, definition, keys, nowUnix } = args;
  const dailyChallenge = namedAccount(definition, keys, "daily_challenge");
  const weeklyChallenge = namedAccount(definition, keys, "weekly_challenge");
  const owner = namedAccount(definition, keys, "owner");

  if (dailyChallenge) {
    assertOptionalNamedAccount(
      definition,
      keys,
      "leaderboard",
      deriveDailyLeaderboardPda(dailyChallenge),
    );
    assertOptionalNamedAccount(
      definition,
      keys,
      "daily_leaderboard",
      deriveDailyLeaderboardPda(dailyChallenge),
    );
    if (owner) {
      assertOptionalNamedAccount(
        definition,
        keys,
        "daily_player",
        deriveDailyPlayerPda(dailyChallenge, owner),
      );
    }
  }
  if (weeklyChallenge) {
    assertOptionalNamedAccount(
      definition,
      keys,
      "leaderboard",
      deriveWeeklyLeaderboardPda(weeklyChallenge),
    );
    assertOptionalNamedAccount(
      definition,
      keys,
      "weekly_leaderboard",
      deriveWeeklyLeaderboardPda(weeklyChallenge),
    );
    if (owner) {
      assertOptionalNamedAccount(
        definition,
        keys,
        "weekly_player",
        deriveWeeklyPlayerPda(weeklyChallenge, owner),
      );
    }
  }
  if (owner) {
    assertOptionalNamedAccount(
      definition,
      keys,
      "player_funding",
      derivePlayerFundingPda(owner),
    );
    assertOptionalNamedAccount(
      definition,
      keys,
      "rent_recipient",
      derivePlayerFundingPda(owner),
    );
    assertOptionalNamedAccount(
      definition,
      keys,
      "player_state",
      derivePlayerStatePda(owner),
    );
  }

  assertOptionalNamedAccount(
    definition,
    keys,
    "protocol",
    deriveProtocolConfigPda(),
  );
  assertOptionalNamedAccount(
    definition,
    keys,
    "reward_vault",
    deriveRewardVaultPda(),
  );
  assertOptionalNamedAccount(
    definition,
    keys,
    "system_program",
    SystemProgram.programId,
  );
  assertOptionalNamedAccount(
    definition,
    keys,
    "zkube_program",
    ZKUBE_PROGRAM_ID,
  );

  const dailyId = dailyChallenge
    ? identifyRecentCadenceId(
        dailyChallenge,
        currentDailyId(nowUnix),
        MAX_DAILY_LOOKBACK,
        deriveDailyChallengePda,
      )
    : null;
  const weeklyId = weeklyChallenge
    ? identifyRecentCadenceId(
        weeklyChallenge,
        currentWeeklyId(nowUnix),
        MAX_WEEKLY_LOOKBACK,
        deriveWeeklyChallengePda,
      )
    : null;
  if (dailyChallenge && dailyId === null) {
    throw new Error("keeper policy rejects an unbounded Daily cadence");
  }
  if (weeklyChallenge && weeklyId === null) {
    throw new Error("keeper policy rejects an unbounded Weekly cadence");
  }
  if (
    dailyId !== null &&
    weeklyId !== null &&
    currentWeeklyId(dailyId * 86_400) !== weeklyId
  ) {
    throw new Error("keeper policy rejects mismatched Daily/Weekly cadence");
  }

  if (
    (expectedName === "finalize_weekly_challenge" ||
      expectedName === "close_weekly_challenge") &&
    weeklyId !== null
  ) {
    const startDay = weeklyId * 7 - 3;
    for (let offset = 0; offset < 7; offset += 1) {
      const account = keys[definition.accounts.length + offset];
      if (
        !account ||
        account.isSigner ||
        account.isWritable ||
        !account.pubkey.equals(deriveDailyChallengePda(startDay + offset))
      ) {
        throw new Error("keeper policy rejects Weekly cadence accounts");
      }
    }
  }
}

function identifyRecentCadenceId(
  address: PublicKey,
  currentId: number,
  maximumLookback: number,
  derive: (id: number) => PublicKey,
): number | null {
  const minimum = Math.max(0, currentId - maximumLookback);
  for (let id = currentId; id >= minimum; id -= 1) {
    if (address.equals(derive(id))) return id;
  }
  return null;
}

function currentDailyId(nowUnix: number): number {
  return Math.max(0, Math.floor(nowUnix / 86_400));
}

function currentWeeklyId(nowUnix: number): number {
  return Math.max(0, Math.floor((nowUnix + 259_200) / 604_800));
}

function assertIdlAccountFlags(
  definition: RawIdlInstruction,
  keys: TransactionPlan["transaction"]["instructions"][number]["keys"],
): void {
  for (let index = 0; index < definition.accounts.length; index += 1) {
    const account = definition.accounts[index]!;
    const key = keys[index];
    if (
      !key ||
      key.isSigner !== Boolean(account.signer) ||
      key.isWritable !== Boolean(account.writable)
    ) {
      throw new Error(`keeper policy rejects ${account.name} account flags`);
    }
  }
}

function orphanInstruction(operation: string): string | null {
  if (operation === "finalize_orphaned_campaign_run")
    return "consume_campaign_run";
  if (operation === "finalize_orphaned_daily_run") return "consume_daily_run";
  return null;
}

function assertSessionRevocation(
  programId: PublicKey,
  data: Buffer,
  keys: TransactionPlan["transaction"]["instructions"][number]["keys"],
): void {
  if (!programId.equals(SESSION_KEYS_PROGRAM_ID)) {
    throw new Error("keeper policy rejects a foreign session program");
  }
  if (
    data.length !== REVOKE_SESSION_V2_DISCRIMINATOR.length ||
    !data.equals(Buffer.from(REVOKE_SESSION_V2_DISCRIMINATOR)) ||
    keys.length !== 4
  ) {
    throw new Error("keeper policy rejects a malformed session revocation");
  }
  if (
    keys[0]?.isSigner ||
    !keys[0]?.isWritable ||
    keys[1]?.isSigner ||
    !keys[1]?.isWritable ||
    keys[2]?.isSigner ||
    keys[2]?.isWritable ||
    keys[3]?.isSigner ||
    keys[3]?.isWritable ||
    !keys[3]?.pubkey.equals(SystemProgram.programId)
  ) {
    throw new Error("keeper policy rejects malformed session accounts");
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
  const index = definition.accounts.findIndex(
    (account) => account.name === name,
  );
  if (index < 0 || !keys[index]?.pubkey.equals(expected)) {
    throw new Error(`keeper policy rejects ${name}`);
  }
}

function assertOptionalNamedAccount(
  definition: RawIdlInstruction,
  keys: TransactionPlan["transaction"]["instructions"][number]["keys"],
  name: string,
  expected: PublicKey,
): void {
  if (definition.accounts.some((account) => account.name === name)) {
    assertNamedAccount(definition, keys, name, expected);
  }
}

function namedAccount(
  definition: RawIdlInstruction,
  keys: TransactionPlan["transaction"]["instructions"][number]["keys"],
  name: string,
): PublicKey | null {
  const index = definition.accounts.findIndex(
    (account) => account.name === name,
  );
  return index < 0 ? null : (keys[index]?.pubkey ?? null);
}
