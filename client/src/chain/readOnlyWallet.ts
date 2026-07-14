import {
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";

import type { WalletLike } from "./sessionWallet.js";

/** Anchor only needs a public key for account decoding. This boundary makes
 * accidental signing from spectator/read paths fail closed. */
export function createReadOnlyWallet(
  publicKey: PublicKey = PublicKey.default,
): WalletLike {
  const fail = async <T extends Transaction | VersionedTransaction>(): Promise<T> => {
    throw new Error("Read-only wallet cannot sign transactions");
  };
  return {
    publicKey,
    signTransaction: fail,
    signAllTransactions: async () => {
      throw new Error("Read-only wallet cannot sign transactions");
    },
  };
}
