// @vitest-environment node

import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildInitializePlayerPlan,
  buildInitializeProtocolPlan,
  buildPublishCanonicalMapsPlan,
  buildPublishProgressCatalogPlan,
} from "./adminClient";
import {
  deriveCampaignProgressPda,
  deriveMapCatalogPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
  deriveTreasuryLedgerPda,
  deriveYieldPolicyPda,
} from "./pdas";
import {
  CANONICAL_ACHIEVEMENT_RULES,
  CANONICAL_QUEST_RULES,
  questBudgetForDay,
} from "./progressCatalog";
import { SessionWallet } from "./sessionWallet";

describe("authority publication client", () => {
  it("initializes only mint-matched, program-custodied internal vaults", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const keys = Array.from({ length: 8 }, () => Keypair.generate().publicKey);
    const plan = await buildInitializeProtocolPlan({
      connection: {} as Connection,
      authority,
      config: {
        paymaster: keys[0],
        teamVault: keys[1],
        paymasterVault: keys[2],
        treasuryVault: keys[3],
        rewardVault: keys[4],
        paymasterCap: 100_000_000n,
        revenueRewardBps: 0,
        sponsorshipDailyTxLimit: 20,
        sponsorshipDailyPaidAttemptLimit: 3,
        paymentMint: keys[5],
        paymentTokenProgram: TOKEN_PROGRAM_ID,
        paymentVault: keys[7],
        contentVersion: 1,
        governanceDelaySeconds: 3_600,
        governanceExecutionWindowSeconds: 86_400,
      },
    });
    const accounts = plan.transaction.instructions[0].keys;

    expect(accounts[0].pubkey.equals(deriveProtocolConfigPda())).toBe(true);
    expect(accounts[1].pubkey.equals(deriveTreasuryLedgerPda())).toBe(true);
    expect(accounts[2].pubkey.equals(deriveYieldPolicyPda())).toBe(true);
    expect(accounts[3].pubkey.equals(keys[5])).toBe(true);
    expect(accounts[4].pubkey.equals(keys[1])).toBe(true);
    expect(accounts[5].pubkey.equals(keys[2])).toBe(true);
    expect(accounts[6].pubkey.equals(keys[3])).toBe(true);
    expect(accounts[7].pubkey.equals(keys[4])).toBe(true);
    expect(accounts[8].pubkey.equals(keys[7])).toBe(true);
    expect(accounts[9].pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });

  it("rejects Token-2022 payment mints before the on-chain extension guard", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const keys = Array.from({ length: 7 }, () => Keypair.generate().publicKey);
    await expect(buildInitializeProtocolPlan({
      connection: {} as Connection,
      authority,
      config: {
        paymaster: keys[0],
        teamVault: keys[1],
        paymasterVault: keys[2],
        treasuryVault: keys[3],
        rewardVault: keys[4],
        paymasterCap: 100_000_000n,
        revenueRewardBps: 0,
        sponsorshipDailyTxLimit: 20,
        sponsorshipDailyPaidAttemptLimit: 3,
        paymentMint: keys[5],
        paymentTokenProgram: TOKEN_2022_PROGRAM_ID,
        paymentVault: keys[6],
        contentVersion: 1,
        governanceDelaySeconds: 3_600,
        governanceExecutionWindowSeconds: 86_400,
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
        teamVault: duplicate,
        paymasterVault: keys[1],
        treasuryVault: duplicate,
        rewardVault: keys[2],
        paymasterCap: 100_000_000n,
        revenueRewardBps: 0,
        sponsorshipDailyTxLimit: 20,
        sponsorshipDailyPaidAttemptLimit: 3,
        paymentMint: keys[3],
        paymentTokenProgram: TOKEN_PROGRAM_ID,
        paymentVault: keys[4],
        contentVersion: 1,
        governanceDelaySeconds: 3_600,
        governanceExecutionWindowSeconds: 86_400,
      },
    })).rejects.toThrow("pairwise distinct");
  });

  it("publishes all ten maps from the canonical Rust catalog", async () => {
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

  it("encodes exactly 5 Daily, 10 Weekly, and 45 Stars per full week", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const plan = await buildPublishProgressCatalogPlan({
      connection: {} as Connection,
      authority,
      progressVersion: 1,
    });

    expect(plan.transaction.instructions).toHaveLength(1);
    expect(plan.label).toBe("Publish progress catalog v1");
    expect(CANONICAL_QUEST_RULES).toHaveLength(12);
    expect(CANONICAL_ACHIEVEMENT_RULES).toHaveLength(24);
    expect(CANONICAL_ACHIEVEMENT_RULES.reduce((sum, rule) => sum + rule.xpReward, 0))
      .toBe(6_700);
    for (const day of [0, 1, 2, 10]) {
      expect(questBudgetForDay(day)).toEqual({ daily: 5, weekly: 10 });
    }
    expect(questBudgetForDay(0).daily * 7 + questBudgetForDay(0).weekly).toBe(45);
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
