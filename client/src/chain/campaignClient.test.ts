// @vitest-environment node

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { validatePaymasterTransaction } from "../server/paymaster";
import {
  buildUnlockMapWithStarsPlan,
  deriveAssociatedTokenAddress,
  hasMapFlag,
  unpackLevelStars,
  type CampaignView,
} from "./campaignClient";
import { SessionWallet } from "./sessionWallet";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

describe("campaign client", () => {
  it("projects map bitmaps and all ten packed level bests", () => {
    expect(hasMapFlag(0b10_0000_0001, 1)).toBe(true);
    expect(hasMapFlag(0b10_0000_0001, 10)).toBe(true);
    expect(hasMapFlag(0b10_0000_0001, 2)).toBe(false);
    expect(hasMapFlag(0xffff, 0)).toBe(false);
    expect(hasMapFlag(0xffff, 11)).toBe(true);
    expect(hasMapFlag(1n << 31n, 32)).toBe(true);
    expect(hasMapFlag(0xffff, 33)).toBe(false);

    const packed = [3, 2, 1, 0, 3, 0, 1, 2, 3, 1]
      .reduce((value, stars, level) => value | (stars << (level * 2)), 0);
    expect(unpackLevelStars(packed)).toEqual([3, 2, 1, 0, 3, 0, 1, 2, 3, 1]);
  });

  it("domains associated token accounts by token program", () => {
    const owner = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const legacy = deriveAssociatedTokenAddress(owner, mint, TOKEN_PROGRAM_ID);
    const token2022 = deriveAssociatedTokenAddress(owner, mint, TOKEN_2022_PROGRAM_ID);

    expect(legacy.equals(token2022)).toBe(false);
  });

  it("builds a player-signed Star unlock accepted by paymaster policy", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(owner);
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const campaign: CampaignView = {
      economyVersion: 2,
      contentVersion: 1,
      starsBalance: 25n,
      maps: [],
    };
    const stars = await buildUnlockMapWithStarsPlan({
      connection,
      wallet,
      contentVersion: campaign.contentVersion,
      mapId: 2,
      paymaster: paymaster.publicKey,
    });
    const transaction = new VersionedTransaction(new TransactionMessage({
      payerKey: paymaster.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: stars.transaction.instructions,
    }).compileToV0Message());
    transaction.sign([owner]);
    expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBeNull();
  });

  it("builds zone unlocks accepted by paymaster policy", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const wallet = new SessionWallet(owner);
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const campaign: CampaignView = {
      economyVersion: 2,
      contentVersion: 2,
      starsBalance: 25n,
      maps: [],
    };
    const plans = [await buildUnlockMapWithStarsPlan({
      connection,
      wallet,
      contentVersion: campaign.contentVersion,
      mapId: 2,
      paymaster: paymaster.publicKey,
    })];

    for (const plan of plans) {
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: paymaster.publicKey,
          recentBlockhash: "11111111111111111111111111111111",
          instructions: plan.transaction.instructions,
        }).compileToV0Message(),
      );
      transaction.sign([owner]);
      expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBeNull();
    }
  });
});
