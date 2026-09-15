import { Context, Effect, Layer, SubscriptionRef } from "effect";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  IdentityRejected,
  IdentityUnavailable,
  SessionRejected,
  SessionUnavailable,
  type IdentityError,
  type SessionError,
} from "../errors";
import {
  Identity,
  Session,
  type IdentityService,
  type SessionService,
} from "../services";
import {
  PlayerAddress,
  type IdentityState,
  type SessionState,
  type WalletChoice,
} from "../views";
import { ZKUBE_PROGRAM_ID } from "./constants";
import { derivePlayerLabelPda, derivePlayerStatePda } from "./pdas";
import {
  submitVersionedTransactionPlan,
  withPinnedWalletComputeBudget,
  zkubeProgram,
} from "./runs/runPlan";
import { createReadOnlyWallet } from "./identity/readOnlyWallet";
import {
  buildCreatePlayerLabelPlan,
  buildSetPlayerLabelPlan,
  fetchPlayerLabel,
  invalidatePlayerLabel,
} from "./identity/playerLabelClient";
import {
  clearLastWallet,
  loadLastWallet,
  saveLastWallet,
} from "./identity/lastWalletStore";
import {
  DEVICE_FEE_ALLOWANCE_LAMPORTS,
  validatedDeviceSignerBalance,
  validateDeviceSignerFunding,
} from "./session/deviceSessionFunding";
import {
  buildDeviceSessionRefillInstructions,
  buildDeviceSignerReclaimInstruction,
  DEVICE_SESSION_READY_SKEW_SECONDS,
  withSigningDeadline,
} from "./session/deviceSessionLifecycle";
import {
  assertDeviceSessionStorageAvailable,
  clearDeviceSession,
  loadDeviceSession,
  saveDeviceSession,
  type DeviceSession,
} from "./session/deviceSessionStore";
import { buildRevokeExpiredSessionInstruction } from "./session/sessionCleanup";
import {
  buildCreateSessionV2Instruction,
  decodeSessionTokenV2Account,
  deriveSessionTokenV2Pda,
} from "./session/sessionV2";
import { SessionWallet } from "./session/sessionWallet";
import {
  activeSolanaWalletDriver,
  browserSolanaWalletDriver,
  SolanaWalletDriver,
  type SolanaWalletBinding,
  type SolanaWalletDriverService,
} from "./wallet/SolanaWalletDriver";
import { androidMwaIdentityConnectors } from "./wallet/androidMwaWallet";
import { iosDeepLinkIdentityConnectors } from "./wallet/iosDeepLinkWallet";
import type { SolanaIdentityConnector } from "./wallet/nativeWallet";
import {
  connectWalletStandard,
  disconnectWalletStandard,
  discoverWalletConnectors,
  subscribeWalletAccounts,
  type WalletConnector,
} from "./wallet/walletStandard";

export const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60 - 5 * 60;
const SESSION_EXPIRING_SECONDS = 24 * 60 * 60;

export interface SolanaIdentitySessionOptions {
  readonly connection: Connection;
  readonly nowUnix?: () => number;
  readonly discoverWallets?: () => WalletConnector[];
}

export interface SolanaIdentitySessionStateService {
  readonly binding: () => SolanaWalletBinding | null;
  readonly deviceSession: () => DeviceSession | null;
}

/** Private state shared only by Solana service layers. */
export class SolanaIdentitySessionState extends Context.Tag(
  "zkube/backend/solana/SolanaIdentitySessionState",
)<SolanaIdentitySessionState, SolanaIdentitySessionStateService>() {}

interface InspectedSession {
  readonly session: DeviceSession;
  readonly balanceLamports: number;
  readonly funding: "ready" | "needsRenewal";
  readonly needsAuthorization: boolean;
}

/**
 * First Solana backend slice. It is deliberately not wired into the UI until
 * all six services exist, so the legacy providers remain the running client.
 */
export function makeSolanaIdentitySessionLive(
  options: SolanaIdentitySessionOptions,
): Layer.Layer<
  Identity | Session | SolanaWalletDriver | SolanaIdentitySessionState
