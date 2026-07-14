// @vitest-environment node

import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { evaluateTreasuryReadiness } from "./readiness";
import type { TreasuryView } from "./treasuryClient";

describe("treasury readiness", () => {
  it("stays green for segregated, funded destinations and empty sales", () => {
    const result = evaluateTreasuryReadiness(fixture());

    expect(result.ok).toBe(true);
    expect(result.alerts).toEqual([]);
    expect(result.balances).toEqual({
      team: 0n,
      treasury: 1_000_000n,
      rewards: 100_000n,
    });
  });

  it("flags pause, pending authority, empty rewards, and split drift", () => {
    const treasury = fixture();
    treasury.paused = true;
    treasury.pendingAuthority = Keypair.generate().publicKey;
    treasury.destinations.reward.balance = 0n;
    treasury.sales = {
      lifetimeGrossSales: 1_000n,
      lifetimeTeamShare: 101n,
      lifetimeRewardShare: 100n,
      lifetimeTreasuryShare: 799n,
      lifetimeStarsSold: 10n,
      purchaseCount: 1n,
    };

    const result = evaluateTreasuryReadiness(treasury);
    expect(result.ok).toBe(false);
    expect(result.alerts.map((entry) => entry.code)).toEqual([
      "PROTOCOL_PAUSED",
      "AUTHORITY_TRANSFER_PENDING",
      "REWARD_RESERVE_EMPTY",
      "SALE_SPLIT_DRIFT",
    ]);
  });
});

function fixture(): TreasuryView {
  const address = () => Keypair.generate().publicKey;
  return {
    paymentMint: address(),
    paymentTokenProgram: address(),
    paused: false,
    authority: address(),
    pendingAuthority: PublicKey.default,
    pricingOperator: address(),
    paymaster: address(),
    destinations: {
      team: { address: address(), balance: 0n },
      treasury: { address: address(), balance: 1_000_000n },
      reward: { address: address(), balance: 100_000n },
    },
    sales: {
      lifetimeGrossSales: 0n,
      lifetimeTeamShare: 0n,
      lifetimeRewardShare: 0n,
      lifetimeTreasuryShare: 0n,
      lifetimeStarsSold: 0n,
      purchaseCount: 0n,
    },
  };
}
