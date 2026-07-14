import { unpackAccount } from "@solana/spl-token";
import {
  type Connection,
  type PublicKey,
} from "@solana/web3.js";

import { deriveProtocolConfigPda, deriveStarSalesLedgerPda } from "./pdas";
import { createReadOnlyWallet } from "./readOnlyWallet";
import { zkubeProgram } from "./runPlan";

export interface TreasuryView {
  paymentMint: PublicKey;
  paymentTokenProgram: PublicKey;
  paused: boolean;
  authority: PublicKey;
  pendingAuthority: PublicKey;
  pricingOperator: PublicKey;
  paymaster: PublicKey;
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
  const [protocol, ledger] = await Promise.all([
    program.account.protocolConfig.fetchNullable(deriveProtocolConfigPda()),
    program.account.starSalesLedger.fetchNullable(deriveStarSalesLedgerPda()),
  ]);
  if (!protocol || !ledger) return null;
  if (
    Number(protocol.version) !== 1 ||
    Number(ledger.version) !== 1 ||
    !ledger.paymentMint.equals(protocol.paymentMint)
  ) throw new Error("treasury account relationship is invalid");

  const addresses = [protocol.teamDestination, protocol.treasuryDestination, protocol.rewardVault];
  if (new Set(addresses.map((address) => address.toBase58())).size !== addresses.length) {
    throw new Error("revenue destinations are not segregated");
  }
  const infos = await connection.getMultipleAccountsInfo(addresses, "confirmed");
  const balances = infos.map((info, index) => {
    const address = addresses[index];
    if (!info) throw new Error(`revenue destination ${address.toBase58()} is missing`);
    if (!info.owner.equals(protocol.paymentTokenProgram)) {
      throw new Error(`revenue destination ${address.toBase58()} has the wrong owner`);
    }
    const account = unpackAccount(address, info, protocol.paymentTokenProgram);
    if (!account.mint.equals(protocol.paymentMint)) {
      throw new Error(`revenue destination ${address.toBase58()} has the wrong mint`);
    }
    return account.amount;
  });
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
    paymentMint: protocol.paymentMint,
    paymentTokenProgram: protocol.paymentTokenProgram,
    paused: Boolean(protocol.paused),
    authority: protocol.authority,
    pendingAuthority: protocol.pendingAuthority,
    pricingOperator: protocol.pricingOperator,
    paymaster: protocol.paymaster,
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
  ) throw new Error("Star sale accounting does not conserve USDC base units");
  if (accounting.purchaseCount === 0n && accounting.lifetimeStarsSold !== 0n) {
    throw new Error("Stars sold without a recorded purchase");
  }
}

function asBigInt(value: { toString(): string }): bigint {
  return BigInt(value.toString());
}
