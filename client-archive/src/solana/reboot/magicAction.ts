import {
  createTopUpEscrowInstruction,
  escrowPdaFromEscrowAuthority,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const MAGIC_ACTION_ESCROW_INDEX = 255;
export const DEFAULT_ACTION_ESCROW_TOP_UP_LAMPORTS = 10_000;

export function deriveMagicActionEscrowPda(authority: PublicKey): PublicKey {
  return escrowPdaFromEscrowAuthority(authority, MAGIC_ACTION_ESCROW_INDEX);
}

export function buildTopUpMagicActionEscrowInstruction(args: {
  authority: PublicKey;
  payer?: PublicKey;
  lamports?: number;
}): TransactionInstruction {
  return createTopUpEscrowInstruction(
    deriveMagicActionEscrowPda(args.authority),
    args.authority,
    args.payer ?? args.authority,
    args.lamports ?? DEFAULT_ACTION_ESCROW_TOP_UP_LAMPORTS,
    MAGIC_ACTION_ESCROW_INDEX,
  );
}
