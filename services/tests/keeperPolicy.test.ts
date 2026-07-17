// @vitest-environment node

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { ZKUBE_PROGRAM_ID } from "../../client/src/chain/constants";
import { IDL } from "../../client/src/chain/idl";
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyRulesCatalogPda,
  deriveEconomyConfigPda,
  deriveProtocolConfigPda,
  deriveRewardVaultPda,
  deriveWeeklyChallengePda,
  deriveWeeklyLeaderboardPda,
} from "../../client/src/chain/pdas";
import type { TransactionPlan } from "../../client/src/chain/runPlan";
import { assertKeeperPlanPolicy } from "../src/keeperPolicy";

const nowUnix = 20_651 * 86_400 + 10;
const dailyRulesCatalog = deriveDailyRulesCatalogPda(1);

describe("keeper signing policy", () => {
  it("accepts the canonical current Daily plan", async () => {
    const keeper = Keypair.generate();
    const connection = new Connection(
      "https://rpc.magicblock.app/devnet",
      "confirmed",
    );
    const plan = dailyPlan(20_651, keeper.publicKey, connection);

    expect(() =>
      assertKeeperPlanPolicy({
        operation: "open_daily_challenge",
        plan,
        keeper: keeper.publicKey,
        connection,
        nowUnix,
        dailyRulesCatalog,
      }),
    ).not.toThrow();
  });

  it("rejects foreign programs, payer drift, extra signers, and account drift", async () => {
    const keeper = Keypair.generate();
    const connection = new Connection(
      "https://rpc.magicblock.app/devnet",
      "confirmed",
    );
    const canonical = dailyPlan(20_651, keeper.publicKey, connection);
    const assertRejected = (plan: TransactionPlan, message: string) => {
      expect(() =>
        assertKeeperPlanPolicy({
          operation: "open_daily_challenge",
          plan,
          keeper: keeper.publicKey,
          connection,
          nowUnix,
          dailyRulesCatalog,
        }),
      ).toThrow(message);
    };

    const foreignProgram = clonePlan(canonical);
    foreignProgram.transaction.instructions[0]!.programId =
      Keypair.generate().publicKey;
    assertRejected(foreignProgram, "foreign program");

    const wrongPayer = clonePlan(canonical);
    wrongPayer.feePayer = Keypair.generate().publicKey;
    assertRejected(wrongPayer, "different fee payer");

    const extraSigner = clonePlan(canonical);
    extraSigner.signers = [Keypair.generate()];
    assertRejected(extraSigner, "additional transaction signers");

    const wrongChallenge = clonePlan(canonical);
    wrongChallenge.transaction.instructions[0]!.keys[3]!.pubkey =
      Keypair.generate().publicKey;
    assertRejected(wrongChallenge, "daily_challenge");

    const wrongRules = clonePlan(canonical);
    wrongRules.transaction.instructions[0]!.keys[2]!.pubkey =
      Keypair.generate().publicKey;
    assertRejected(wrongRules, "daily_rules_catalog");
  });

  it("rejects an otherwise canonical future Daily", async () => {
    const keeper = Keypair.generate();
    const connection = new Connection(
      "https://rpc.magicblock.app/devnet",
      "confirmed",
    );
    const plan = dailyPlan(20_652, keeper.publicKey, connection);
    expect(() =>
      assertKeeperPlanPolicy({
        operation: "open_daily_challenge",
        plan,
        keeper: keeper.publicKey,
        connection,
        nowUnix,
        dailyRulesCatalog,
      }),
    ).toThrow("non-current Daily");
  });

  it("uses the Thursday Weekly boundary and accepts exact Daily cadence metas", () => {
    const keeper = Keypair.generate();
    const connection = new Connection(
      "https://rpc.magicblock.app/devnet",
      "confirmed",
    );
    const thursdayNow = 20_654 * 86_400 + 10;
    const plan = weeklyOpenPlan(2_951, keeper.publicKey, connection);

    expect(() =>
      assertKeeperPlanPolicy({
        operation: "open_weekly_challenge",
        plan,
        keeper: keeper.publicKey,
        connection,
        nowUnix: thursdayNow,
        dailyRulesCatalog,
      }),
    ).not.toThrow();
  });

  it("accepts and constrains all seven Weekly finalize cadence accounts", () => {
    const keeper = Keypair.generate();
    const connection = new Connection(
      "https://rpc.magicblock.app/devnet",
      "confirmed",
    );
    const canonical = weeklyFinalizePlan(2_950, keeper.publicKey, connection);
    const assertPolicy = (plan: TransactionPlan) =>
      assertKeeperPlanPolicy({
        operation: "finalize_weekly_challenge",
        plan,
        keeper: keeper.publicKey,
        connection,
        nowUnix,
        dailyRulesCatalog,
      });

    expect(() => assertPolicy(canonical)).not.toThrow();
    const drifted = clonePlan(canonical);
    drifted.transaction.instructions[0]!.keys[4]!.pubkey =
      Keypair.generate().publicKey;
    expect(() => assertPolicy(drifted)).toThrow("Weekly cadence accounts");
  });
});

