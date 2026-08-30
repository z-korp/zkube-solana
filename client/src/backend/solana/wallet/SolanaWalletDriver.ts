import { Context, Effect, Schema } from "effect";
import { VersionedTransaction } from "@solana/web3.js";
import type { WalletAccount, Wallet } from "@wallet-standard/base";

import type { WalletChoice } from "../../views";
import type { WalletLike } from "../session/sessionWallet";
import {
  signWalletStandardMessage,
  type WalletConnector,
} from "./walletStandard";

export class SolanaWalletDriverError extends Schema.TaggedError<SolanaWalletDriverError>()(
  "SolanaWalletDriverError",
  { message: Schema.String },
) {}

interface WalletStandardBinding {
  readonly connector: WalletConnector;
  readonly account: WalletAccount;
  readonly wallet: WalletLike;
  readonly standardWallet: Wallet;
}

export interface SolanaWalletBinding {
  readonly choice: WalletChoice;
  readonly wallet: WalletLike;
  readonly driver: SolanaWalletDriverService;
  readonly disconnect: () => Promise<void>;
  readonly subscribeDisconnected: (listener: () => void) => () => void;
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
  current: () => WalletStandardBinding | null,
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

export function activeSolanaWalletDriver(
  current: () => SolanaWalletBinding | null,
): SolanaWalletDriverService {
  const active = () => {
    const binding = current();
    if (!binding) throw new Error("No Solana wallet is connected");
    return binding.driver;
  };
  return {
    signTransaction: (transaction) =>
      Effect.suspend(() => active().signTransaction(transaction)),
    signMessage: (message) =>
      Effect.suspend(() => active().signMessage(message)),
  };
}

function walletDriverError(cause: unknown): SolanaWalletDriverError {
  return cause instanceof SolanaWalletDriverError
    ? cause
    : new SolanaWalletDriverError({
        message: cause instanceof Error ? cause.message : String(cause),
      });
}