> {
  return Layer.scopedContext(
    Effect.gen(function* () {
      const identityRef = yield* SubscriptionRef.make<IdentityState>({
        status: "disconnected",
      });
      const sessionRef =
        yield* SubscriptionRef.make<SessionState>(emptySession());
      const nowUnix = options.nowUnix ?? (() => Math.floor(Date.now() / 1_000));
      const discover = options.discoverWallets ?? discoverWalletConnectors;
      let binding: SolanaWalletBinding | null = null;
      let unsubscribeAccounts: (() => void) | null = null;
      const driver = activeSolanaWalletDriver(() => binding);
      const connectors = () => {
        const native = [
          ...androidMwaIdentityConnectors(),
          ...iosDeepLinkIdentityConnectors(),
        ];
        return native.length > 0
          ? native
          : discover().map(browserIdentityConnector);
      };

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unsubscribeAccounts?.();
          unsubscribeAccounts = null;
          binding = null;
        }),
      );

      const publishDisconnected = () => {
        unsubscribeAccounts?.();
        unsubscribeAccounts = null;
        binding = null;
        Effect.runSync(
          SubscriptionRef.set(identityRef, { status: "disconnected" }),
        );
        Effect.runSync(SubscriptionRef.set(sessionRef, emptySession()));
      };

      const finishConnection = async (
        connected: SolanaWalletBinding,
      ): Promise<void> => {
        const address = connected.wallet.publicKey.toBase58();
        binding = connected;
        unsubscribeAccounts?.();
        unsubscribeAccounts =
          connected.subscribeDisconnected(publishDisconnected);
        saveLastWallet({ connectorId: connected.choice.id, address });
        const label = await fetchPlayerLabel({
          connection: options.connection,
          wallet: createReadOnlyWallet(connected.wallet.publicKey),
          owner: connected.wallet.publicKey,
        }).catch(() => null);
        Effect.runSync(
          SubscriptionRef.set(
            identityRef,
            projectSolanaIdentityState({
              address,
              label: label?.displayName,
              wallet: connected.choice,
            }),
          ),
        );
        await refreshSession({
          connection: options.connection,
          owner: connected.wallet.publicKey,
          nowUnix: nowUnix(),
          sessionRef,
        });
      };

      const identity: IdentityService = {
        wallets: () =>
          Effect.try({
            try: () => connectors().map((connector) => connector.choice),
            catch: identityUnavailable,
          }),
        connect: (walletId) =>
          Effect.tryPromise({
            try: async () => {
              if (binding) {
                throw new Error(
                  "Disconnect the current wallet before choosing another",
                );
              }
              const connector = connectors().find(
                (item) => item.choice.id === walletId,
              );
              if (!connector)
                throw new Error(`Wallet ${walletId} is unavailable`);
              Effect.runSync(
                SubscriptionRef.set(identityRef, {
                  status: "connecting",
                  wallet: connector.choice,
                }),
              );
              try {
                const connected = await connector.connect();
                if (!connected) throw new Error("Wallet did not connect");
                await finishConnection(connected);
              } catch (cause) {
                publishDisconnected();
                throw cause;
              }
            },
            catch: identityRejected,
          }),
        reconnect: () =>
          Effect.tryPromise({
            try: async () => {
              if (binding) return;
              const remembered = loadLastWallet();
              if (!remembered) return;
              const connector = connectors().find(
                (item) => item.choice.id === remembered.connectorId,
              );
              if (!connector) return;
              const connected = await connector.connect({
                silent: true,
              });
              if (!connected) return;
              if (
                connected.wallet.publicKey.toBase58() !== remembered.address
              ) {
                clearLastWallet();
                await connected.disconnect().catch(() => undefined);
                throw new Error("The remembered wallet account changed");
              }
              await finishConnection(connected);
            },
            catch: identityUnavailable,
          }),
        disconnect: () =>
          Effect.tryPromise({
            try: async () => {
              const current = binding;
              if (current) clearDeviceSession(current.wallet.publicKey);
              clearLastWallet();
              publishDisconnected();
              if (current) await current.disconnect();
            },
            catch: identityUnavailable,
          }),
        setLabel: (displayName) =>
          Effect.tryPromise({
            try: async () => {
              const current = requireBinding(binding);
              const stored = requireStoredSession(
                current.wallet.publicKey,
                nowUnix(),
              );
              const wallet = new SessionWallet(stored.signer);
              const exists = await options.connection.getAccountInfo(
                derivePlayerLabelPda(current.wallet.publicKey),
                "confirmed",
              );
              const planArgs = {
                connection: options.connection,
                wallet,
                ownerAuthority: current.wallet.publicKey,
                sessionToken: stored.sessionToken,
                displayName,
              };
              const transactionPlan = exists
                ? await buildSetPlayerLabelPlan(planArgs)
                : await buildCreatePlayerLabelPlan(planArgs);
              await submitVersionedTransactionPlan({ transactionPlan, wallet });
              invalidatePlayerLabel(current.wallet.publicKey);
              Effect.runSync(
                SubscriptionRef.update(identityRef, (state) => ({
                  ...state,
                  label: displayName,
                })),
              );
            },
            catch: identityRejected,
          }),
        state: identityRef.changes,
      };

      const session: SessionService = {
        ensure: () =>
          Effect.tryPromise({
            try: async () => {
              const current = requireBinding(binding);
              assertDeviceSessionStorageAvailable();
              const owner = current.wallet.publicKey;
              const inspected = await inspectSession(
                options.connection,
                owner,
                nowUnix(),
              );
              if (inspected && !inspected.needsAuthorization) {
                if (inspected.funding === "needsRenewal") {
                  const refill = buildDeviceSessionRefillInstructions({
                    owner,
                    signer: inspected.session.signer.publicKey,
                    balanceLamports: inspected.balanceLamports,
                  });
                  await submitOwnerTransaction({
                    connection: options.connection,
                    driver,
                    owner,
                    label: "Refill zKube device session",
                    instructions: refill.instructions,
                    signers: [inspected.session.signer],
                  });
                }
                const state = sessionState(
                  inspected.session.validUntil,
                  inspected.funding === "ready"
                    ? inspected.balanceLamports
                    : DEVICE_FEE_ALLOWANCE_LAMPORTS,
                  nowUnix(),
                );
                Effect.runSync(SubscriptionRef.set(sessionRef, state));
                return state;
              }

              const created = await createSession({
                connection: options.connection,
                driver,
                owner,
                previous: inspected,
                nowUnix: nowUnix(),
              });
              saveDeviceSession(created);
              const state = sessionState(
                created.validUntil,
                DEVICE_FEE_ALLOWANCE_LAMPORTS,
                nowUnix(),
              );
              Effect.runSync(SubscriptionRef.set(sessionRef, state));
              return state;
            },
            catch: sessionRejected,
          }),
        fund: (lamports) =>
          Effect.tryPromise({
            try: async () => {
              if (
                lamports <= 0n ||
                lamports > BigInt(Number.MAX_SAFE_INTEGER)
              ) {
                throw new Error(
                  "Session funding must be a positive safe lamport amount",
                );
              }
              const current = requireBinding(binding);
              const stored = requireStoredSession(
                current.wallet.publicKey,
                nowUnix(),
              );
              const balance = await options.connection.getBalance(
                stored.signer.publicKey,
                "confirmed",
              );
              await submitOwnerTransaction({
                connection: options.connection,
                driver,
                owner: current.wallet.publicKey,
                label: "Fund zKube device session",
                instructions: [
                  SystemProgram.transfer({
                    fromPubkey: current.wallet.publicKey,
                    toPubkey: stored.signer.publicKey,
                    lamports: Number(lamports),
                  }),
                  SystemProgram.transfer({
                    fromPubkey: stored.signer.publicKey,
                    toPubkey: current.wallet.publicKey,
                    lamports: 0,
                  }),
                ],
                signers: [stored.signer],
              });
              const state = sessionState(
                stored.validUntil,
                balance + Number(lamports),
                nowUnix(),
              );
              Effect.runSync(SubscriptionRef.set(sessionRef, state));
              return state;
            },
            catch: sessionRejected,
          }),
        revoke: () =>
          Effect.tryPromise({
            try: async () => {
              const current = requireBinding(binding);
              const stored = loadDeviceSession(current.wallet.publicKey);
              if (stored) {
                const balance = await options.connection.getBalance(
                  stored.signer.publicKey,
                  "confirmed",
                );
                const reclaim = buildDeviceSignerReclaimInstruction({
                  owner: current.wallet.publicKey,
                  signer: stored.signer.publicKey,
                  balanceLamports: balance,
                });
                if (reclaim) {
                  await submitOwnerTransaction({
                    connection: options.connection,
                    driver,
                    owner: current.wallet.publicKey,
                    label: "Revoke zKube device session",
                    instructions: [reclaim],
                    signers: [stored.signer],
                  });
                }
                clearDeviceSession(current.wallet.publicKey);
              }
              Effect.runSync(SubscriptionRef.set(sessionRef, emptySession()));
            },
            catch: sessionRejected,
          }),
        state: sessionRef.changes,
      };

      return Context.mergeAll(
        Context.make(Identity, identity),
        Context.make(Session, session),
        Context.make(SolanaWalletDriver, driver),
        Context.make(SolanaIdentitySessionState, {
          binding: () => binding,
          deviceSession: () =>
            binding ? loadDeviceSession(binding.wallet.publicKey) : null,
        }),
      );
    }),
  );
}

