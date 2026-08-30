import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import type { Wallet } from "@wallet-standard/base";

export interface WalletCapabilityDiagnostic {
  name: string;
  chains: readonly string[];
  featureKeys: readonly string[];
  signTransaction: {
    present: boolean;
    supportedTransactionVersions: readonly string[];
  };
  signAndSendTransaction: {
    present: boolean;
    supportedTransactionVersions: readonly string[];
  };
}

/** Returns public Wallet Standard metadata without reading accounts or methods. */
export function describeWalletCapabilities(
  wallet: Wallet,
): WalletCapabilityDiagnostic {
  const signTransaction = wallet.features[SolanaSignTransaction] as
    | SolanaSignTransactionFeature[typeof SolanaSignTransaction]
    | undefined;
  const signAndSendTransaction = wallet.features[
    SolanaSignAndSendTransaction
  ] as
    | SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction]
    | undefined;

  return {
    name: wallet.name,
    chains: [...wallet.chains].sort(),
    featureKeys: Object.keys(wallet.features).sort(),
    signTransaction: {
      present: signTransaction !== undefined,
      supportedTransactionVersions: transactionVersions(signTransaction),
    },
    signAndSendTransaction: {
      present: signAndSendTransaction !== undefined,
      supportedTransactionVersions: transactionVersions(signAndSendTransaction),
    },
  };
}

function transactionVersions(
  feature:
    | SolanaSignTransactionFeature[typeof SolanaSignTransaction]
    | SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction]
    | undefined,
): string[] {
  return feature?.supportedTransactionVersions.map(String).sort() ?? [];
}
