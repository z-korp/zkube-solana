import {
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";

import { deviceSignerTopUpLamports } from "./deviceSessionFunding";

export function buildDeviceSessionRefillInstructions(args: {
  owner: PublicKey;
  signer: PublicKey;
  balanceLamports: number;
}): { instructions: TransactionInstruction[]; topUpLamports: number } {
  const topUpLamports = deviceSignerTopUpLamports(args.balanceLamports);
  if (topUpLamports <= 0) {
    throw new Error("The device signer does not need a refill");
  }
  return {
    topUpLamports,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: args.owner,
        toPubkey: args.signer,
        lamports: topUpLamports,
      }),
      // This zero-value transfer proves control of the local signer in the
      // exact owner-approved message. It follows the top-up so a signer whose
      // zero balance removed its System account can be recreated in place.
      SystemProgram.transfer({
        fromPubkey: args.signer,
        toPubkey: args.owner,
        lamports: 0,
      }),
    ],
  };
}

export function buildDeviceSignerReclaimInstruction(args: {
  owner: PublicKey;
  signer: PublicKey;
  balanceLamports: number;
}): TransactionInstruction | null {
  if (!Number.isSafeInteger(args.balanceLamports) || args.balanceLamports < 0) {
    throw new Error("device signer balance is invalid");
  }
  return args.balanceLamports === 0
    ? null
    : SystemProgram.transfer({
        fromPubkey: args.signer,
        toPubkey: args.owner,
        lamports: args.balanceLamports,
      });
}