async function refreshSession(args: {
  connection: Connection;
  owner: PublicKey;
  nowUnix: number;
  sessionRef: SubscriptionRef.SubscriptionRef<SessionState>;
}): Promise<void> {
  const inspected = await inspectSession(
    args.connection,
    args.owner,
    args.nowUnix,
  ).catch(() => null);
  const state = inspected
    ? sessionState(
        inspected.session.validUntil,
        inspected.balanceLamports,
        args.nowUnix,
      )
    : emptySession();
  Effect.runSync(SubscriptionRef.set(args.sessionRef, state));
}

export async function inspectSession(
  connection: Connection,
  owner: PublicKey,
  nowUnix: number,
): Promise<InspectedSession | null> {
  const stored = loadDeviceSession(owner);
  if (!stored) return null;
  const [[tokenInfo, signerInfo], rentFloor] = await Promise.all([
    connection.getMultipleAccountsInfo(
      [stored.sessionToken, stored.signer.publicKey],
      "confirmed",
    ),
    connection.getMinimumBalanceForRentExemption(0, "confirmed"),
  ]);
  if (!tokenInfo) {
    clearDeviceSession(owner);
    return null;
  }
  const token = decodeSessionTokenV2Account(stored.sessionToken, tokenInfo);
  if (
    !token.authority.equals(owner) ||
    !token.sessionSigner.equals(stored.signer.publicKey) ||
    !token.targetProgram.equals(ZKUBE_PROGRAM_ID) ||
    !token.feePayer.equals(owner) ||
    token.validUntil !== stored.validUntil
  ) {
    clearDeviceSession(owner);
    throw new Error("Stored device session relationships are invalid");
  }
  return {
    session: stored,
    balanceLamports: signerInfo ? validatedDeviceSignerBalance(signerInfo) : 0,
    funding: validateDeviceSignerFunding({
      info: signerInfo,
      rentFloorLamports: rentFloor,
    }),
    needsAuthorization: token.validUntil - nowUnix <= DEVICE_SESSION_READY_SKEW_SECONDS,
  };
}

