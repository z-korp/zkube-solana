import { AnchorProvider, Program } from "@anchor-lang/core";
import { PublicKey, type Connection, type Signer, type Transaction } from "@solana/web3.js";
import { IDL, type ZkubeProgram } from "./idl/index.js";
import type { WalletLike } from "./sessionWallet.js";

export interface TransactionPlan {
  layer: "solana-base" | "magicblock-er";
  label: string;
  connection: Connection;
  transaction: Transaction;
  feePayer: PublicKey;
  signers: Signer[];
  /** Spendable balance retained above the zero-data System-account rent floor. */
  postFeeRentReserveLamports?: number;
}

export const VRF_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");

export function zkubeProgram(connection: Connection, wallet: WalletLike): Program<ZkubeProgram> {
  return new Program<ZkubeProgram>(IDL, new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  }));
}
