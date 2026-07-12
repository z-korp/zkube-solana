import BN from "bn.js";
import { PublicKey, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import {
  deriveGovernanceProposalPda,
  deriveProgressCatalogPda,
  deriveProtocolConfigPda,
  deriveTreasuryLedgerPda,
  deriveYieldPolicyPda,
} from "./pdas";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import type { WalletLike } from "./sessionWallet";

export type GovernanceActionInput =
  | { kind: "setPendingAuthority"; newAuthority: PublicKey }
  | {
      kind: "setPaymasterPolicy";
      paymaster: PublicKey;
      dailyTransactionLimit: number;
      dailyPaidAttemptLimit: number;
      paymasterCap: bigint;
    }
  | {
      kind: "configureYieldStrategy";
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
    }
  | { kind: "setYieldStrategyStatus"; depositsEnabled: boolean; emergencyExit: boolean }
  | { kind: "setYieldAllocation"; rewardBps: number }
  | { kind: "setRevenueAllocation"; rewardBps: number }
  | { kind: "setContentVersion"; contentVersion: number }
  | { kind: "setProgressVersion"; progressVersion: number }
  | {
      kind: "setGovernanceTiming";
      delaySeconds: number;
      executionWindowSeconds: number;
    }
  | { kind: "unpause" };

export interface GovernanceProposalView {
  address: PublicKey;
  proposalId: bigint;
  proposer: PublicKey;
  action: string;
  createdAt: number;
  executeAfter: number;
  expiresAt: number;
  executedAt: number;
  cancelledAt: number;
}

export async function fetchGovernanceProposal(args: {
  connection: Connection;
  wallet: WalletLike;
  proposalId: bigint;
}): Promise<GovernanceProposalView | null> {
  const address = deriveGovernanceProposalPda(args.proposalId);
  const proposal = await zkubeProgram(args.connection, args.wallet).account
    .governanceProposal
    .fetchNullable(address);
  if (!proposal) return null;
  return {
    address,
    proposalId: BigInt(proposal.proposalId.toString()),
    proposer: proposal.proposer,
    action: Object.keys(proposal.action)[0] ?? "unknown",
    createdAt: Number(proposal.createdAt),
    executeAfter: Number(proposal.executeAfter),
    expiresAt: Number(proposal.expiresAt),
    executedAt: Number(proposal.executedAt),
    cancelledAt: Number(proposal.cancelledAt),
  };
}

export async function buildProposeGovernancePlan(args: {
  connection: Connection;
  authority: WalletLike;
  proposalId: bigint;
  action: GovernanceActionInput;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.authority).methods
    .proposeGovernanceV1(new BN(args.proposalId.toString()), encodeAction(args.action))
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      yieldPolicy: deriveYieldPolicyPda(),
      treasuryLedger: deriveTreasuryLedgerPda(),
      proposal: deriveGovernanceProposalPda(args.proposalId),
      authority: args.authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return plan("Propose timelocked governance action", args.connection, args.authority.publicKey, instruction);
}

export async function buildExecuteGovernancePlan(args: {
  connection: Connection;
  caller: WalletLike;
  proposalId: bigint;
  action: GovernanceActionInput;
}): Promise<TransactionPlan> {
  let builder = zkubeProgram(args.connection, args.caller).methods
    .executeGovernanceV1()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      proposal: deriveGovernanceProposalPda(args.proposalId),
      yieldPolicy: deriveYieldPolicyPda(),
      treasuryLedger: deriveTreasuryLedgerPda(),
      caller: args.caller.publicKey,
    });
  if (args.action.kind === "setProgressVersion") {
    builder = builder.remainingAccounts([{
      pubkey: deriveProgressCatalogPda(args.action.progressVersion),
      isSigner: false,
      isWritable: false,
    }]);
  }
  const instruction = await builder.instruction();
  return plan("Execute matured governance action", args.connection, args.caller.publicKey, instruction);
}

export async function buildCancelGovernancePlan(args: {
  connection: Connection;
  authority: WalletLike;
  proposalId: bigint;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.authority).methods
    .cancelGovernanceV1()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      proposal: deriveGovernanceProposalPda(args.proposalId),
      authority: args.authority.publicKey,
    })
    .instruction();
  return plan("Cancel governance proposal", args.connection, args.authority.publicKey, instruction);
}

export async function buildPauseProtocolPlan(args: {
  connection: Connection;
  authority: WalletLike;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.authority).methods
    .pauseProtocolV1()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      authority: args.authority.publicKey,
    })
    .instruction();
  return plan("Emergency-pause protocol", args.connection, args.authority.publicKey, instruction);
}

export async function buildPauseYieldStrategyPlan(args: {
  connection: Connection;
  authority: WalletLike;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.authority).methods
    .pauseYieldStrategyV1()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      yieldPolicy: deriveYieldPolicyPda(),
      authority: args.authority.publicKey,
    })
    .instruction();
  return plan("Emergency-pause yield strategy", args.connection, args.authority.publicKey, instruction);
}

export async function buildAcceptProtocolAuthorityPlan(args: {
  connection: Connection;
  pendingAuthority: WalletLike;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.pendingAuthority).methods
    .acceptProtocolAuthorityV1()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      pendingAuthority: args.pendingAuthority.publicKey,
    })
    .instruction();
  return plan(
    "Accept protocol authority",
    args.connection,
    args.pendingAuthority.publicKey,
    instruction,
  );
}

function encodeAction(action: GovernanceActionInput) {
  switch (action.kind) {
    case "setPendingAuthority":
      return { setPendingAuthority: { newAuthority: action.newAuthority } };
    case "setPaymasterPolicy":
      return {
        setPaymasterPolicy: {
          paymaster: action.paymaster,
          dailyTransactionLimit: action.dailyTransactionLimit,
          dailyPaidAttemptLimit: action.dailyPaidAttemptLimit,
          paymasterCap: new BN(action.paymasterCap.toString()),
        },
      };
    case "configureYieldStrategy":
      return {
        configureYieldStrategy: {
          strategyVersion: action.strategyVersion,
          adapterProgram: action.adapterProgram,
          market: action.market,
          reserve: action.reserve,
          receiptMint: action.receiptMint,
          maxPrincipal: new BN(action.maxPrincipal.toString()),
          maxExposureBps: action.maxExposureBps,
          minLiquidReserveBps: action.minLiquidReserveBps,
          maxSlippageBps: action.maxSlippageBps,
          maxLossBps: action.maxLossBps,
        },
      };
    case "setYieldStrategyStatus":
      return {
        setYieldStrategyStatus: {
          depositsEnabled: action.depositsEnabled,
          emergencyExit: action.emergencyExit,
        },
      };
    case "setYieldAllocation":
      return { setYieldAllocation: { rewardBps: action.rewardBps } };
    case "setRevenueAllocation":
      return { setRevenueAllocation: { rewardBps: action.rewardBps } };
    case "setContentVersion":
      return { setContentVersion: { contentVersion: action.contentVersion } };
    case "setProgressVersion":
      return { setProgressVersion: { progressVersion: action.progressVersion } };
    case "setGovernanceTiming":
      return {
        setGovernanceTiming: {
          delaySeconds: action.delaySeconds,
          executionWindowSeconds: action.executionWindowSeconds,
        },
      };
    case "unpause":
      return { unpause: {} };
  }
}

function plan(
  label: string,
  connection: Connection,
  feePayer: PublicKey,
  instruction: import("@solana/web3.js").TransactionInstruction,
): TransactionPlan {
  return {
    layer: "solana-base",
    label,
    connection,
    transaction: new Transaction().add(instruction),
    feePayer,
    signers: [],
  };
}
