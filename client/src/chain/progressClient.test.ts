// @vitest-environment node

import {
  Connection,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { validatePaymasterTransaction } from "../server/paymaster";
import {
  deriveProgressCatalogPda,
  deriveQuestClaimsPda,
} from "./pdas";
import {
  buildClaimAchievementPlan,
  buildClaimQuestPlan,
} from "./progressClient";
import { SessionWallet } from "./sessionWallet";
import { withSponsorshipInstruction } from "./sponsorshipClient";

describe("progress reward client", () => {
  it("domains catalog versions and player quest claims into distinct PDAs", () => {
    const owner = Keypair.generate().publicKey;
    expect(deriveProgressCatalogPda(1).equals(deriveProgressCatalogPda(2))).toBe(false);
    expect(deriveQuestClaimsPda(owner, 1).equals(deriveQuestClaimsPda(owner, 2))).toBe(false);
  });

  it("builds player-signed achievement and quest claims accepted by paymaster policy", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(owner);
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const achievement = await buildClaimAchievementPlan({
      connection,
      wallet,
      achievementIndex: 0,
      progressVersion: 1,
      paymaster: paymaster.publicKey,
    });
    const quest = await buildClaimQuestPlan({
      connection,
      wallet,
      questIndex: 0,
      progressVersion: 1,
      paymaster: paymaster.publicKey,
    });
    for (const plan of [achievement, quest]) {
      const transaction = new VersionedTransaction(new TransactionMessage({
        payerKey: paymaster.publicKey,
        recentBlockhash: "11111111111111111111111111111111",
        instructions: withSponsorshipInstruction({
          owner: owner.publicKey,
          paymaster: paymaster.publicKey,
          instructions: plan.transaction.instructions,
        }),
      }).compileToV0Message());
      transaction.sign([owner]);
      expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBeNull();
    }
  });
});