async function createSession(args: {
  connection: Connection;
  driver: SolanaWalletDriverService;
  owner: PublicKey;
  previous: InspectedSession | null;
  nowUnix: number;
}): Promise<DeviceSession> {
  const signer = Keypair.generate();
  const validUntil = args.nowUnix + SESSION_LIFETIME_SECONDS;
  const { sessionToken } = deriveSessionTokenV2Pda({
    authority: args.owner,
    sessionSigner: signer.publicKey,
  });
  const renewal = await buildDeviceSessionRenewalInstructions({
    connection: args.connection, owner: args.owner, signer: signer.publicKey,
    validUntil, nowUnix: args.nowUnix, previous: args.previous ? {
      sessionToken: args.previous.session.sessionToken, signer: args.previous.session.signer.publicKey,
      validUntil: args.previous.session.validUntil, balanceLamports: args.previous.balanceLamports,
    } : null,
  });
  const signers = [signer];
  if (renewal.previousSignerRequired && args.previous) signers.push(args.previous.session.signer);
  await submitOwnerTransaction({
    connection: args.connection,
    driver: args.driver,
    owner: args.owner,
    label: args.previous
      ? "Rotate zKube device session"
      : "Enable zKube device session",
    instructions: renewal.instructions,
    signers,
  });
  return {
    owner: args.owner,
    signer,
    sessionToken,
    validUntil,
    createdAt: args.nowUnix,
  };
}

