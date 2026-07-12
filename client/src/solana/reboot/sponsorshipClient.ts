import {
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "../constants";
import { deriveProtocolConfigPda, deriveSponsorAllowancePda } from "./pdas";

export const CONSUME_SPONSORSHIP_V1_DISCRIMINATOR = [
  59, 233, 232, 90, 10, 245, 139, 141,
] as const;

export function buildConsumeSponsorshipInstruction(args: {
  owner: PublicKey;
  paymaster: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: ZKUBE_PROGRAM_ID,
    keys: [
      { pubkey: deriveProtocolConfigPda(), isSigner: false, isWritable: false },
      { pubkey: deriveSponsorAllowancePda(args.owner), isSigner: false, isWritable: true },
      { pubkey: args.paymaster, isSigner: true, isWritable: true },
      { pubkey: args.owner, isSigner: true, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(CONSUME_SPONSORSHIP_V1_DISCRIMINATOR),
  });
}

export function withSponsorshipInstruction(args: {
  owner: PublicKey;
  paymaster: PublicKey;
  instructions: import("@solana/web3.js").TransactionInstruction[];
}): import("@solana/web3.js").TransactionInstruction[] {
  return [buildConsumeSponsorshipInstruction(args), ...args.instructions];
}
