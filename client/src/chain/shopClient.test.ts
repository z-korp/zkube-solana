// @vitest-environment node

import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { validatePaymasterTransaction } from "../server/paymaster";
import {
  buildStarPurchasePlan,
  hasStarPackQuoteChanged,
  type StarPackQuote,
  type StarShopView,
} from "./shopClient";
import { SessionWallet } from "./sessionWallet";

describe("Star Shop client", () => {
  it("detects quote changes that require player review", () => {
    const quote = pack();
    expect(hasStarPackQuoteChanged(quote, { ...quote })).toBe(false);
    expect(
      hasStarPackQuoteChanged(quote, { ...quote, currentPrice: 1_100_000n }),
    ).toBe(true);
    expect(hasStarPackQuoteChanged(quote, undefined)).toBe(true);
  });

  it("builds a sponsored atomic initialize plus purchase for a fresh player", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const plan = await buildStarPurchasePlan({
      connection: new Connection("http://127.0.0.1:8899", "confirmed"),
      wallet: new SessionWallet(owner),
      shop: view(false),
      packIndex: 0,
      paymaster: paymaster.publicKey,
    });

    expect(plan.transaction.instructions).toHaveLength(2);
    const transaction = sponsoredTransaction(plan, paymaster.publicKey, owner);
    expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBeNull();
    expect(transaction.serialize().length).toBeLessThanOrEqual(1_232);
  });

  it("builds only the purchase for an initialized player", async () => {
    const owner = Keypair.generate();
    const paymaster = Keypair.generate();
    const plan = await buildStarPurchasePlan({
      connection: new Connection("http://127.0.0.1:8899", "confirmed"),
      wallet: new SessionWallet(owner),
      shop: view(true),
      packIndex: 0,
      paymaster: paymaster.publicKey,
    });

    expect(plan.transaction.instructions).toHaveLength(1);
    const transaction = sponsoredTransaction(plan, paymaster.publicKey, owner);
    expect(validatePaymasterTransaction(transaction, paymaster.publicKey)).toBeNull();
  });
});

function pack(): StarPackQuote {
  return {
    index: 0,
    stars: 10n,
    regularPrice: 1_000_000n,
    currentPrice: 1_000_000n,
    salePrice: 900_000n,
    enabled: true,
    onSale: false,
  };
}

function view(playerInitialized: boolean): StarShopView {
  return {
    economyVersion: 2,
    revision: 1n,
    playerInitialized,
    starsBalance: 0n,
    dailyEntryStars: 10n,
    zoneUnlockStars: 40n,
    protocolPaused: false,
    paymentMint: Keypair.generate().publicKey,
    paymentTokenProgram: TOKEN_PROGRAM_ID,
    teamDestination: Keypair.generate().publicKey,
    rewardVault: Keypair.generate().publicKey,
    treasuryDestination: Keypair.generate().publicKey,
    saleEnabled: false,
    saleStartsAt: 0n,
    saleEndsAt: 0n,
    saleLive: false,
    packs: [pack()],
  };
}

function sponsoredTransaction(
  plan: Awaited<ReturnType<typeof buildStarPurchasePlan>>,
  paymaster: Keypair["publicKey"],
  owner: Keypair,
): VersionedTransaction {
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: paymaster,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: plan.transaction.instructions,
    }).compileToV0Message(),
  );
  transaction.sign([owner]);
  return transaction;
}