/** Same composition used by live renewal and the offline migration oracle. */
export async function buildDeviceSessionRenewalInstructions(args: {
  connection: Connection; owner: PublicKey; signer: PublicKey; validUntil: number; nowUnix: number;
  previous: { sessionToken: PublicKey; signer: PublicKey; validUntil: number; balanceLamports: number } | null;
}): Promise<{ instructions: TransactionInstruction[]; previousSignerRequired: boolean }> {
  const instructions: TransactionInstruction[] = [];
  let previousSignerRequired = false;
  if (args.previous) {
    // The signing safety window is not on-chain expiry. Cleanup remains illegal
    // in the final 60 seconds even though a new authorization is already needed.
    if (args.previous.validUntil <= args.nowUnix) {
      const tokenInfo = await args.connection.getAccountInfo(
        args.previous.sessionToken,
        "confirmed",
      );
      if (tokenInfo) {
        instructions.push(
          buildRevokeExpiredSessionInstruction(
            {
              address: args.previous.sessionToken,
              ...decodeSessionTokenV2Account(
                args.previous.sessionToken,
                tokenInfo,
              ),
            },
            args.nowUnix,
          ),
        );
      }
    }
    const reclaim = buildDeviceSignerReclaimInstruction({
      owner: args.owner,
      signer: args.previous.signer,
      balanceLamports: args.previous.balanceLamports,
    });
    if (reclaim) {
      instructions.push(reclaim);
      previousSignerRequired = true;
    }
  }
  instructions.push(...await buildDeviceSessionEnableInstructions({
    connection: args.connection, owner: args.owner, signer: args.signer, validUntil: args.validUntil,
  }));
  return { instructions, previousSignerRequired };
}

/** Pure instruction composition shared by live onboarding and migration parity. */
export async function buildDeviceSessionEnableInstructions(args: {
  connection: Connection;
  owner: PublicKey;
  signer: PublicKey;
  validUntil: number;
}): Promise<TransactionInstruction[]> {
  const program = zkubeProgram(args.connection, createReadOnlyWallet(args.owner));
  return [
    await program.methods
      .initializePlayer()
      .accountsPartial({
        playerState: derivePlayerStatePda(args.owner),
        payer: args.owner,
        ownerAuthority: args.owner,
        sessionToken: null,
        actor: args.owner,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
    buildCreateSessionV2Instruction({
      authority: args.owner,
      sessionSigner: args.signer,
      feePayer: args.owner,
      targetProgram: ZKUBE_PROGRAM_ID,
      topUp: true,
      validUntil: args.validUntil,
      lamports: DEVICE_FEE_ALLOWANCE_LAMPORTS,
    }),
  ];
}

async function submitOwnerTransaction(args: {
  connection: Connection;
  driver: SolanaWalletDriverService;
  owner: PublicKey;
  label: string;
  instructions: TransactionInstruction[];
  signers: Keypair[];
}): Promise<string> {
  const { blockhash, lastValidBlockHeight } =
    await args.connection.getLatestBlockhash("confirmed");
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: args.owner,
      recentBlockhash: blockhash,
      instructions: withPinnedWalletComputeBudget(args.instructions),
    }).compileToV0Message(),
  );
  transaction.sign(args.signers);
  const simulation = await args.connection.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: false,
  });
  if (simulation.value.err) {
    throw new Error(`${args.label} simulation failed`);
  }
  const signed = await withSigningDeadline(
    Effect.runPromise(args.driver.signTransaction(transaction)),
    args.label,
  );
  const signature = await args.connection.sendRawTransaction(
    signed.serialize(),
    {
      maxRetries: 5,
      skipPreflight: false,
    },
  );
  const confirmation = await args.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (confirmation.value.err)
    throw new Error(`${args.label} was not confirmed`);
  return signature;
}

