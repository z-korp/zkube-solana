// @vitest-environment node

import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildActivateCampaignMapPlan,
  buildInitializePlayerPlan,
  buildInitializeProtocolPlan,
  buildPublishCanonicalMapsPlan,
} from "./adminClient";
import {
  deriveCampaignProgressPda,
  deriveMapCatalogPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
} from "./pdas";
import {
  CANONICAL_ACHIEVEMENT_RULES,
  CANONICAL_QUEST_RULES,
  questRewardsForDay,
} from "./progressCatalog";
import { SessionWallet } from "./sessionWallet";

describe("authority publication client", () => {
  it("initializes the lean protocol with segregated USDC destinations", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const keys = Array.from({ length: 8 }, () => Keypair.generate().publicKey);
    const plan = await buildInitializeProtocolPlan({
      connection: {} as Connection,
      authority,
      config: {
        paymaster: keys[0],
        pricingOperator: keys[1],
        teamDestination: keys[2],
        treasuryDestination: keys[3],
        rewardVault: keys[4],
        paymentMint: keys[5],
        paymentTokenProgram: TOKEN_PROGRAM_ID,
        contentVersion: 1,
      },
    });
    const accounts = plan.transaction.instructions[0].keys;

    expect(accounts[0].pubkey.equals(deriveProtocolConfigPda())).toBe(true);
    expect(accounts[1].pubkey.equals(keys[5])).toBe(true);
    expect(accounts[2].pubkey.equals(keys[2])).toBe(true);
    expect(accounts[3].pubkey.equals(keys[3])).toBe(true);
    expect(accounts[4].pubkey.equals(keys[4])).toBe(true);
    expect(accounts[5].pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(accounts[6].pubkey.equals(authority.publicKey)).toBe(true);
  });

  it("rejects Token-2022 payment mints before the on-chain extension guard", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const keys = Array.from({ length: 7 }, () => Keypair.generate().publicKey);
    await expect(buildInitializeProtocolPlan({
      connection: {} as Connection,
      authority,
      config: {
        paymaster: keys[0],
        pricingOperator: keys[1],
        teamDestination: keys[2],
        treasuryDestination: keys[3],
        rewardVault: keys[4],
        paymentMint: keys[5],
        paymentTokenProgram: TOKEN_2022_PROGRAM_ID,
        contentVersion: 1,
      },
    })).rejects.toThrow("canonical SPL Token program");
  });

  it("rejects aliased custody vaults before protocol initialization", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const duplicate = Keypair.generate().publicKey;
    const keys = Array.from({ length: 5 }, () => Keypair.generate().publicKey);
    await expect(buildInitializeProtocolPlan({
      connection: {} as Connection,
      authority,
      config: {
        paymaster: keys[0],
        pricingOperator: keys[1],
        teamDestination: duplicate,
        treasuryDestination: duplicate,
        rewardVault: keys[2],
        paymentMint: keys[3],
        paymentTokenProgram: TOKEN_PROGRAM_ID,
        contentVersion: 1,
      },
    })).rejects.toThrow("pairwise distinct");
  });

  it("publishes all ten maps from the authored canonical catalog", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const connection = {} as Connection;
    const plan = await buildPublishCanonicalMapsPlan({
      connection,
      authority,
      contentVersion: 1,
    });

    expect(plan.transaction.instructions).toHaveLength(10);
    expect(plan.transaction.instructions.map((instruction) => instruction.keys[1].pubkey.toBase58()))
      .toEqual(Array.from({ length: 10 }, (_, index) => deriveMapCatalogPda(1, index + 1).toBase58()));
  });

  it("activates a published campaign map through its content-version PDA", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const plan = await buildActivateCampaignMapPlan({
      connection: {} as Connection,
      authority,
      contentVersion: 7,
      mapId: 10,
    });

    const accounts = plan.transaction.instructions[0].keys;
    expect(accounts[0].pubkey.equals(deriveProtocolConfigPda())).toBe(true);
    expect(accounts[1].pubkey.equals(deriveMapCatalogPda(7, 10))).toBe(true);
    expect(accounts[2].pubkey.equals(authority.publicKey)).toBe(true);
  });

  it("pins achievement XP and the dual Daily and Weekly quest rewards", () => {
    expect(CANONICAL_QUEST_RULES).toHaveLength(12);
    expect(CANONICAL_ACHIEVEMENT_RULES.reduce((sum, rule) => sum + rule.xpReward, 0))
      .toBe(40_200);
    for (const day of [0, 1, 2, 10]) {
      expect(questRewardsForDay(day)).toEqual({
        dailyXp: 500,
        dailyStars: 2,
        weeklyXp: 1_000,
        weeklyStars: 10,
      });
    }
  });

  it("initializes only the owner-derived player accounts", async () => {
    const owner = new SessionWallet(Keypair.generate());
    const payer = Keypair.generate().publicKey;
    const plan = await buildInitializePlayerPlan({
      connection: {} as Connection,
      owner,
      payer,
    });
    const keys = plan.transaction.instructions[0].keys;

    expect(keys[0].pubkey.equals(derivePlayerProfilePda(owner.publicKey))).toBe(true);
    expect(keys[1].pubkey.equals(deriveCampaignProgressPda(owner.publicKey))).toBe(true);
    expect(plan.feePayer.equals(payer)).toBe(true);
  });
});
