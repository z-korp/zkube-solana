import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";

import { deriveProtocolConfigPda } from "./pdas";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import type { WalletLike } from "./sessionWallet";

export async function buildSetProtocolPausePlan(args: {
  connection: Connection;
  authority: WalletLike;
  paused: boolean;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.authority).methods
    .setProtocolPause(args.paused)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      authority: args.authority.publicKey,
    })
    .instruction();
  return plan(
    args.paused ? "Pause protocol" : "Unpause protocol",
    args.connection,
    args.authority.publicKey,
    instruction,
  );
}

export function buildPauseProtocolPlan(args: {
  connection: Connection;
  authority: WalletLike;
}): Promise<TransactionPlan> {
  return buildSetProtocolPausePlan({ ...args, paused: true });
}

export async function buildProposeProtocolAuthorityPlan(args: {
  connection: Connection;
  authority: WalletLike;
  pendingAuthority: PublicKey;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.authority).methods
    .proposeProtocolAuthority(args.pendingAuthority)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      authority: args.authority.publicKey,
    })
    .instruction();
  return plan("Propose protocol authority", args.connection, args.authority.publicKey, instruction);
}

export async function buildAcceptProtocolAuthorityPlan(args: {
  connection: Connection;
  pendingAuthority: WalletLike;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.pendingAuthority).methods
    .acceptProtocolAuthority()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      pendingAuthority: args.pendingAuthority.publicKey,
    })
    .instruction();
  return plan("Accept protocol authority", args.connection, args.pendingAuthority.publicKey, instruction);
}

export async function buildSetPricingOperatorPlan(args: {
  connection: Connection;
  authority: WalletLike;
  pricingOperator: PublicKey;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.authority).methods
    .setPricingOperator(args.pricingOperator)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      authority: args.authority.publicKey,
    })
    .instruction();
  return plan("Set pricing operator", args.connection, args.authority.publicKey, instruction);
}

export async function buildUpdateRevenueDestinationsPlan(args: {
  connection: Connection;
  authority: WalletLike;
  paymentMint: PublicKey;
  teamDestination: PublicKey;
  treasuryDestination: PublicKey;
  rewardVault: PublicKey;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.connection, args.authority).methods
    .updateRevenueDestinations()
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      paymentMint: args.paymentMint,
      teamDestination: args.teamDestination,
      treasuryDestination: args.treasuryDestination,
      rewardVault: args.rewardVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      authority: args.authority.publicKey,
    })
    .instruction();
  return plan("Update revenue destinations", args.connection, args.authority.publicKey, instruction);
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
