import {
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  registerMwa,
  SolanaMobileWalletAdapterWalletName,
  type AuthorizationCache,
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
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

import type { WalletLike } from "@/chain/sessionWallet";
import {
  currentPlatformCapabilities,
  type PlatformCapabilities,
} from "./capabilities";

const DEVNET_CHAIN = "solana:devnet" as const;
const WALLET_NOT_FOUND_MESSAGE =
  "No compatible Android wallet was found. Seeker includes Seed Vault Wallet, and other installed compatible wallets may be used.";

export class WalletAvailabilityError extends Error {
  override readonly name = "WalletAvailabilityError";
  readonly code = "wallet-not-found";
  readonly recoverable = true;
  readonly recoveryAction = "install-compatible-android-wallet";

  constructor(readonly capabilities: PlatformCapabilities) {
    super(WALLET_NOT_FOUND_MESSAGE);
  }
}

export type WalletAvailabilityState =
  | Readonly<{ status: "unknown"; error: null }>
  | Readonly<{ status: "unavailable"; error: WalletAvailabilityError }>;

export type WalletAvailabilityListener = (
  state: WalletAvailabilityState,
) => void;

export interface WalletConnector {
  id: string;
  name: string;
  icon: Wallet["icon"];
  kind: "mobile-wallet-adapter" | "wallet-standard";
  supportsV0Signing: boolean;
  wallet: Wallet;
}

export type MobileWalletRegistrationState =
  | Readonly<{ status: "not-attempted" }>
  | Readonly<{ status: "attempted" }>;

let mobileRegistrationState: MobileWalletRegistrationState = {
  status: "not-attempted",
};
let mobileAuthorizationCache: AuthorizationCache | null = null;
let walletAvailabilityState: WalletAvailabilityState = {
  status: "unknown",
  error: null,
};
const walletAvailabilityListeners = new Set<WalletAvailabilityListener>();

export function getWalletAvailabilityState(): WalletAvailabilityState {
  return walletAvailabilityState;
}

export function subscribeWalletAvailability(
  listener: WalletAvailabilityListener,
): () => void {
  walletAvailabilityListeners.add(listener);
  return () => walletAvailabilityListeners.delete(listener);
}

export function getMobileWalletRegistrationState(): MobileWalletRegistrationState {
  return mobileRegistrationState;
}

/** Register MWA before asking Wallet Standard for its first discovery snapshot. */
function registerMobileWalletStandard(): void {
  const capabilities = currentPlatformCapabilities();
  if (
    mobileRegistrationState.status === "attempted" ||
    !capabilities.mobileWalletAdapterSupported
  )
    return;
  const authorizationCache = createDefaultAuthorizationCache();
  registerMwa({
    appIdentity: {
      name: "zKube",
      uri: window.location.origin,
      // MWA requires identity.icon to be a URI *relative* to identity.uri, and
      // the wallet resolves it against that origin itself. Passing an absolute
      // URL makes the wallet reject `authorize` with JSON-RPC -32602 ("When
      // specified, identity.icon must be a relative URI") before it can present
      // an approval prompt, which reads on the device as a wallet that opened
      // with nothing to sign. Keep this relative and without a leading slash.
      icon: "assets/pwa-512x512.png",
    },
    authorizationCache,
    chains: [DEVNET_CHAIN],
    chainSelector: createDefaultChainSelector(),
    onWalletNotFound: async () => {
      const error = new WalletAvailabilityError(currentPlatformCapabilities());
      publishWalletAvailability({ status: "unavailable", error });
      throw error;
    },
  });
  // registerMwa() returns void, so this records only that the pinned,
  // capability-gated call completed. It deliberately does not claim that the
  // package reported successful registration. A synchronous failure leaves
  // the state retryable.
  mobileAuthorizationCache = authorizationCache;
  mobileRegistrationState = { status: "attempted" };
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
  if (connector.kind === "mobile-wallet-adapter") {
    publishWalletAvailability({ status: "unknown", error: null });
  }
  const output = await feature.connect(
    options?.silent ? { silent: true } : undefined,
  );
  const account = output.accounts[0];
  if (!account) throw new Error(`${connector.name} did not expose an account`);
  assertSolanaAccount(account);
  return {
    account,
    wallet: createWalletStandardWallet(connector.wallet, account),
  };
}

export function createWalletStandardWallet(
  wallet: Wallet,
  account: WalletAccount,
): WalletLike {
  return new WalletStandardWallet(wallet, account);
}

export async function disconnectWalletStandard(
  wallet: Wallet,
  options?: { clearMobileAuthorizationCache?: boolean },
): Promise<void> {
  const feature = wallet.features[StandardDisconnect] as
    | StandardDisconnectFeature[typeof StandardDisconnect]
    | undefined;
  let disconnectError: unknown;
  try {
    await feature?.disconnect();
  } catch (cause) {
    disconnectError = cause;
  }
  if (options?.clearMobileAuthorizationCache) {
    await clearMobileWalletAuthorizationCache();
  }
  if (disconnectError) throw disconnectError;
}

/**
 * Clears only the supported cache object supplied to the pinned MWA adapter.
 * The registered Wallet Standard wallet does not expose that cache, so retain
 * the public AuthorizationCache instead of reaching through adapter internals.
 */
export async function clearMobileWalletAuthorizationCache(): Promise<boolean> {
  if (!mobileAuthorizationCache) return false;
  await mobileAuthorizationCache.clear();
  return true;
}

export function subscribeWalletAccounts(
  wallet: Wallet,
  listener: (accounts: readonly WalletAccount[]) => void,
): () => void {
  const events = wallet.features[StandardEvents] as
    | StandardEventsFeature[typeof StandardEvents]
    | undefined;
  return (
    events?.on("change", ({ accounts }) => {
      if (accounts) listener(accounts);
    }) ?? (() => undefined)
  );
}

class WalletStandardWallet implements WalletLike {
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
    const feature = this.standardWallet.features[SolanaSignTransaction] as
      | SolanaSignTransactionFeature[typeof SolanaSignTransaction]
      | undefined;
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
        this.standardWallet.name,
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
  const feature = wallet.features[SolanaSignTransaction] as
    | SolanaSignTransactionFeature[typeof SolanaSignTransaction]
    | undefined;
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
  walletName = "Wallet Standard",
): Transaction | VersionedTransaction {
  if (original instanceof VersionedTransaction) {
    const signed = VersionedTransaction.deserialize(signedBytes);
    logWalletMessageShape(walletName, original, signed, walletPublicKey);
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
  logWalletMessageShape(walletName, original, signed, walletPublicKey);
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

function logWalletMessageShape(
  walletName: string,
  before: Transaction | VersionedTransaction,
  after: Transaction | VersionedTransaction,
  walletPublicKey: PublicKey,
): void {
  const beforeMessage = serializedMessage(before);
  const afterMessage = serializedMessage(after);
  const sameMessage = bytesEqual(beforeMessage, afterMessage);
  const event = {
    schemaVersion: 1,
    event: "wallet_sign_message",
    wallet: walletName,
    owner: walletPublicKey.toBase58(),
    version: before instanceof VersionedTransaction ? "v0" : "legacy",
    ok: sameMessage,
    beforeHash: messageFingerprint(beforeMessage),
    afterHash: messageFingerprint(afterMessage),
    beforeInstructions: instructionCount(before),
    afterInstructions: instructionCount(after),
    requiredSigners:
      before instanceof VersionedTransaction
        ? before.message.header.numRequiredSignatures
        : before.signatures.length,
    programIds: messageProgramIds(before),
    afterRequiredSigners:
      after instanceof VersionedTransaction
        ? after.message.header.numRequiredSignatures
        : after.signatures.length,
    afterProgramIds: messageProgramIds(after),
  };
  (sameMessage ? console.info : console.warn)(JSON.stringify(event));
}

function serializedMessage(
  transaction: Transaction | VersionedTransaction,
): Uint8Array {
  return transaction instanceof VersionedTransaction
    ? transaction.message.serialize()
    : transaction.serializeMessage();
}

function instructionCount(
  transaction: Transaction | VersionedTransaction,
): number {
  return transaction instanceof VersionedTransaction
    ? transaction.message.compiledInstructions.length
    : transaction.instructions.length;
}

function messageProgramIds(
  transaction: Transaction | VersionedTransaction,
): string[] {
  if (!(transaction instanceof VersionedTransaction)) {
    return transaction.instructions.map((instruction) =>
      instruction.programId.toBase58(),
    );
  }
  return transaction.message.compiledInstructions.map(
    (instruction) =>
      transaction.message.staticAccountKeys[
        instruction.programIdIndex
      ]?.toBase58() ?? "address-lookup",
  );
}

function messageFingerprint(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function verifySignatureSet(
  signerKeys: readonly PublicKey[],
  before: readonly Uint8Array[],
  after: readonly Uint8Array[],
  walletPublicKey: PublicKey,
): void {
  const walletIndex = signerKeys.findIndex((key) =>
    key.equals(walletPublicKey),
  );
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

function publishWalletAvailability(state: WalletAvailabilityState): void {
  walletAvailabilityState = state;
  walletAvailabilityListeners.forEach((listener) => {
    try {
      listener(state);
    } catch (cause) {
      console.error("Wallet availability listener failed", cause);
    }
  });
}
