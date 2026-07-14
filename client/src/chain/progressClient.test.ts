// @vitest-environment node

import {
  Connection,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { validatePaymasterTransaction } from "../server/paymaster";
import { deriveQuestClaimsPda } from "./pdas";
import {
  buildClaimAchievementPlan,
  buildClaimQuestPlan,
} from "./progressClient";
import { SessionWallet } from "./sessionWallet";

describe("progress reward client", () => {
  it("domains player quest claims by owner", () => {
    const owner = Keypair.generate().publicKey;
    const otherOwner = Keypair.generate().publicKey;
    expect(deriveQuestClaimsPda(owner).equals(deriveQuestClaimsPda(owner))).toBe(true);
    expect(deriveQuestClaimsPda(owner).equals(deriveQuestClaimsPda(otherOwner))).toBe(false);
  });

  it("builds canonical player claims accepted by paymaster policy", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(owner);
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const plans = await Promise.all([
      buildClaimAchievementPlan({
        connection,
        wallet,
        ownerAuthority: owner.publicKey,
        sessionToken: null,
        achievementIndex: 0,
        paymaster: paymaster.publicKey,
      }),
      buildClaimQuestPlan({
        connection,
        wallet,
        ownerAuthority: owner.publicKey,
        sessionToken: null,
        questIndex: 0,
        paymaster: paymaster.publicKey,
      }),
    ]);
    for (const plan of plans) {
      const transaction = new VersionedTransaction(new TransactionMessage({
        payerKey: paymaster.publicKey,
        recentBlockhash: "11111111111111111111111111111111",
        instructions: plan.transaction.instructions,
      }).compileToV0Message());
      transaction.sign([owner]);
      expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBeNull();
    }
  });
});
