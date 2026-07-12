import { unpackAccount } from "@solana/spl-token";
import {
  PublicKey,
  Transaction,
  type Connection,
  type VersionedTransaction,
} from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "./constants";
import {
  deriveProtocolConfigPda,
  deriveTreasuryLedgerPda,
  deriveYieldPolicyPda,
} from "./pdas";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import type { WalletLike } from "./sessionWallet";

export interface TreasuryView {
  paymentMint: PublicKey;
  paymentTokenProgram: PublicKey;
  paused: boolean;
  authority: PublicKey;
  paymaster: PublicKey;
  pendingAuthority: PublicKey;
  governanceDelaySeconds: number;
  governanceExecutionWindowSeconds: number;
  nextGovernanceProposalId: bigint;
  revenueRewardBps: number;
  yieldPolicy: YieldPolicyView;
  vaults: {
    team: { address: PublicKey; balance: bigint };
    paymaster: { address: PublicKey; balance: bigint };
    treasury: { address: PublicKey; balance: bigint };
    reward: { address: PublicKey; balance: bigint };
    payment: { address: PublicKey; balance: bigint };
  };
  ledger: TreasuryAccounting;
}

export interface YieldPolicyView {
  configured: boolean;
  strategyVersion: number;
  adapterProgram: PublicKey;
  market: PublicKey;
  reserve: PublicKey;
  receiptMint: PublicKey;
  maxPrincipal: bigint;
  maxExposureBps: number;
  minLiquidReserveBps: number;
  maxSlippageBps: number;
  maxLossBps: number;
  yieldRewardBps: number;
  depositsEnabled: boolean;
  emergencyExit: boolean;
}

export interface TreasuryAccounting {
  lifetimeRakeReceived: bigint;
  lifetimeTeamDistributed: bigint;
  lifetimePaymasterDistributed: bigint;
  lifetimeTreasuryDistributed: bigint;
  lifetimePrizesForfeitedToRewards: bigint;
  lifetimeMapSales: bigint;
  lifetimeRevenueSwept: bigint;
  lifetimeRevenueToTreasury: bigint;
  lifetimeRevenueToRewards: bigint;
  realizedYield: bigint;
  yieldAllocatedToRewards: bigint;
  yieldRetainedInTreasury: bigint;
  lifetimeStrategyDeposited: bigint;
  lifetimeStrategyPrincipalRepaid: bigint;
  strategyPrincipal: bigint;
  realizedStrategyLosses: bigint;
}

const READ_ONLY_WALLET: WalletLike = {
  publicKey: ZKUBE_PROGRAM_ID,
  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    void transaction;
    throw new Error("read-only treasury client cannot sign");
  },
  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    void transactions;
    throw new Error("read-only treasury client cannot sign");
  },
};

