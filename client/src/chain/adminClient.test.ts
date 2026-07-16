// @vitest-environment node

import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildActivateCampaignMapPlan,
  buildActivateContentReleasePlan,
  buildInitializePlayerPlan,
  buildInitializeProtocolPlan,
  buildPublishCanonicalMapsPlan,
} from "./adminClient";
import {
  deriveMapCatalogPda,
  derivePlayerFundingPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveRewardVaultPda,
} from "./pdas";
import {
  CANONICAL_ACHIEVEMENT_RULES,
  CANONICAL_QUEST_RULES,
  questRewardsForDay,
} from "./progressCatalog";
import { SessionWallet } from "./sessionWallet";

describe("authority publication client", () => {
  it("initializes the lean protocol with segregated native SOL destinations", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const keys = Array.from({ length: 8 }, () => Keypair.generate().publicKey);
    const plan = await buildInitializeProtocolPlan({
      connection: {} as Connection,
      authority,
      config: {
        pricingOperator: keys[1],
        teamDestination: keys[2],
        treasuryDestination: keys[3],
        contentVersion: 1,
      },
    });
    const accounts = plan.transaction.instructions[0].keys;

    expect(accounts[0].pubkey.equals(deriveProtocolConfigPda())).toBe(true);
    expect(accounts[1].pubkey.equals(deriveRewardVaultPda())).toBe(true);
    expect(accounts[2].pubkey.equals(keys[2])).toBe(true);
    expect(accounts[3].pubkey.equals(keys[3])).toBe(true);
    expect(accounts[4].pubkey.equals(authority.publicKey)).toBe(true);
  });

  it("rejects aliased custody vaults before protocol initialization", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const duplicate = Keypair.generate().publicKey;
    const keys = Array.from({ length: 5 }, () => Keypair.generate().publicKey);
    await expect(buildInitializeProtocolPlan({
      connection: {} as Connection,
      authority,
      config: {
        pricingOperator: keys[1],
        teamDestination: duplicate,
        treasuryDestination: duplicate,
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

  it("activates one fully staged release with exact ordered map accounts", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const plan = await buildActivateContentReleasePlan({
      connection: {} as Connection,
      authority,
      contentVersion: 8,
      dailyRulesVersion: 4,
      campaignMapCount: 3,
    });

    const accounts = plan.transaction.instructions[0].keys;
    expect(accounts.slice(-3).map(({ pubkey }) => pubkey.toBase58())).toEqual(
      [1, 2, 3].map((mapId) => deriveMapCatalogPda(8, mapId).toBase58()),
    );
    expect(accounts.slice(-3).every((account) => !account.isWritable && !account.isSigner))
      .toBe(true);
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

    expect(keys[0].pubkey.equals(derivePlayerStatePda(owner.publicKey))).toBe(true);
    expect(keys[1].pubkey.equals(derivePlayerFundingPda(owner.publicKey))).toBe(true);
    expect(plan.feePayer.equals(payer)).toBe(true);
  });
});
