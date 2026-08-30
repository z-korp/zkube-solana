import { Context, Effect, Schema } from "effect";
import { VersionedTransaction } from "@solana/web3.js";
import type { WalletAccount, Wallet } from "@wallet-standard/base";

import type { WalletLike } from "../session/sessionWallet";
import {
  signWalletStandardMessage,
  type WalletConnector,
} from "./walletStandard";

export class SolanaWalletDriverError extends Schema.TaggedError<SolanaWalletDriverError>()(
  "SolanaWalletDriverError",
  { message: Schema.String },
) {}

export interface SolanaWalletBinding {
  readonly connector: WalletConnector;
  readonly account: WalletAccount;
  readonly wallet: WalletLike;
  readonly standardWallet: Wallet;
}

export interface SolanaWalletDriverService {
  readonly signTransaction: (
    transaction: VersionedTransaction,
  ) => Effect.Effect<VersionedTransaction, SolanaWalletDriverError>;
  readonly signMessage: (
    message: Uint8Array,
  ) => Effect.Effect<Uint8Array, SolanaWalletDriverError>;
}

export class SolanaWalletDriver extends Context.Tag(
  "zkube/backend/solana/SolanaWalletDriver",
)<SolanaWalletDriver, SolanaWalletDriverService>() {}

export function browserSolanaWalletDriver(
  current: () => SolanaWalletBinding | null,
): SolanaWalletDriverService {
  const binding = () => {
    const value = current();
    if (!value) throw new Error("No Solana wallet is connected");
    return value;
  };
  return {
    signTransaction: (transaction) =>
      Effect.tryPromise({
        try: async () => {
          if (transaction.message.version !== 0) {
            throw new Error(
              "Solana wallet driver accepts v0 transactions only",
            );
          }
          return binding().wallet.signTransaction(transaction);
        },
        catch: walletDriverError,
      }),
    signMessage: (message) =>
      Effect.tryPromise({
        try: () => {
          const value = binding();
          return signWalletStandardMessage(
            value.standardWallet,
            value.account,
            message,
          );
        },
        catch: walletDriverError,
      }),
  };
}

function walletDriverError(cause: unknown): SolanaWalletDriverError {
  return cause instanceof SolanaWalletDriverError
    ? cause
    : new SolanaWalletDriverError({
        message: cause instanceof Error ? cause.message : String(cause),
      });
}