export async function fetchTreasuryView(connection: Connection): Promise<TreasuryView | null> {
  const program = zkubeProgram(connection, READ_ONLY_WALLET);
  const [protocol, ledger, yieldPolicy] = await Promise.all([
    program.account.protocolConfig.fetchNullable(deriveProtocolConfigPda()),
    program.account.treasuryLedger.fetchNullable(deriveTreasuryLedgerPda()),
    program.account.yieldStrategyPolicy.fetchNullable(deriveYieldPolicyPda()),
  ]);
  if (!protocol || !ledger || !yieldPolicy) return null;
  if (
    Number(protocol.version) !== 1
    || Number(ledger.version) !== 1
    || Number(yieldPolicy.version) !== 1
    || Number(protocol.revenueRewardBps) > 10_000
    || !protocol.treasuryLedger.equals(deriveTreasuryLedgerPda())
    || !protocol.yieldPolicy.equals(deriveYieldPolicyPda())
    || !ledger.protocol.equals(deriveProtocolConfigPda())
    || !yieldPolicy.protocol.equals(deriveProtocolConfigPda())
    || !ledger.paymentMint.equals(protocol.paymentMint)
  ) throw new Error("treasury account relationship is invalid");
  const strategyVersion = Number(yieldPolicy.strategyVersion);
  const maxPrincipal = asBigInt(yieldPolicy.maxPrincipal);
  const maxExposureBps = Number(yieldPolicy.maxExposureBps);
  const minLiquidReserveBps = Number(yieldPolicy.minLiquidReserveBps);
  const maxSlippageBps = Number(yieldPolicy.maxSlippageBps);
  const maxLossBps = Number(yieldPolicy.maxLossBps);
  const yieldRewardBps = Number(yieldPolicy.yieldRewardBps);
  const configured = strategyVersion > 0
    && !yieldPolicy.adapterProgram.equals(PublicKey.default)
    && !yieldPolicy.market.equals(PublicKey.default)
    && !yieldPolicy.reserve.equals(PublicKey.default)
    && !yieldPolicy.receiptMint.equals(PublicKey.default)
    && maxPrincipal > 0n;
  const pristine = strategyVersion === 0
    && yieldPolicy.adapterProgram.equals(PublicKey.default)
    && yieldPolicy.market.equals(PublicKey.default)
    && yieldPolicy.reserve.equals(PublicKey.default)
    && yieldPolicy.receiptMint.equals(PublicKey.default)
    && maxPrincipal === 0n
    && maxExposureBps === 0
    && minLiquidReserveBps === 10_000
    && maxSlippageBps === 0
    && maxLossBps === 0;
  if (
    !pristine && !configured
  ) throw new Error("yield policy is invalid");
  const addresses = [
    protocol.teamVault,
    protocol.paymasterVault,
    protocol.treasuryVault,
    protocol.rewardVault,
    protocol.paymentVault,
  ];
  const accountInfos = await connection.getMultipleAccountsInfo(addresses, "confirmed");
  const balances = accountInfos.map((info, index) => {
    if (!info) throw new Error(`treasury vault ${addresses[index].toBase58()} is missing`);
    if (!info.owner.equals(protocol.paymentTokenProgram)) {
      throw new Error(`treasury vault ${addresses[index].toBase58()} has the wrong owner`);
    }
    const account = unpackAccount(
      addresses[index],
      info,
      protocol.paymentTokenProgram,
    );
    if (!account.mint.equals(protocol.paymentMint)) {
      throw new Error(`treasury vault ${addresses[index].toBase58()} has the wrong mint`);
    }
    return account.amount;
  });
  const accounting: TreasuryAccounting = {
    lifetimeRakeReceived: asBigInt(ledger.lifetimeRakeReceived),
    lifetimeTeamDistributed: asBigInt(ledger.lifetimeTeamDistributed),
    lifetimePaymasterDistributed: asBigInt(ledger.lifetimePaymasterDistributed),
    lifetimeTreasuryDistributed: asBigInt(ledger.lifetimeTreasuryDistributed),
    lifetimePrizesForfeitedToRewards: asBigInt(ledger.lifetimePrizesForfeitedToRewards),
    lifetimeMapSales: asBigInt(ledger.lifetimeMapSales),
    lifetimeRevenueSwept: asBigInt(ledger.lifetimeRevenueSwept),
    lifetimeRevenueToTreasury: asBigInt(ledger.lifetimeRevenueToTreasury),
    lifetimeRevenueToRewards: asBigInt(ledger.lifetimeRevenueToRewards),
    realizedYield: asBigInt(ledger.realizedYield),
    yieldAllocatedToRewards: asBigInt(ledger.yieldAllocatedToRewards),
    yieldRetainedInTreasury: asBigInt(ledger.yieldRetainedInTreasury),
    lifetimeStrategyDeposited: asBigInt(ledger.lifetimeStrategyDeposited),
    lifetimeStrategyPrincipalRepaid: asBigInt(ledger.lifetimeStrategyPrincipalRepaid),
    strategyPrincipal: asBigInt(ledger.strategyPrincipal),
    realizedStrategyLosses: asBigInt(ledger.realizedStrategyLosses),
  };
  assertTreasuryAccounting(accounting);
  const policy: YieldPolicyView = {
    configured,
    strategyVersion,
    adapterProgram: yieldPolicy.adapterProgram,
    market: yieldPolicy.market,
    reserve: yieldPolicy.reserve,
    receiptMint: yieldPolicy.receiptMint,
    maxPrincipal,
    maxExposureBps,
    minLiquidReserveBps,
    maxSlippageBps,
    maxLossBps,
    yieldRewardBps,
    depositsEnabled: Boolean(yieldPolicy.depositsEnabled),
    emergencyExit: Boolean(yieldPolicy.emergencyExit),
  };
  assertYieldPolicy(policy);
  return {
    paymentMint: protocol.paymentMint,
    paymentTokenProgram: protocol.paymentTokenProgram,
    paused: Boolean(protocol.paused),
    authority: protocol.authority,
    paymaster: protocol.paymaster,
    pendingAuthority: protocol.pendingAuthority,
    governanceDelaySeconds: Number(protocol.governanceDelaySeconds),
    governanceExecutionWindowSeconds: Number(protocol.governanceExecutionWindowSeconds),
    nextGovernanceProposalId: asBigInt(protocol.nextGovernanceProposalId),
    revenueRewardBps: Number(protocol.revenueRewardBps),
    yieldPolicy: policy,
    vaults: {
      team: { address: addresses[0], balance: balances[0] },
      paymaster: { address: addresses[1], balance: balances[1] },
      treasury: { address: addresses[2], balance: balances[2] },
      reward: { address: addresses[3], balance: balances[3] },
      payment: { address: addresses[4], balance: balances[4] },
    },
    ledger: accounting,
  };
}

