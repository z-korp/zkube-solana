import {
  type Connection,
  type PublicKey,
} from "@solana/web3.js";

import {
  deriveEconomyConfigPda,
  deriveProtocolConfigPda,
  deriveRewardVaultPda,
  deriveStarSalesLedgerPda,
} from "./pdas";
import { createReadOnlyWallet } from "./readOnlyWallet";
import { zkubeProgram } from "./runPlan";

export interface TreasuryView {
  paused: boolean;
  authority: PublicKey;
  pendingAuthority: PublicKey;
  pricingOperator: PublicKey;
  destinations: {
    team: { address: PublicKey; balance: bigint };
    treasury: { address: PublicKey; balance: bigint };
    reward: { address: PublicKey; balance: bigint };
  };
  sales: StarSalesAccounting;
}

export interface StarSalesAccounting {
  lifetimeGrossSales: bigint;
  lifetimeTeamShare: bigint;
  lifetimeRewardShare: bigint;
  lifetimeTreasuryShare: bigint;
  lifetimeStarsSold: bigint;
  purchaseCount: bigint;
}

const READ_ONLY_WALLET = createReadOnlyWallet();

export async function fetchTreasuryView(connection: Connection): Promise<TreasuryView | null> {
  const program = zkubeProgram(connection, READ_ONLY_WALLET);
  const [protocol, ledger, rewardVault] = await Promise.all([
    program.account.protocolConfig.fetchNullable(deriveProtocolConfigPda()),
    program.account.starSalesLedger.fetchNullable(deriveStarSalesLedgerPda()),
    program.account.rewardVault.fetchNullable(deriveRewardVaultPda()),
  ]);
  if (!protocol || !ledger || !rewardVault) return null;
  if (
    Number(protocol.version) !== 1 ||
    Number(ledger.version) !== 1 ||
    !ledger.economyConfig.equals(deriveEconomyConfigPda()) ||
    !protocol.rewardVault.equals(deriveRewardVaultPda()) ||
    !rewardVault.protocol.equals(deriveProtocolConfigPda())
  ) throw new Error("treasury account relationship is invalid");

  const addresses = [protocol.teamDestination, protocol.treasuryDestination, protocol.rewardVault];
  if (new Set(addresses.map((address) => address.toBase58())).size !== addresses.length) {
    throw new Error("revenue destinations are not segregated");
  }
  const balances = await Promise.all(
    addresses.map(async (address) => BigInt(await connection.getBalance(address, "confirmed"))),
  );
  const sales: StarSalesAccounting = {
    lifetimeGrossSales: asBigInt(ledger.lifetimeGrossSales),
    lifetimeTeamShare: asBigInt(ledger.lifetimeTeamShare),
    lifetimeRewardShare: asBigInt(ledger.lifetimeRewardShare),
    lifetimeTreasuryShare: asBigInt(ledger.lifetimeTreasuryShare),
    lifetimeStarsSold: asBigInt(ledger.lifetimeStarsSold),
    purchaseCount: asBigInt(ledger.purchaseCount),
  };
  assertStarSalesAccounting(sales);
  return {
    paused: Boolean(protocol.paused),
    authority: protocol.authority,
    pendingAuthority: protocol.pendingAuthority,
    pricingOperator: protocol.pricingOperator,
    destinations: {
      team: { address: addresses[0], balance: balances[0] },
      treasury: { address: addresses[1], balance: balances[1] },
      reward: { address: addresses[2], balance: balances[2] },
    },
    sales,
  };
}

export function assertStarSalesAccounting(accounting: StarSalesAccounting): void {
  if (
    accounting.lifetimeTeamShare
      + accounting.lifetimeRewardShare
      + accounting.lifetimeTreasuryShare
      !== accounting.lifetimeGrossSales
  ) throw new Error("Star sale accounting does not conserve lamports");
  if (accounting.purchaseCount === 0n && accounting.lifetimeStarsSold !== 0n) {
    throw new Error("Stars sold without a recorded purchase");
  }
}

function asBigInt(value: { toString(): string }): bigint {
  return BigInt(value.toString());
}