function clonePlan(plan: TransactionPlan): TransactionPlan {
  return {
    ...plan,
    transaction: new Transaction().add(
      ...plan.transaction.instructions.map((instruction) => ({
        programId: instruction.programId,
        keys: instruction.keys.map((key) => ({ ...key })),
        data: Buffer.from(instruction.data),
      })),
    ),
    signers: [...plan.signers],
  };
}

function dailyPlan(
  dayId: number,
  keeper: PublicKey,
  connection: Connection,
): TransactionPlan {
  const challenge = deriveDailyChallengePda(dayId);
  const data = Buffer.alloc(12);
  Buffer.from([109, 163, 247, 10, 101, 164, 13, 157]).copy(data);
  data.writeUInt32LE(dayId, 8);
  const instruction = new TransactionInstruction({
    programId: ZKUBE_PROGRAM_ID,
    keys: [
      meta(deriveProtocolConfigPda()),
      meta(deriveEconomyConfigPda()),
      meta(deriveDailyRulesCatalogPda(1)),
      meta(challenge, false, true),
      meta(deriveDailyLeaderboardPda(challenge), false, true),
      meta(keeper, true, true),
      meta(keeper, true, false),
      meta(SystemProgram.programId),
    ],
    data,
  });
  return {
    layer: "solana-base",
    label: "Open Daily challenge",
    connection,
    transaction: new Transaction().add(instruction),
    feePayer: keeper,
    signers: [],
  };
}

function weeklyOpenPlan(
  weekId: number,
  keeper: PublicKey,
  connection: Connection,
): TransactionPlan {
  const challenge = deriveWeeklyChallengePda(weekId);
  const data = instructionData("open_weekly_challenge", weekId);
  const instruction = new TransactionInstruction({
    programId: ZKUBE_PROGRAM_ID,
    keys: [
      meta(deriveProtocolConfigPda()),
      meta(deriveEconomyConfigPda()),
      meta(challenge, false, true),
      meta(deriveWeeklyLeaderboardPda(challenge), false, true),
      meta(deriveRewardVaultPda(), false, true),
      meta(keeper, true, true),
      meta(keeper, true, false),
      meta(SystemProgram.programId),
    ],
    data,
  });
  return plan("Open Weekly challenge", keeper, connection, instruction);
}

function weeklyFinalizePlan(
  weekId: number,
  keeper: PublicKey,
  connection: Connection,
): TransactionPlan {
  const challenge = deriveWeeklyChallengePda(weekId);
  const startDay = weekId * 7 - 3;
  const instruction = new TransactionInstruction({
    programId: ZKUBE_PROGRAM_ID,
    keys: [
      meta(challenge, false, true),
      meta(deriveWeeklyLeaderboardPda(challenge)),
      meta(keeper, true, false),
      ...Array.from({ length: 7 }, (_, offset) =>
        meta(deriveDailyChallengePda(startDay + offset)),
      ),
    ],
    data: instructionData("finalize_weekly_challenge"),
  });
  return plan("Finalize Weekly challenge", keeper, connection, instruction);
}

function instructionData(name: string, argument?: number): Buffer {
  const definition = IDL.instructions.find(
    (instruction) => instruction.name === name,
  );
  if (!definition) throw new Error(`missing test instruction ${name}`);
  const data = Buffer.alloc(8 + (argument === undefined ? 0 : 4));
  Buffer.from(definition.discriminator).copy(data);
  if (argument !== undefined) data.writeUInt32LE(argument, 8);
  return data;
}

function plan(
  label: string,
  keeper: PublicKey,
  connection: Connection,
  instruction: TransactionInstruction,
): TransactionPlan {
  return {
    layer: "solana-base",
    label,
    connection,
    transaction: new Transaction().add(instruction),
    feePayer: keeper,
    signers: [],
  };
}

function meta(pubkey: PublicKey, isSigner = false, isWritable = false) {
  return { pubkey, isSigner, isWritable };
}
