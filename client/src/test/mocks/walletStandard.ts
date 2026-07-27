import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionInput,
  type SolanaSignAndSendTransactionOutput,
  type SolanaSignTransactionInput,
  type SolanaSignTransactionOutput,
  type SolanaTransactionVersion,
} from "@solana/wallet-standard-features";
import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { StandardConnect } from "@wallet-standard/features";
import { vi } from "vitest";

import type { WalletConnector } from "@/platform/walletStandard";

type SignTransactionResponder = (
  inputs: readonly SolanaSignTransactionInput[],
) =>
  | readonly SolanaSignTransactionOutput[]
  | Promise<readonly SolanaSignTransactionOutput[]>;

type SignAndSendTransactionResponder = (
  inputs: readonly SolanaSignAndSendTransactionInput[],
) =>
  | readonly SolanaSignAndSendTransactionOutput[]
  | Promise<readonly SolanaSignAndSendTransactionOutput[]>;

export interface FakeWalletStandardOptions {
  keypair?: Keypair;
  name?: string;
  chains?: readonly string[];
  accounts?: readonly WalletAccount[];
  accountChains?: readonly string[];
  accountFeatures?: readonly string[];
  signTransactionVersions?: readonly SolanaTransactionVersion[] | null;
  signTransactionOutputs?: SignTransactionResponder;
  signAndSendTransactionVersions?: readonly SolanaTransactionVersion[] | null;
  signAndSendTransactionOutputs?: SignAndSendTransactionResponder;
}

export interface FakeWalletStandardHarness {
  keypair: Keypair;
  account: WalletAccount;
  wallet: Wallet;
  connector: WalletConnector;
  connect: ReturnType<typeof vi.fn>;
  signTransaction: ReturnType<typeof vi.fn>;
  signAndSendTransaction: ReturnType<typeof vi.fn>;
}

/**
 * In-memory Wallet Standard implementation for adapter-boundary tests.
 * It never discovers a browser wallet, opens an API, or submits a transaction.
 */
export function createFakeWalletStandard(
  options: FakeWalletStandardOptions = {},
): FakeWalletStandardHarness {
  const keypair = options.keypair ?? Keypair.generate();
  const chains = options.chains ?? ["solana:devnet"];
  const signTransactionVersions =
    options.signTransactionVersions === undefined
      ? ([0] as const)
      : options.signTransactionVersions;
  const signAndSendTransactionVersions =
    options.signAndSendTransactionVersions ?? null;
  const defaultAccountFeatures = [
    ...(signTransactionVersions === null ? [] : [SolanaSignTransaction]),
    ...(signAndSendTransactionVersions === null
      ? []
      : [SolanaSignAndSendTransaction]),
  ];
  const account: WalletAccount = {
    address: keypair.publicKey.toBase58(),
    publicKey: keypair.publicKey.toBytes(),
    chains: options.accountChains ?? chains,
    features: options.accountFeatures ?? defaultAccountFeatures,
  };
  const accounts = options.accounts ?? [account];
  const connect = vi.fn(async () => ({ accounts }));
  const signTransaction = vi.fn(
    async (...inputs: readonly SolanaSignTransactionInput[]) =>
      options.signTransactionOutputs
        ? options.signTransactionOutputs(inputs)
        : signTransactionInputs(inputs, keypair),
  );
  const signAndSendTransaction = vi.fn(
    async (...inputs: readonly SolanaSignAndSendTransactionInput[]) =>
      options.signAndSendTransactionOutputs
        ? options.signAndSendTransactionOutputs(inputs)
        : inputs.map(() => ({ signature: new Uint8Array(64).fill(1) })),
  );
  const features: Wallet["features"] = {
    [StandardConnect]: {
      version: "1.0.0",
      connect,
    },
  };
  if (signTransactionVersions !== null) {
    features[SolanaSignTransaction] = {
      version: "1.0.0",
      supportedTransactionVersions: signTransactionVersions,
      signTransaction,
    };
  }
  if (signAndSendTransactionVersions !== null) {
    features[SolanaSignAndSendTransaction] = {
      version: "1.0.0",
      supportedTransactionVersions: signAndSendTransactionVersions,
      signAndSendTransaction,
    };
  }
  const wallet = {
    version: "1.0.0",
    name: options.name ?? "Fake Wallet",
    icon: "data:image/svg+xml;base64,PHN2Zy8+",
    chains,
    features,
    accounts,
  } satisfies Wallet;
  const supportsV0Signing =
    chains.includes("solana:devnet") &&
    signTransactionVersions?.includes(0) === true;

  return {
    keypair,
    account,
    wallet,
    connector: {
      id: `fake:${wallet.name}`,
      name: wallet.name,
      icon: wallet.icon,
      kind: "wallet-standard",
      supportsV0Signing,
      wallet,
    },
    connect,
    signTransaction,
    signAndSendTransaction,
  };
}

export function signTransactionInputs(
  inputs: readonly SolanaSignTransactionInput[],
  signer: Keypair,
): SolanaSignTransactionOutput[] {
  return inputs.map(({ transaction }) => {
    const signed = deserializeWalletTransaction(transaction);
    if (signed instanceof VersionedTransaction) {
      signed.sign([signer]);
    } else {
      signed.partialSign(signer);
    }
    return { signedTransaction: signed.serialize() };
  });
}

function deserializeWalletTransaction(
  bytes: Uint8Array,
): Transaction | VersionedTransaction {
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}
