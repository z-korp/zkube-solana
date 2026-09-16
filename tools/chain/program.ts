import { AnchorProvider, Program } from "@anchor-lang/core";
import { PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import { IDL, type ZkubeProgram } from "./idl/index.js";
import type { WalletLike } from "./readOnlyWallet.js";

export interface TransactionPlan {
  label: string;
  transaction: Transaction;
  feePayer: PublicKey;
}

export function zkubeProgram(connection: Connection, wallet: WalletLike): Program<ZkubeProgram> {
  return new Program<ZkubeProgram>(IDL, new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  }));
}
