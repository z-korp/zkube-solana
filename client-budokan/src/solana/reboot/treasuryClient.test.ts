// @vitest-environment node

import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  assertTreasuryAccounting,
  assertYieldPolicy,
  buildAllocateRealizedYieldPlan,
  buildSweepProtocolRevenuePlan,
  type TreasuryAccounting,
  type TreasuryView,
} from "./treasuryClient";
import { deriveTreasuryLedgerPda } from "./pdas";
import { SessionWallet } from "./sessionWallet";

describe("treasury accounting", () => {
  it("conserves every rake base unit and never allocates unrealized yield", () => {
    const accounting: TreasuryAccounting = {
      lifetimeRakeReceived: 101n,
      lifetimeTeamDistributed: 25n,
      lifetimePaymasterDistributed: 25n,
      lifetimeTreasuryDistributed: 51n,
      lifetimePrizesForfeitedToRewards: 77n,
      lifetimeMapSales: 2_000_000n,
      lifetimeRevenueSwept: 1_000_000n,
      lifetimeRevenueToTreasury: 1_000_000n,
      lifetimeRevenueToRewards: 0n,
      realizedYield: 10n,
      yieldAllocatedToRewards: 4n,
      yieldRetainedInTreasury: 3n,
      lifetimeStrategyDeposited: 0n,
      lifetimeStrategyPrincipalRepaid: 0n,
      strategyPrincipal: 0n,
      realizedStrategyLosses: 0n,
    };
    expect(() => assertTreasuryAccounting(accounting)).not.toThrow();
    expect(() => assertTreasuryAccounting({
      ...accounting,
      lifetimeTreasuryDistributed: 50n,
    })).toThrow(/conserve/);
    expect(() => assertTreasuryAccounting({
      ...accounting,
      yieldAllocatedToRewards: 8n,
    })).toThrow(/realized yield/);
    expect(() => assertTreasuryAccounting({
      ...accounting,
      strategyPrincipal: 1n,
    })).toThrow(/strategy principal/);
  });

  it("rejects unsafe or internally inconsistent yield policy views", () => {
    const address = Keypair.generate().publicKey;
    const policy = {
      configured: true,
      strategyVersion: 1,
      adapterProgram: address,
      market: address,
      reserve: address,
      receiptMint: address,
      maxPrincipal: 1_000_000n,
      maxExposureBps: 2_500,
      minLiquidReserveBps: 7_500,
      maxSlippageBps: 25,
      maxLossBps: 100,
      yieldRewardBps: 10_000,
      depositsEnabled: false,
      emergencyExit: false,
    };
    expect(() => assertYieldPolicy(policy)).not.toThrow();
    expect(() => assertYieldPolicy({ ...policy, depositsEnabled: true, emergencyExit: true }))
      .toThrow(/deposits/);
    expect(() => assertYieldPolicy({ ...policy, maxExposureBps: 5_001 }))
      .toThrow(/safety bounds/);
    expect(() => assertYieldPolicy({ ...policy, configured: false }))
      .toThrow(/strategy version/);
  });

  it("builds a permissionless sweep against only the configured ledger and vaults", async () => {
    const caller = new SessionWallet(Keypair.generate());
    const publicKey = () => Keypair.generate().publicKey;
    const accounting: TreasuryAccounting = {
      lifetimeRakeReceived: 0n, lifetimeTeamDistributed: 0n,
      lifetimePaymasterDistributed: 0n, lifetimeTreasuryDistributed: 0n,
      lifetimePrizesForfeitedToRewards: 0n, lifetimeMapSales: 1n,
      lifetimeRevenueSwept: 0n, lifetimeRevenueToTreasury: 0n,
      lifetimeRevenueToRewards: 0n, realizedYield: 0n, yieldAllocatedToRewards: 0n,
      yieldRetainedInTreasury: 0n,
      lifetimeStrategyDeposited: 0n, lifetimeStrategyPrincipalRepaid: 0n,
      strategyPrincipal: 0n, realizedStrategyLosses: 0n,
    };
    const treasury: TreasuryView = {
      paymentMint: publicKey(), paymentTokenProgram: publicKey(), paused: false,
      authority: publicKey(), paymaster: publicKey(), pendingAuthority: publicKey(), governanceDelaySeconds: 3_600,
      governanceExecutionWindowSeconds: 86_400, nextGovernanceProposalId: 1n,
      revenueRewardBps: 0,
      yieldPolicy: {
        configured: false,
        strategyVersion: 0,
        adapterProgram: publicKey(),
        market: publicKey(),
        reserve: publicKey(),
        receiptMint: publicKey(),
        maxPrincipal: 0n,
        maxExposureBps: 0,
        minLiquidReserveBps: 10_000,
        maxSlippageBps: 0,
        maxLossBps: 0,
        yieldRewardBps: 10_000,
        depositsEnabled: false,
        emergencyExit: false,
      },
      vaults: {
        team: { address: publicKey(), balance: 0n },
        paymaster: { address: publicKey(), balance: 0n },
        treasury: { address: publicKey(), balance: 0n },
        reward: { address: publicKey(), balance: 0n },
        payment: { address: publicKey(), balance: 1n },
      },
      ledger: accounting,
    };
    const [plan, yieldPlan] = await Promise.all([
      buildSweepProtocolRevenuePlan({
        connection: {} as Connection,
        caller,
        treasury,
      }),
      buildAllocateRealizedYieldPlan({
        connection: {} as Connection,
        caller,
        treasury,
      }),
    ]);

    expect(plan.feePayer.equals(caller.publicKey)).toBe(true);
    expect(plan.transaction.instructions[0].keys[1].pubkey.equals(deriveTreasuryLedgerPda())).toBe(true);
    expect(plan.transaction.instructions[0].keys[3].pubkey.equals(treasury.vaults.payment.address)).toBe(true);
    expect(yieldPlan.label).toBe("Allocate realized yield to rewards");
    expect(yieldPlan.transaction.instructions[0].keys[2].pubkey.equals(deriveTreasuryLedgerPda())).toBe(true);
    expect(yieldPlan.transaction.instructions[0].keys[4].pubkey.equals(treasury.vaults.treasury.address)).toBe(true);
    expect(yieldPlan.transaction.instructions[0].keys[5].pubkey.equals(treasury.vaults.reward.address)).toBe(true);
  });
});
