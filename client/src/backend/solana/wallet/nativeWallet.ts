import { Effect } from "effect";
import {
  PublicKey,
  VersionedTransaction,
  type Transaction,
} from "@solana/web3.js";

import type { WalletChoice } from "../../views";
import type { WalletLike } from "../session/sessionWallet";
import type {
  SolanaWalletBinding,
  SolanaWalletDriverService,
} from "./SolanaWalletDriver";

export interface SolanaIdentityConnector {
  readonly choice: WalletChoice;
  readonly connect: (options?: {
    readonly silent?: boolean;
  }) => Promise<SolanaWalletBinding | null>;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function assertBytesEqual(
  expected: Uint8Array,
  actual: Uint8Array,
  message: string,
): void {
  if (
    expected.length !== actual.length ||
    !expected.every((byte, index) => byte === actual[index])
  ) {
    throw new Error(message);
  }
}

export function nativeDriverWallet(
  publicKey: PublicKey,
  driver: SolanaWalletDriverService,
): WalletLike {
  const wallet: WalletLike = {
    publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(
      transaction: T,
    ): Promise<T> => {
      if (!(transaction instanceof VersionedTransaction)) {
        throw new Error("Native wallets accept v0 transactions only");
      }
      return (await Effect.runPromise(
        driver.signTransaction(transaction),
      )) as T;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(
      transactions: T[],
    ): Promise<T[]> =>
      Promise.all(
        transactions.map((transaction) => wallet.signTransaction(transaction)),
      ),
  };
  return wallet;
}
