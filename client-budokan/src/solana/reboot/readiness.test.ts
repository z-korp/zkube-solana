// @vitest-environment node

import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { evaluateTreasuryReadiness } from "./readiness";
import type { TreasuryView } from "./treasuryClient";

describe("treasury readiness", () => {
  it("stays green for an empty disabled strategy with funded operations", () => {
    const result = evaluateTreasuryReadiness(fixture());
    expect(result.ok).toBe(true);
    expect(result.alerts).toEqual([]);
    expect(result.strategy.exposureBps).toBe(0);
    expect(result.strategy.liquidReserveBps).toBe(10_000);
  });

  it("raises deterministic critical alerts for breached strategy controls", () => {
    const treasury = fixture();
    treasury.paused = true;
    treasury.yieldPolicy = {
      ...treasury.yieldPolicy,
      configured: true,
      strategyVersion: 1,
      maxPrincipal: 500_000n,
      maxExposureBps: 5_000,
      minLiquidReserveBps: 5_000,
      maxLossBps: 100,
      emergencyExit: true,
    };
    treasury.vaults.treasury.balance = 400_000n;
    treasury.ledger = {
      ...treasury.ledger,
      lifetimeStrategyDeposited: 620_000n,
      strategyPrincipal: 600_000n,
      realizedStrategyLosses: 20_000n,
      realizedYield: 100n,
    };
    const result = evaluateTreasuryReadiness(treasury);
    expect(result.ok).toBe(false);
    expect(result.strategy.exposureBps).toBe(6_000);
    expect(result.strategy.liquidReserveBps).toBe(4_000);
    expect(result.alerts.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "PROTOCOL_PAUSED",
      "YIELD_EMERGENCY",
      "STRATEGY_PRINCIPAL_CAP",
      "STRATEGY_EXPOSURE",
      "LIQUID_RESERVE",
      "REALIZED_LOSS",
      "UNALLOCATED_YIELD",
    ]));
  });
});

function fixture(): TreasuryView {
  const address = () => Keypair.generate().publicKey;
  return {
    paymentMint: address(),
    paymentTokenProgram: address(),
    paused: false,
    authority: address(),
    paymaster: address(),
    pendingAuthority: PublicKey.default,
    governanceDelaySeconds: 3_600,
    governanceExecutionWindowSeconds: 86_400,
    nextGovernanceProposalId: 1n,
    revenueRewardBps: 0,
    yieldPolicy: {
      configured: false,
      strategyVersion: 0,
      adapterProgram: PublicKey.default,
      market: PublicKey.default,
      reserve: PublicKey.default,
      receiptMint: PublicKey.default,
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
      team: { address: address(), balance: 0n },
      paymaster: { address: address(), balance: 1n },
      treasury: { address: address(), balance: 1_000_000n },
      reward: { address: address(), balance: 0n },
      payment: { address: address(), balance: 0n },
    },
    ledger: {
      lifetimeRakeReceived: 0n,
      lifetimeTeamDistributed: 0n,
      lifetimePaymasterDistributed: 0n,
      lifetimeTreasuryDistributed: 0n,
      lifetimePrizesForfeitedToRewards: 0n,
      lifetimeMapSales: 0n,
      lifetimeRevenueSwept: 0n,
      lifetimeRevenueToTreasury: 0n,
      lifetimeRevenueToRewards: 0n,
      realizedYield: 0n,
      yieldAllocatedToRewards: 0n,
      yieldRetainedInTreasury: 0n,
      lifetimeStrategyDeposited: 0n,
      lifetimeStrategyPrincipalRepaid: 0n,
      strategyPrincipal: 0n,
      realizedStrategyLosses: 0n,
    },
  };
}
