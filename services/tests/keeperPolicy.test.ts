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
import {
  deriveDailyChallengePda,
  deriveDailyLeaderboardPda,
  deriveDailyRulesCatalogPda,
  deriveEconomyConfigPda,
  deriveProtocolConfigPda,
} from "../../client/src/chain/pdas";
import type { TransactionPlan } from "../../client/src/chain/runPlan";
import { assertKeeperPlanPolicy } from "../src/keeperPolicy";

const nowUnix = 20_651 * 86_400 + 10;

describe("keeper signing policy", () => {
  it("accepts the canonical current Daily plan", async () => {
    const keeper = Keypair.generate();
    const connection = new Connection("https://rpc.magicblock.app/devnet", "confirmed");
    const plan = dailyPlan(20_651, keeper.publicKey, connection);

    expect(() =>
      assertKeeperPlanPolicy({
        operation: "open_daily_challenge",
        plan,
        keeper: keeper.publicKey,
        connection,
        nowUnix,
      }),
    ).not.toThrow();
  });

  it("rejects foreign programs, payer drift, extra signers, and account drift", async () => {
    const keeper = Keypair.generate();
    const connection = new Connection("https://rpc.magicblock.app/devnet", "confirmed");
    const canonical = dailyPlan(20_651, keeper.publicKey, connection);
    const assertRejected = (plan: TransactionPlan, message: string) => {
      expect(() =>
        assertKeeperPlanPolicy({
          operation: "open_daily_challenge",
          plan,
          keeper: keeper.publicKey,
          connection,
          nowUnix,
        }),
      ).toThrow(message);
    };

    const foreignProgram = clonePlan(canonical);
    foreignProgram.transaction.instructions[0]!.programId = Keypair.generate().publicKey;
    assertRejected(foreignProgram, "foreign program");

    const wrongPayer = clonePlan(canonical);
    wrongPayer.feePayer = Keypair.generate().publicKey;
    assertRejected(wrongPayer, "different fee payer");

    const extraSigner = clonePlan(canonical);
    extraSigner.signers = [Keypair.generate()];
    assertRejected(extraSigner, "additional transaction signers");

    const wrongChallenge = clonePlan(canonical);
    wrongChallenge.transaction.instructions[0]!.keys[3]!.pubkey = Keypair.generate().publicKey;
    assertRejected(wrongChallenge, "daily_challenge");
  });

  it("rejects an otherwise canonical future Daily", async () => {
    const keeper = Keypair.generate();
    const connection = new Connection("https://rpc.magicblock.app/devnet", "confirmed");
    const plan = dailyPlan(20_652, keeper.publicKey, connection);
    expect(() =>
      assertKeeperPlanPolicy({
        operation: "open_daily_challenge",
        plan,
        keeper: keeper.publicKey,
        connection,
        nowUnix,
      }),
    ).toThrow("non-current Daily");
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

function meta(pubkey: PublicKey, isSigner = false, isWritable = false) {
  return { pubkey, isSigner, isWritable };
}
