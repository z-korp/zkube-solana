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
  strategy: {
    totalTrackedCapital: bigint;
    exposureBps: number;
    liquidReserveBps: number;
    realizedLossBps: number;
    unallocatedYield: bigint;
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
  if (treasury.yieldPolicy.emergencyExit) {
    alerts.push(alert("critical", "YIELD_EMERGENCY", "Yield policy is in emergency-exit state"));
  }
  if (treasury.vaults.paymaster.balance === 0n) {
    alerts.push(alert("warning", "PAYMASTER_RESERVE_EMPTY", "Paymaster reserve token balance is zero"));
  }

  const principal = treasury.ledger.strategyPrincipal;
  const liquid = treasury.vaults.treasury.balance;
  const totalTrackedCapital = principal + liquid;
  const exposureBps = basisPoints(principal, totalTrackedCapital);
  const liquidReserveBps = basisPoints(liquid, totalTrackedCapital);
  const realizedLossBps = basisPoints(
    treasury.ledger.realizedStrategyLosses,
    treasury.ledger.lifetimeStrategyDeposited,
  );
  const unallocatedYield = treasury.ledger.realizedYield
    - treasury.ledger.yieldAllocatedToRewards
    - treasury.ledger.yieldRetainedInTreasury;

  if (principal > 0n && !treasury.yieldPolicy.configured) {
    alerts.push(alert("critical", "UNCONFIGURED_STRATEGY_PRINCIPAL", "Principal exists without a configured strategy"));
  }
  if (treasury.yieldPolicy.configured) {
    if (principal > treasury.yieldPolicy.maxPrincipal) {
      alerts.push(alert("critical", "STRATEGY_PRINCIPAL_CAP", "Outstanding principal exceeds the strategy cap"));
    }
    if (exposureBps > treasury.yieldPolicy.maxExposureBps) {
      alerts.push(alert("critical", "STRATEGY_EXPOSURE", "Strategy exposure exceeds the configured limit"));
    }
    if (totalTrackedCapital > 0n && liquidReserveBps < treasury.yieldPolicy.minLiquidReserveBps) {
      alerts.push(alert("critical", "LIQUID_RESERVE", "Liquid treasury reserve is below the configured minimum"));
    }
    if (realizedLossBps > treasury.yieldPolicy.maxLossBps) {
      alerts.push(alert("critical", "REALIZED_LOSS", "Realized strategy loss exceeds the configured limit"));
    }
  }
  if (unallocatedYield > 0n) {
    alerts.push(alert("warning", "UNALLOCATED_YIELD", "Recorded realized yield is awaiting allocation"));
  }

  return {
    ok: !alerts.some((entry) => entry.severity === "critical"),
    alerts,
    strategy: {
      totalTrackedCapital,
      exposureBps,
      liquidReserveBps,
      realizedLossBps,
      unallocatedYield,
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
