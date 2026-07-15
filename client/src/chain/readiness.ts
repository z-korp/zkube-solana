import { PublicKey } from "@solana/web3.js";

import type { TreasuryView } from "./treasuryClient";

export type ReadinessSeverity = "info" | "warning" | "critical";

export interface ReadinessAlert {
  severity: ReadinessSeverity;
  code: string;
  message: string;
}

export interface TreasuryReadiness {
  ok: boolean;
  alerts: ReadinessAlert[];
  balances: {
    team: bigint;
    treasury: bigint;
    rewards: bigint;
  };
  sales: {
    gross: bigint;
    team: bigint;
    rewards: bigint;
    treasury: bigint;
    starsSold: bigint;
    purchases: bigint;
  };
}

export function evaluateTreasuryReadiness(treasury: TreasuryView): TreasuryReadiness {
  const alerts: ReadinessAlert[] = [];
  if (treasury.paused) {
    alerts.push(alert("critical", "PROTOCOL_PAUSED", "Protocol writes are paused"));
  }
  if (!treasury.pendingAuthority.equals(PublicKey.default)) {
    alerts.push(alert("warning", "AUTHORITY_TRANSFER_PENDING", "A protocol authority transfer is pending"));
  }
  if (treasury.destinations.reward.balance === 0n) {
    alerts.push(alert("warning", "REWARD_RESERVE_EMPTY", "Weekly SOL rewards are currently unfunded"));
  }
  if (treasury.sales.lifetimeGrossSales > 0n) {
    const teamBps = basisPoints(treasury.sales.lifetimeTeamShare, treasury.sales.lifetimeGrossSales);
    const rewardBps = basisPoints(treasury.sales.lifetimeRewardShare, treasury.sales.lifetimeGrossSales);
    if (teamBps > 1_000 || rewardBps > 1_000) {
      alerts.push(alert("critical", "SALE_SPLIT_DRIFT", "Recorded Star sale shares exceed the 10/10 caps"));
    }
  }
  return {
    ok: !alerts.some((entry) => entry.severity === "critical"),
    alerts,
    balances: {
      team: treasury.destinations.team.balance,
      treasury: treasury.destinations.treasury.balance,
      rewards: treasury.destinations.reward.balance,
    },
    sales: {
      gross: treasury.sales.lifetimeGrossSales,
      team: treasury.sales.lifetimeTeamShare,
      rewards: treasury.sales.lifetimeRewardShare,
      treasury: treasury.sales.lifetimeTreasuryShare,
      starsSold: treasury.sales.lifetimeStarsSold,
      purchases: treasury.sales.purchaseCount,
    },
  };
}

function basisPoints(part: bigint, total: bigint): number {
  if (part <= 0n || total <= 0n) return 0;
  return Number(part * 10_000n / total);
}

function alert(severity: ReadinessSeverity, code: string, message: string): ReadinessAlert {
  return { severity, code, message };
}
