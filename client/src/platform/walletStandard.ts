import {
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  registerMwa,
  SolanaMobileWalletAdapterWalletName,
} from "@solana-mobile/wallet-standard-mobile";
import {
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import type { WalletLike } from "@/chain/sessionWallet";

export const DEVNET_CHAIN = "solana:devnet" as const;

export interface WalletConnector {
  id: string;
  name: string;
  icon: Wallet["icon"];
  kind: "mobile-wallet-adapter" | "wallet-standard";
  supportsV0Signing: boolean;
  wallet: Wallet;
}

let mobileRegistered = false;

/** Register MWA before asking Wallet Standard for its first discovery snapshot. */
export function registerMobileWalletStandard(): void {
  if (mobileRegistered || !isAndroidBrowser()) return;
  mobileRegistered = true;
  registerMwa({
    appIdentity: {
      name: "zKube",
      uri: window.location.origin,
      icon: "assets/pwa-512x512.png",
    },
    authorizationCache: createDefaultAuthorizationCache(),
    chains: [DEVNET_CHAIN],
    chainSelector: createDefaultChainSelector(),
    onWalletNotFound: async () => {
      throw new Error(
        "No compatible Android wallet was found. Seeker releases require Seed Vault Wallet.",
      );
    },
  });
}

export function walletRegistry() {
  registerMobileWalletStandard();
  return getWallets();
}

export function discoverWalletConnectors(): WalletConnector[] {
  return walletRegistry()
    .get()
    .filter(hasConnectFeature)
    .map<WalletConnector>((wallet) => ({
      id: connectorId(wallet),
      name:
        wallet.name === SolanaMobileWalletAdapterWalletName
          ? "Use Installed Wallet"
          : wallet.name,
      icon: wallet.icon,
      kind:
        wallet.name === SolanaMobileWalletAdapterWalletName
          ? "mobile-wallet-adapter"
          : "wallet-standard",
      supportsV0Signing: supportsV0Signing(wallet),
      wallet,
    }))
    .sort((left, right) => {
      if (left.kind !== right.kind)
        return left.kind === "mobile-wallet-adapter" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

export async function connectWalletStandard(
  connector: WalletConnector,
  options?: { silent?: boolean },
): Promise<{ account: WalletAccount; wallet: WalletLike }> {
  if (!connector.supportsV0Signing) {
    throw new Error(
      `${connector.name} cannot sign versioned transactions without submitting them.`,
    );
  }
  const feature = connector.wallet.features[
    StandardConnect
  ] as StandardConnectFeature[typeof StandardConnect];
  const output = await feature.connect(
    options?.silent ? { silent: true } : undefined,
  );
  const account = output.accounts[0];
  if (!account) throw new Error(`${connector.name} did not expose an account`);
  assertSolanaAccount(account);
  return {
    account,
    wallet: new WalletStandardWallet(connector.wallet, account),
  };
}

export async function disconnectWalletStandard(wallet: Wallet): Promise<void> {
  const feature = wallet.features[
    StandardDisconnect
  ] as StandardDisconnectFeature[typeof StandardDisconnect] | undefined;
  await feature?.disconnect();
}

export function subscribeWalletAccounts(
  wallet: Wallet,
  listener: (accounts: readonly WalletAccount[]) => void,
): () => void {
  const events = wallet.features[
    StandardEvents
  ] as StandardEventsFeature[typeof StandardEvents] | undefined;
  return events?.on("change", ({ accounts }) => {
    if (accounts) listener(accounts);
  }) ?? (() => undefined);
}

export class WalletStandardWallet implements WalletLike {
  readonly publicKey: PublicKey;

  constructor(
    readonly standardWallet: Wallet,
    readonly account: WalletAccount,
  ) {
    assertSolanaAccount(account);
    this.publicKey = new PublicKey(account.publicKey);
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    const [signed] = await this.signTransactions([transaction]);
    if (!signed) throw new Error("Wallet returned no signed transaction");
    return signed as T;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    return (await this.signTransactions(transactions)) as T[];
  }

  private async signTransactions(
    transactions: Array<Transaction | VersionedTransaction>,
  ): Promise<Array<Transaction | VersionedTransaction>> {
    const feature = this.standardWallet.features[
      SolanaSignTransaction
    ] as SolanaSignTransactionFeature[typeof SolanaSignTransaction] | undefined;
    if (!feature || !feature.supportedTransactionVersions.includes(0)) {
      throw new Error(
        `${this.standardWallet.name} does not support unsigned v0 transaction signing.`,
      );
    }
    const outputs = await feature.signTransaction(
      ...transactions.map((transaction) => ({
        account: this.account,
        transaction: serializeForWallet(transaction),
        chain: DEVNET_CHAIN,
        options: { preflightCommitment: "confirmed" as const },
      })),
    );
    if (outputs.length !== transactions.length) {
      throw new Error("Wallet returned an unexpected transaction count");
    }
    return outputs.map((output, index) =>
      verifyWalletSignedOutput(
        transactions[index]!,
        output.signedTransaction,
        this.publicKey,
      ),
    );
  }
}

function connectorId(wallet: Wallet): string {
  return `${wallet.name}:${wallet.icon.slice(0, 48)}`;
}

function hasConnectFeature(wallet: Wallet): boolean {
  return StandardConnect in wallet.features;
}

function supportsV0Signing(wallet: Wallet): boolean {
  const feature = wallet.features[
    SolanaSignTransaction
  ] as SolanaSignTransactionFeature[typeof SolanaSignTransaction] | undefined;
  return Boolean(
    feature &&
      wallet.chains.includes(DEVNET_CHAIN) &&
      feature.supportedTransactionVersions.includes(0),
  );
}

function assertSolanaAccount(account: WalletAccount): void {
  const publicKey = new PublicKey(account.publicKey);
  if (publicKey.toBase58() !== account.address) {
    throw new Error("Wallet account address does not match its public key");
  }
  if (!account.chains.includes(DEVNET_CHAIN)) {
    throw new Error("Wallet account is not authorized for Solana Devnet");
  }
  if (!account.features.includes(SolanaSignTransaction)) {
    throw new Error("Wallet account does not allow transaction signing");
  }
}

function serializeForWallet(
  transaction: Transaction | VersionedTransaction,
): Uint8Array {
  return transaction instanceof VersionedTransaction
    ? transaction.serialize()
    : transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
}

export function verifyWalletSignedOutput(
  original: Transaction | VersionedTransaction,
  signedBytes: Uint8Array,
  walletPublicKey: PublicKey,
): Transaction | VersionedTransaction {
  if (original instanceof VersionedTransaction) {
    const signed = VersionedTransaction.deserialize(signedBytes);
    assertBytesEqual(
      original.message.serialize(),
      signed.message.serialize(),
      "Wallet changed the transaction message",
    );
    const signerKeys = original.message.staticAccountKeys.slice(
      0,
      original.message.header.numRequiredSignatures,
    );
    verifySignatureSet(
      signerKeys,
      original.signatures,
      signed.signatures,
      walletPublicKey,
    );
    return signed;
  }

  const signed = Transaction.from(signedBytes);
  assertBytesEqual(
    original.serializeMessage(),
    signed.serializeMessage(),
    "Wallet changed the transaction message",
  );
  const signerKeys = original.signatures.map(({ publicKey }) => publicKey);
  verifySignatureSet(
    signerKeys,
    original.signatures.map(({ signature }) => signature ?? new Uint8Array(64)),
    signed.signatures.map(({ signature }) => signature ?? new Uint8Array(64)),
    walletPublicKey,
  );
  return signed;
}

function verifySignatureSet(
  signerKeys: readonly PublicKey[],
  before: readonly Uint8Array[],
  after: readonly Uint8Array[],
  walletPublicKey: PublicKey,
): void {
  const walletIndex = signerKeys.findIndex((key) => key.equals(walletPublicKey));
  if (walletIndex < 0 || isZeroSignature(after[walletIndex])) {
    throw new Error("Wallet did not sign with the connected account");
  }
  signerKeys.forEach((key, index) => {
    if (key.equals(walletPublicKey) || isZeroSignature(before[index])) return;
    assertBytesEqual(
      before[index]!,
      after[index]!,
      "Wallet discarded an existing partial signature",
    );
  });
}

function assertBytesEqual(
  left: Uint8Array,
  right: Uint8Array,
  message: string,
): void {
  if (
    left.length !== right.length ||
    !left.every((byte, index) => byte === right[index])
  ) {
    throw new Error(message);
  }
}

function isZeroSignature(signature: Uint8Array | undefined): boolean {
  return !signature || signature.every((byte) => byte === 0);
}

function isAndroidBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    /Android/i.test(navigator.userAgent)
  );
}