export async function buildSweepProtocolRevenuePlan(args: {
  connection: Connection;
  caller: WalletLike;
  treasury: TreasuryView;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.caller).methods
    .sweepProtocolRevenueV1()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      treasuryLedger: deriveTreasuryLedgerPda(),
      paymentMint: args.treasury.paymentMint,
      paymentVault: args.treasury.vaults.payment.address,
      treasuryVault: args.treasury.vaults.treasury.address,
      rewardVault: args.treasury.vaults.reward.address,
      paymentTokenProgram: args.treasury.paymentTokenProgram,
      caller: args.caller.publicKey,
    })
    .instruction();
  return {
    layer: "solana-base",
    label: "Sweep attributable protocol revenue",
    connection: args.connection,
    transaction: new Transaction().add(instruction),
    feePayer: args.caller.publicKey,
    signers: [],
  };
}

export async function buildAllocateRealizedYieldPlan(args: {
  connection: Connection;
  caller: WalletLike;
  treasury: TreasuryView;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.caller).methods
    .allocateRealizedYieldV1()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      yieldPolicy: deriveYieldPolicyPda(),
      treasuryLedger: deriveTreasuryLedgerPda(),
      paymentMint: args.treasury.paymentMint,
      treasuryVault: args.treasury.vaults.treasury.address,
      rewardVault: args.treasury.vaults.reward.address,
      paymentTokenProgram: args.treasury.paymentTokenProgram,
      caller: args.caller.publicKey,
    })
    .instruction();
  return {
    layer: "solana-base",
    label: "Allocate realized yield to rewards",
    connection: args.connection,
    transaction: new Transaction().add(instruction),
    feePayer: args.caller.publicKey,
    signers: [],
  };
}

export function assertTreasuryAccounting(accounting: TreasuryAccounting): void {
  const distributed = accounting.lifetimeTeamDistributed
    + accounting.lifetimePaymasterDistributed
    + accounting.lifetimeTreasuryDistributed;
  if (distributed !== accounting.lifetimeRakeReceived) {
    throw new Error("treasury rake accounting does not conserve base units");
  }
  if (
    accounting.yieldAllocatedToRewards + accounting.yieldRetainedInTreasury
      > accounting.realizedYield
  ) {
    throw new Error("processed yield exceeds realized yield");
  }
  if (
    accounting.strategyPrincipal
      + accounting.lifetimeStrategyPrincipalRepaid
      + accounting.realizedStrategyLosses
      !== accounting.lifetimeStrategyDeposited
  ) {
    throw new Error("strategy principal accounting does not conserve base units");
  }
  if (
    accounting.lifetimeRevenueToTreasury + accounting.lifetimeRevenueToRewards
      !== accounting.lifetimeRevenueSwept
    || accounting.lifetimeRevenueSwept > accounting.lifetimeMapSales
  ) throw new Error("protocol revenue accounting does not conserve base units");
}

export function assertYieldPolicy(policy: YieldPolicyView): void {
  if (!Number.isInteger(policy.yieldRewardBps) || policy.yieldRewardBps < 0 || policy.yieldRewardBps > 10_000) {
    throw new Error("yield reward allocation is outside basis-point bounds");
  }
  if (policy.depositsEnabled && (policy.emergencyExit || !policy.configured)) {
    throw new Error("yield deposits are enabled without a safe configured policy");
  }
  if (!policy.configured) {
    if (policy.strategyVersion !== 0) throw new Error("unconfigured yield policy has a strategy version");
    return;
  }
  if (
    policy.strategyVersion < 1
    || policy.maxPrincipal <= 0n
    || policy.maxExposureBps < 1
    || policy.maxExposureBps > 5_000
    || policy.minLiquidReserveBps < 5_000
    || policy.minLiquidReserveBps > 10_000
    || policy.maxSlippageBps < 0
    || policy.maxSlippageBps > 100
    || policy.maxLossBps < 0
    || policy.maxLossBps > 1_000
  ) throw new Error("configured yield policy exceeds safety bounds");
}

function asBigInt(value: { toString(): string }): bigint {
  return BigInt(value.toString());
}