function browserIdentityConnector(
  connector: WalletConnector,
): SolanaIdentityConnector {
  return {
    choice: walletChoice(connector),
    connect: async (options) => {
      const connected = await connectWalletStandard(connector, options);
      let account = connected.account;
      const driver = browserSolanaWalletDriver(() => ({
        connector,
        account,
        wallet: connected.wallet,
        standardWallet: connector.wallet,
      }));
      return {
        choice: walletChoice(connector),
        wallet: connected.wallet,
        driver,
        disconnect: () =>
          disconnectWalletStandard(connector.wallet, {
            clearMobileAuthorizationCache:
              connector.kind === "mobile-wallet-adapter",
          }),
        subscribeDisconnected: (listener) =>
          subscribeWalletAccounts(connector.wallet, (accounts) => {
            const next = accounts.find(
              (candidate) =>
                candidate.address === connected.wallet.publicKey.toBase58(),
            );
            if (!next) {
              listener();
              return;
            }
            account = next;
          }),
      };
    },
  };
}

function walletChoice(connector: WalletConnector): WalletChoice {
  return {
    id: connector.id,
    name: connector.name,
    platform:
      connector.kind === "mobile-wallet-adapter" ? "android" : "browser",
  };
}

function requireBinding(
  binding: SolanaWalletBinding | null,
): SolanaWalletBinding {
  if (!binding) throw new Error("Connect a Solana wallet first");
  return binding;
}

function requireStoredSession(
  owner: PublicKey,
  nowUnix: number,
): DeviceSession {
  const stored = loadDeviceSession(owner);
  if (
    !stored ||
    stored.validUntil - nowUnix <= DEVICE_SESSION_READY_SKEW_SECONDS
  ) {
    throw new Error("Enable or renew this device session first");
  }
  return stored;
}

export function projectSolanaSessionState(args: {
  validUntil: number;
  floatLamports: number;
  nowUnix: number;
}): SessionState {
  return sessionState(args.validUntil, args.floatLamports, args.nowUnix);
}

export function projectSolanaIdentityState(args: {
  address: string;
  label?: string;
  wallet: WalletChoice;
}): IdentityState {
  return {
    status: "connected",
    address: PlayerAddress.make(args.address),
    ...(args.label === undefined ? {} : { label: args.label }),
    wallet: args.wallet,
  };
}

function sessionState(
  validUntil: number,
  floatLamports: number,
  nowUnix: number,
): SessionState {
  const remaining = validUntil - nowUnix;
  return {
    status:
      remaining <= DEVICE_SESSION_READY_SKEW_SECONDS
        ? "expired"
        : remaining <= SESSION_EXPIRING_SECONDS
          ? "expiring"
          : "live",
    expiresAt: validUntil,
    floatLamports: BigInt(floatLamports),
  };
}

function emptySession(): SessionState {
  return { status: "none", expiresAt: 0, floatLamports: 0n };
}

function identityRejected(cause: unknown): IdentityError {
  return cause instanceof IdentityUnavailable ||
    cause instanceof IdentityRejected
    ? cause
    : new IdentityRejected({ message: message(cause) });
}

function identityUnavailable(cause: unknown): IdentityError {
  return cause instanceof IdentityUnavailable ||
    cause instanceof IdentityRejected
    ? cause
    : new IdentityUnavailable({ message: message(cause) });
}

function sessionRejected(cause: unknown): SessionError {
  return cause instanceof SessionUnavailable || cause instanceof SessionRejected
    ? cause
    : new SessionRejected({ message: message(cause) });
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
