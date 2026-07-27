import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  clearMobileWalletAuthorizationCache,
  connectWalletStandard,
  createWalletStandardWallet,
  disconnectWalletStandard,
  discoverWalletConnectors,
  subscribeWalletAccounts,
  walletRegistry,
  type WalletConnector,
} from "@/platform/walletStandard";
import { errorMessage, isWalletRejection } from "@/utils/errors";
import { ZKUBE_PROGRAM_ID } from "./constants";
import {
  assertDeviceSessionStorageAvailable,
  clearDeviceSession,
  loadDeviceSession,
  requireCurrentDeviceSession,
  saveDeviceSession,
  type DeviceSession,
} from "./deviceSessionStore";
import {
  clearLastWallet,
  loadLastWallet,
  saveLastWallet,
} from "./lastWalletStore";
import {
  ConnectedPlayerContext,
  type ConnectedPlayerValue,
  type PlayerConnectionStatus,
  type PlayerSessionStatus,
} from "./connectedPlayerContext";
import { useSolanaConnection } from "./connectionContext";
import { clearRunSession } from "./runSessionStore";
import {
  buildCreateSessionV2Instruction,
  decodeSessionTokenV2Account,
  deriveSessionTokenV2Pda,
} from "./sessionV2";
import type { WalletLike } from "./sessionWallet";
import { createReadOnlyWallet } from "./readOnlyWallet";
import {
  derivePlayerFundingPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
} from "./pdas";
import { withPinnedWalletComputeBudget, zkubeProgram } from "./runPlan";
import {
  DEVICE_FEE_ALLOWANCE_LAMPORTS,
  deviceSignerTopUpLamports,
  validatedDeviceSignerBalance,
  validateDeviceSignerFunding,
} from "./deviceSessionFunding";
import {
  buildDeviceSessionRefillInstructions,
  buildDeviceSignerReclaimInstruction,
  deviceSessionExpiryDelayMs,
  DeviceSessionExpiredError,
  DEVICE_SESSION_EXPIRED_MESSAGE,
  DEVICE_SESSION_READY_SKEW_SECONDS,
} from "./deviceSessionLifecycle";
import { buildRevokeExpiredSessionInstruction } from "./sessionCleanup";
import { createChainTraceId, emitChainMetric } from "./telemetry";

const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60 - 5 * 60;
const PLAYER_FUNDING_TARGET_LAMPORTS = 50_000_000;

interface ConnectedWalletState {
  connector: WalletConnector;
  publicKey: PublicKey;
  wallet: WalletLike;
}

type SessionRefreshResult =
  | "ready"
  | "missing"
  | "expired"
  | "needsRenewal"
  | "unavailable";

/**
 * Owns the atomic external-wallet lifecycle: connect the exact address, reuse
 * only its matching live SessionTokenV2, or immediately request one owner-paid
 * Enable zKube approval. Account changes clear the previous address's local
 * session/run markers; wallet and session secret material never leaves their
 * respective connector/browser-storage boundary.
 */
export function ConnectedPlayerProvider({ children }: { children: ReactNode }) {
  const { connection } = useSolanaConnection();
  const [connectors, setConnectors] = useState(discoverWalletConnectors);
  const [connectedWallet, setConnectedWallet] =
    useState<ConnectedWalletState | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<PlayerConnectionStatus>("disconnected");
  const [session, setSession] = useState<DeviceSession | null>(null);
  const [sessionStatus, setSessionStatus] =
    useState<PlayerSessionStatus>("missing");
  const [balanceLamports, setBalanceLamports] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectedRef = useRef<ConnectedWalletState | null>(null);
  const mountedRef = useRef(true);
  const lifecycleGenerationRef = useRef(0);
  const balanceRequestRef = useRef(0);
  const walletActionRequestRef = useRef(0);
  const silentReconnectRef = useRef<Promise<void> | null>(null);
  const walletConnectionAttemptRef = useRef<{
    connector: WalletConnector;
  } | null>(null);
  const explicitConnectRef = useRef<{
    connectorId: string;
    promise: Promise<SessionRefreshResult>;
  } | null>(null);
  const initialReconnectSelectionRef = useRef<string | null>(null);
  const readOnlyWallet = useMemo(
    () => createReadOnlyWallet(connectedWallet?.publicKey),
    [connectedWallet?.publicKey],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    connectedRef.current = connectedWallet;
  }, [connectedWallet]);

  useEffect(() => {
    if (!session) return;
    const expireIfNeeded = () => {
      if (
        !mountedRef.current ||
        connectedRef.current?.publicKey.equals(session.owner) !== true
      ) {
        return false;
      }
      if (deviceSessionExpiryDelayMs(session.validUntil) > 0) return false;
      setSessionStatus("expired");
      setError(DEVICE_SESSION_EXPIRED_MESSAGE);
      return true;
    };
    if (expireIfNeeded()) return;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const scheduleExpiry = () => {
      const milliseconds = deviceSessionExpiryDelayMs(session.validUntil);
      if (milliseconds <= 0) {
        expireIfNeeded();
        return;
      }
      timer = globalThis.setTimeout(scheduleExpiry, milliseconds);
    };
    scheduleExpiry();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") expireIfNeeded();
    };
    const onPageShow = () => {
      expireIfNeeded();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      if (timer !== undefined) globalThis.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [session]);

  useEffect(() => {
    const registry = walletRegistry();
    const refresh = () => setConnectors(discoverWalletConnectors());
    const offRegister = registry.on("register", refresh);
    const offUnregister = registry.on("unregister", refresh);
    refresh();
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);

  const clearOwnerState = useCallback((owner: PublicKey) => {
    clearDeviceSession(owner);
    clearRunSession(owner);
  }, []);

  const resetConnection = useCallback(
    (reason: string | null, clearOwner: boolean) => {
      lifecycleGenerationRef.current += 1;
      balanceRequestRef.current += 1;
      walletActionRequestRef.current += 1;
      const previous = connectedRef.current;
      if (previous && clearOwner) clearOwnerState(previous.publicKey);
      connectedRef.current = null;
      setConnectedWallet(null);
      setConnectionStatus("disconnected");
      setSession(null);
      setSessionStatus("missing");
      setBalanceLamports(null);
      setBalanceLoading(false);
      setError(reason);
    },
    [clearOwnerState],
  );

  useEffect(() => {
    if (!connectedWallet) return;
    let active = true;
    const expected = connectedWallet;
    const generation = lifecycleGenerationRef.current;
    const unsubscribe = subscribeWalletAccounts(
      connectedWallet.connector.wallet,
      (accounts) => {
        if (
          !active ||
          generation !== lifecycleGenerationRef.current ||
          connectedRef.current !== expected
        ) {
          return;
        }
        const account = accounts.find(
          (candidate) => candidate.address === expected.publicKey.toBase58(),
        );
        if (account) {
          try {
            const refreshed = {
              ...expected,
              wallet: createWalletStandardWallet(
                expected.connector.wallet,
                account,
              ),
            };
            connectedRef.current = refreshed;
            setConnectedWallet(refreshed);
            return;
          } catch (cause) {
            clearOwnerState(expected.publicKey);
            clearLastWallet();
            resetConnection(walletErrorMessage(cause), false);
            void disconnectWalletStandard(expected.connector.wallet, {
              clearMobileAuthorizationCache:
                expected.connector.kind === "mobile-wallet-adapter",
            }).catch(() => undefined);
            return;
          }
        }
        clearOwnerState(expected.publicKey);
        clearLastWallet();
        resetConnection(
          accounts.length > 0
            ? "The wallet account changed. Connect and enable the new address."
            : "The wallet disconnected.",
          false,
        );
        void disconnectWalletStandard(expected.connector.wallet, {
          clearMobileAuthorizationCache:
            expected.connector.kind === "mobile-wallet-adapter",
        }).catch(() => undefined);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [clearOwnerState, connectedWallet, resetConnection]);

  const refreshBalance = useCallback(async () => {
    const expected = connectedRef.current;
    const request = ++balanceRequestRef.current;
    if (!expected) {
      setBalanceLamports(null);
      return;
    }
    setBalanceLoading(true);
    try {
      const lamports = await connection.getBalance(
        expected.publicKey,
        "confirmed",
      );
      if (
        !mountedRef.current ||
        request !== balanceRequestRef.current ||
        !sameConnectedWallet(expected, connectedRef.current)
      ) {
        return;
      }
      setBalanceLamports(lamports);
    } catch (cause) {
      if (
        !mountedRef.current ||
        request !== balanceRequestRef.current ||
        !sameConnectedWallet(expected, connectedRef.current)
      ) {
        return;
      }
      setBalanceLamports(null);
      setError(walletErrorMessage(cause));
    } finally {
      if (
        mountedRef.current &&
        request === balanceRequestRef.current &&
        sameConnectedWallet(expected, connectedRef.current)
      ) {
        setBalanceLoading(false);
      }
    }
  }, [connection]);

  const refreshSession = useCallback(
    async (owner: PublicKey): Promise<SessionRefreshResult> => {
      const generation = lifecycleGenerationRef.current;
      const canApply = () =>
        mountedRef.current &&
        generation === lifecycleGenerationRef.current &&
        connectedRef.current?.publicKey.equals(owner) === true;
      const traceId = createChainTraceId();
      const stored = loadDeviceSession(owner);
      if (!stored) {
        if (canApply()) {
          setSession(null);
          setSessionStatus("missing");
        }
        emitChainMetric({
          traceId,
          operation: "session:refresh",
          layer: "solana-base",
          phase: "missing",
          ok: true,
          owner: owner.toBase58(),
        });
        return "missing";
      }
      if (canApply()) {
        setSession(stored);
        setSessionStatus("checking");
      }
      let info;
      let fundingInfo;
      let signerInfo;
      let signerRentFloor;
      let protocol;
      try {
        const program = zkubeProgram(connection, createReadOnlyWallet(owner));
        [[info, fundingInfo, signerInfo], signerRentFloor, protocol] =
          await Promise.all([
            connection.getMultipleAccountsInfo(
              [
                stored.sessionToken,
                derivePlayerFundingPda(owner),
                stored.signer.publicKey,
              ],
              "confirmed",
            ),
            connection.getMinimumBalanceForRentExemption(0, "confirmed"),
            program.account.protocolConfig.fetch(deriveProtocolConfigPda()),
          ]);
      } catch (cause) {
        const message = walletErrorMessage(cause);
        if (canApply()) {
          setError(
            `Solana Devnet unavailable; the local session was retained. ${message}`,
          );
        }
        emitChainMetric({
          traceId,
          operation: "session:refresh",
          layer: "solana-base",
          phase: "rpc-error",
          ok: false,
          owner: owner.toBase58(),
          error: message,
        });
        return "unavailable";
      }
      try {
        if (!info)
          throw new Error("Stored device session does not exist on Devnet");
        const token = decodeSessionTokenV2Account(stored.sessionToken, info);
        if (
          !token.authority.equals(owner) ||
          !token.sessionSigner.equals(stored.signer.publicKey) ||
          !token.targetProgram.equals(ZKUBE_PROGRAM_ID) ||
          token.validUntil !== stored.validUntil
        ) {
          throw new Error(
            "Stored device session does not match the connected wallet",
          );
        }
        if (!token.feePayer.equals(owner)) {
          throw new Error(
            "Stored device session was created by a different owner payer",
          );
        }
        if (!isNormalizedPlayerFunding(fundingInfo)) {
          if (canApply()) {
            setSession(null);
            setSessionStatus("missing");
          }
          return "missing";
        }
        const configuredFundingTarget = validatedPlayerFundingTarget(
          protocol.playerFundingTargetLamports,
        );
        const now = Math.floor(Date.now() / 1_000);
        const fundingStatus = validateDeviceSignerFunding({
          info: signerInfo,
          rentFloorLamports: signerRentFloor,
        });
        const result =
          token.validUntil - now > DEVICE_SESSION_READY_SKEW_SECONDS
            ? fundingInfo!.lamports >= configuredFundingTarget
              ? fundingStatus
              : "needsRenewal"
            : "expired";
        if (canApply()) {
          setSessionStatus(result);
          setError((current) =>
            result === "expired"
              ? DEVICE_SESSION_EXPIRED_MESSAGE
              : current === DEVICE_SESSION_EXPIRED_MESSAGE
                ? null
                : current,
          );
        }
        emitChainMetric({
          traceId,
          operation: "session:refresh",
          layer: "solana-base",
          phase: result,
          ok: true,
          owner: owner.toBase58(),
          actor: stored.signer.publicKey.toBase58(),
          balanceAfterLamports: signerInfo?.lamports ?? 0,
          rentFloorLamports: signerRentFloor,
          validUntil: token.validUntil,
        });
        return result;
      } catch (cause) {
        const message = walletErrorMessage(cause);
        if (canApply()) {
          clearDeviceSession(owner);
          setSession(null);
          setSessionStatus("missing");
          setError(message);
        }
        emitChainMetric({
          traceId,
          operation: "session:refresh",
          layer: "solana-base",
          phase: "invalid",
          ok: false,
          owner: owner.toBase58(),
          error: message,
        });
        return "missing";
      }
    },
    [connection],
  );

  const connectWallet = useCallback(
    (connectorId: string): Promise<SessionRefreshResult> => {
      const pending = explicitConnectRef.current;
      if (pending) {
        if (pending.connectorId === connectorId) return pending.promise;
        return Promise.reject(
          new Error("Another wallet connection is already in progress"),
        );
      }

      const promise = (async (): Promise<SessionRefreshResult> => {
        // Register this explicit intent before waiting so every later connect
        // joins it. The wallet's explicit authorization cannot overlap the
        // cache-only reconnect, and the silent lifecycle remains nonvisual.
        const silentReconnect = silentReconnectRef.current;
        if (silentReconnect) await silentReconnect;
        const restored = connectedRef.current;
        if (restored) {
          if (restored.connector.id !== connectorId) {
            throw new Error(
              "Disconnect the current wallet before choosing another wallet.",
            );
          }
          return refreshSession(restored.publicKey);
        }
        const connector = connectors.find(
          (candidate) => candidate.id === connectorId,
        );
        if (!connector)
          throw new Error("The selected wallet is no longer available");
        const generation = ++lifecycleGenerationRef.current;
        setConnectionStatus("connecting");
        setError(null);
        try {
          const attempt = { connector };
          walletConnectionAttemptRef.current = attempt;
          let connected: Awaited<ReturnType<typeof connectWalletStandard>>;
          try {
            connected = await connectWalletStandard(connector);
          } finally {
            if (walletConnectionAttemptRef.current === attempt) {
              walletConnectionAttemptRef.current = null;
            }
          }
          if (
            !mountedRef.current ||
            generation !== lifecycleGenerationRef.current
          ) {
            await disconnectWalletStandard(connector.wallet, {
              clearMobileAuthorizationCache:
                connector.kind === "mobile-wallet-adapter",
            }).catch(() => undefined);
            throw new Error("Wallet connection was superseded");
          }
          const next = {
            connector,
            publicKey: connected.wallet.publicKey,
            wallet: connected.wallet,
          };
          connectedRef.current = next;
          setConnectedWallet(next);
          setConnectionStatus("connected");
          saveLastWallet({
            connectorId: connector.id,
            address: next.publicKey.toBase58(),
          });
          const [sessionResult] = await Promise.all([
            refreshSession(next.publicKey),
            (async () => {
              await Promise.resolve();
              await refreshBalance();
            })(),
          ]);
          if (generation !== lifecycleGenerationRef.current) {
            throw new Error("Wallet connection was superseded");
          }
          return sessionResult;
        } catch (cause) {
          if (
            mountedRef.current &&
            generation === lifecycleGenerationRef.current
          ) {
            resetConnection(walletErrorMessage(cause), false);
          }
          throw cause;
        }
      })();
      explicitConnectRef.current = { connectorId, promise };
      void promise.then(
        () => {
          if (explicitConnectRef.current?.promise === promise) {
            explicitConnectRef.current = null;
          }
        },
        () => {
          if (explicitConnectRef.current?.promise === promise) {
            explicitConnectRef.current = null;
          }
        },
      );
      return promise;
    },
    [connectors, refreshBalance, refreshSession, resetConnection],
  );

  const reconnectRememberedWallet = useCallback((): Promise<void> => {
    if (connectedRef.current) return Promise.resolve();
    if (explicitConnectRef.current) return Promise.resolve();
    if (silentReconnectRef.current) return silentReconnectRef.current;
    const stored = loadLastWallet();
    if (!stored) return Promise.resolve();
    const connector = connectors.find(
      (candidate) => candidate.id === stored.connectorId,
    );
    if (!connector) return Promise.resolve();
    const generation = ++lifecycleGenerationRef.current;
    const task = (async () => {
      try {
        // Wallet Standard requires `silent: true` to prohibit connection UI.
        // MWA 0.5.3 satisfies this from its authorization cache only.
        const attempt = { connector };
        walletConnectionAttemptRef.current = attempt;
        let connected: Awaited<ReturnType<typeof connectWalletStandard>>;
        try {
          connected = await connectWalletStandard(connector, {
            silent: true,
          });
        } finally {
          if (walletConnectionAttemptRef.current === attempt) {
            walletConnectionAttemptRef.current = null;
          }
        }
        if (
          !mountedRef.current ||
          generation !== lifecycleGenerationRef.current
        ) {
          await disconnectWalletStandard(connector.wallet, {
            clearMobileAuthorizationCache:
              connector.kind === "mobile-wallet-adapter",
          }).catch(() => undefined);
          return;
        }
        if (connected.wallet.publicKey.toBase58() !== stored.address) {
          clearLastWallet();
          await disconnectWalletStandard(connector.wallet, {
            clearMobileAuthorizationCache:
              connector.kind === "mobile-wallet-adapter",
          }).catch(() => undefined);
          if (generation === lifecycleGenerationRef.current) {
            resetConnection(
              "The wallet account does not match the previously connected player. Connect the intended address explicitly.",
              false,
            );
          }
          return;
        }
        const next = {
          connector,
          publicKey: connected.wallet.publicKey,
          wallet: connected.wallet,
        };
        connectedRef.current = next;
        setConnectedWallet(next);
        setConnectionStatus("connected");
        await Promise.all([refreshSession(next.publicKey), refreshBalance()]);
      } catch {
        // Silent restore is best-effort and never opens a wallet prompt. Keep
        // the remembered selection so an explicit user retry remains possible.
        if (
          mountedRef.current &&
          generation === lifecycleGenerationRef.current
        ) {
          resetConnection(null, false);
        }
      }
    })();
    silentReconnectRef.current = task;
    void task.then(
      () => {
        if (silentReconnectRef.current === task) {
          silentReconnectRef.current = null;
        }
      },
      () => {
        if (silentReconnectRef.current === task) {
          silentReconnectRef.current = null;
        }
      },
    );
    return task;
  }, [connectors, refreshBalance, refreshSession, resetConnection]);

  // Restore exactly one remembered connector/address pair on startup. Wallets
  // register asynchronously, so wait until that connector appears. A failed
  // cache-only attempt can be retried on a later foreground resume.
  useEffect(() => {
    if (connectedRef.current) return;
    const stored = loadLastWallet();
    if (!stored) return;
    const connector = connectors.find(
      (candidate) => candidate.id === stored.connectorId,
    );
    if (!connector) return;
    const selection = `${stored.connectorId}\0${stored.address}`;
    if (initialReconnectSelectionRef.current === selection) return;
    initialReconnectSelectionRef.current = selection;
    void reconnectRememberedWallet();
  }, [connectors, reconnectRememberedWallet]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void reconnectRememberedWallet();
      }
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void reconnectRememberedWallet();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [reconnectRememberedWallet]);

  const authorizeDeviceSession = useCallback(async () => {
    const current = connectedRef.current;
    if (!current)
      throw new Error("Connect a Solana wallet before enabling zKube");
    assertDeviceSessionStorageAvailable();
    const now = Math.floor(Date.now() / 1_000);
    const traceId = createChainTraceId();
    const startedAt = Date.now();
    const stored = loadDeviceSession(current.publicKey);
    let previousSignerBalance = 0;
    let previousSession: DeviceSession | null = null;
    let revokeInstruction: TransactionInstruction | null = null;
    const program = zkubeProgram(connection, current.wallet);
    const playerFunding = derivePlayerFundingPda(current.publicKey);
    const [protocol, existingFundingInfo] = await Promise.all([
      program.account.protocolConfig.fetch(deriveProtocolConfigPda()),
      connection.getAccountInfo(playerFunding, "confirmed"),
    ]);
    if (
      existingFundingInfo &&
      !isNormalizedPlayerFunding(existingFundingInfo)
    ) {
      throw new Error(
        "Player funding PDA has an invalid owner or account layout",
      );
    }
    const configuredFundingTarget = validatedPlayerFundingTarget(
      protocol.playerFundingTargetLamports,
    );
    const fundingTopUp = Math.max(
      0,
      configuredFundingTarget - (existingFundingInfo?.lamports ?? 0),
    );

    if (stored) {
      const [tokenInfo, signerInfo] = await connection.getMultipleAccountsInfo(
        [stored.sessionToken, stored.signer.publicKey],
        "confirmed",
      );
      if (!tokenInfo) {
        throw new Error("Stored device session token does not exist on Devnet");
      }
      const token = decodeSessionTokenV2Account(stored.sessionToken, tokenInfo);
      if (
        !token.authority.equals(current.publicKey) ||
        !token.sessionSigner.equals(stored.signer.publicKey) ||
        !token.targetProgram.equals(ZKUBE_PROGRAM_ID) ||
        !token.feePayer.equals(current.publicKey) ||
        token.validUntil !== stored.validUntil
      ) {
        throw new Error("Stored device session relationships are invalid");
      }
      // A fully spent zero-data System account disappears. The locally stored
      // keypair plus the validated live session token still lets the owner
      // recreate and refill that same scoped signer safely.
      previousSignerBalance = signerInfo
        ? validatedDeviceSignerBalance(signerInfo)
        : 0;
      previousSession = stored;
      if (token.validUntil - now > DEVICE_SESSION_READY_SKEW_SECONDS) {
        const topUpLamports = deviceSignerTopUpLamports(previousSignerBalance);
        if (topUpLamports === 0 && fundingTopUp === 0) {
          setSession(stored);
          setSessionStatus("ready");
          setError(null);
          emitChainMetric({
            traceId,
            operation: "session:reuse",
            layer: "solana-base",
            phase: "ready",
            ok: true,
            owner: current.publicKey.toBase58(),
            actor: stored.signer.publicKey.toBase58(),
            balanceAfterLamports: previousSignerBalance,
            playerFundingLamports: existingFundingInfo?.lamports ?? 0,
            validUntil: stored.validUntil,
          });
          return "";
        }
        emitChainMetric({
          traceId,
          operation: "session:refill-start",
          layer: "solana-base",
          phase: "refill",
          ok: true,
          owner: current.publicKey.toBase58(),
          actor: stored.signer.publicKey.toBase58(),
          balanceBeforeLamports: previousSignerBalance,
          topUpLamports,
          playerFundingTopUpLamports: fundingTopUp,
          validUntil: stored.validUntil,
        });
        const refillInstructions =
          topUpLamports > 0
            ? buildDeviceSessionRefillInstructions({
                owner: current.publicKey,
                signer: stored.signer.publicKey,
                balanceLamports: previousSignerBalance,
              }).instructions
            : [];
        if (fundingTopUp > 0) {
          refillInstructions.push(
            SystemProgram.transfer({
              fromPubkey: current.publicKey,
              toPubkey: playerFunding,
              lamports: fundingTopUp,
            }),
          );
        }
        const signature = await submitOwnerSessionTransaction({
          connection,
          wallet: current.wallet,
          owner: current.publicKey,
          label: "Refill zKube device session",
          instructions: refillInstructions,
          signers: topUpLamports > 0 ? [stored.signer] : [],
          assertWalletCurrent: () =>
            assertConnectedWallet(current, connectedRef.current),
        });
        setSession(stored);
        setSessionStatus("ready");
        setError(null);
        emitChainMetric({
          traceId,
          operation: "session:refill-done",
          layer: "solana-base",
          phase: "refill",
          ok: true,
          signature,
          durationMs: Date.now() - startedAt,
          balanceAfterLamports: DEVICE_FEE_ALLOWANCE_LAMPORTS,
          playerFundingLamports:
            (existingFundingInfo?.lamports ?? 0) + fundingTopUp,
        });
        return signature;
      }
      if (token.validUntil <= now) {
        revokeInstruction = buildRevokeExpiredSessionInstruction(
          { address: stored.sessionToken, ...token },
          now,
        );
      }
    }

    const signer = Keypair.generate();
    const validUntil = now + SESSION_LIFETIME_SECONDS;
    const { sessionToken } = deriveSessionTokenV2Pda({
      authority: current.publicKey,
      sessionSigner: signer.publicKey,
    });
    const playerState = derivePlayerStatePda(current.publicKey);
    const [profileInfo, fundingInfo] = await Promise.all([
      connection.getAccountInfo(playerState, "confirmed"),
      connection.getAccountInfo(playerFunding, "confirmed"),
    ]);
    if (profileInfo) {
      if (
        !profileInfo.owner.equals(ZKUBE_PROGRAM_ID) ||
        profileInfo.executable ||
        profileInfo.data.length !== program.account.playerState.size
      ) {
        throw new Error("PlayerState has an invalid owner or account layout");
      }
      const profile = await program.account.playerState.fetch(playerState);
      if (!profile.owner.equals(current.publicKey)) {
        throw new Error("PlayerState belongs to a different wallet");
      }
    }
    if (fundingInfo && !isNormalizedPlayerFunding(fundingInfo)) {
      throw new Error(
        "Player funding PDA has an invalid owner or account layout",
      );
    }
    const freshFundingTopUp = Math.max(
      0,
      configuredFundingTarget - (fundingInfo?.lamports ?? 0),
    );
    const instructions: TransactionInstruction[] = [];
    if (revokeInstruction) instructions.push(revokeInstruction);
    if (previousSession) {
      const reclaim = buildDeviceSignerReclaimInstruction({
        owner: current.publicKey,
        signer: previousSession.signer.publicKey,
        balanceLamports: previousSignerBalance,
      });
      if (reclaim) instructions.push(reclaim);
    }
    instructions.push(
      await program.methods
        .initializePlayer()
        .accountsPartial({
          playerState,
          playerFunding,
          payer: current.publicKey,
          ownerAuthority: current.publicKey,
          sessionToken: null,
          actor: current.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
    if (freshFundingTopUp > 0) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: current.publicKey,
          toPubkey: playerFunding,
          lamports: freshFundingTopUp,
        }),
      );
    }
    instructions.push(
      buildCreateSessionV2Instruction({
        authority: current.publicKey,
        sessionSigner: signer.publicKey,
        feePayer: current.publicKey,
        targetProgram: ZKUBE_PROGRAM_ID,
        topUp: true,
        validUntil,
        lamports: DEVICE_FEE_ALLOWANCE_LAMPORTS,
      }),
    );
    emitChainMetric({
      traceId,
      operation: "session:rotate-start",
      layer: "solana-base",
      phase: previousSession ? "rotate" : "create",
      ok: true,
      owner: current.publicKey.toBase58(),
      actor: signer.publicKey.toBase58(),
      reclaimedSignerLamports: previousSignerBalance,
      revokedExpiredToken: Boolean(revokeInstruction),
      fundingTopUpLamports: freshFundingTopUp,
      allowanceLamports: DEVICE_FEE_ALLOWANCE_LAMPORTS,
      validUntil,
    });
    const signature = await submitOwnerSessionTransaction({
      connection,
      wallet: current.wallet,
      owner: current.publicKey,
      label: previousSession
        ? "Rotate zKube device session"
        : "Enable zKube device session",
      instructions,
      signers:
        previousSession && previousSignerBalance > 0
          ? [signer, previousSession.signer]
          : [signer],
      assertWalletCurrent: () =>
        assertConnectedWallet(current, connectedRef.current),
    });
    const next: DeviceSession = {
      owner: current.publicKey,
      signer,
      sessionToken,
      validUntil,
      createdAt: now,
    };
    saveDeviceSession(next);
    setSession(next);
    setSessionStatus("ready");
    setError(null);
    emitChainMetric({
      traceId,
      operation: "session:rotate-done",
      layer: "solana-base",
      phase: previousSession ? "rotate" : "create",
      ok: true,
      signature,
      durationMs: Date.now() - startedAt,
      balanceAfterLamports: DEVICE_FEE_ALLOWANCE_LAMPORTS,
    });
    return signature;
  }, [connection]);

  const connectAndEnable = useCallback(
    async (connectorId: string) => {
      const request = ++walletActionRequestRef.current;
      setError(null);
      try {
        const current = connectedRef.current;
        let sessionResult: SessionRefreshResult;
        if (current) {
          if (current.connector.id !== connectorId) {
            throw new Error(
              "Disconnect the current wallet before choosing another wallet.",
            );
          }
          sessionResult = await refreshSession(current.publicKey);
        } else {
          sessionResult = await connectWallet(connectorId);
        }
        if (sessionResult === "ready") return;
        await authorizeDeviceSession();
      } catch (cause) {
        if (mountedRef.current && request === walletActionRequestRef.current) {
          setError(walletErrorMessage(cause));
        }
        // Preserve the pinned Mobile Wallet Adapter error/cause chain for the
        // connection CTA's typed recovery classifier.
        throw cause;
      }
    },
    [authorizeDeviceSession, connectWallet, refreshSession],
  );

  const disconnect = useCallback(async () => {
    const current = connectedRef.current;
    const selectedConnector =
      current?.connector ?? walletConnectionAttemptRef.current?.connector;
    if (current) {
      clearOwnerState(current.publicKey);
    }
    clearLastWallet();
    resetConnection(null, false);
    if (selectedConnector) {
      await disconnectWalletStandard(selectedConnector.wallet).catch(
        () => undefined,
      );
    }
    // Await the same public cache object supplied to registerMwa. This also
    // closes the small gap in MWA 0.5.3 where StandardDisconnect invokes
    // AuthorizationCache.clear() without awaiting it.
    await clearMobileWalletAuthorizationCache().catch(() => false);
  }, [clearOwnerState, resetConnection]);

  const requireSession = useCallback(() => {
    if (!session || sessionStatus !== "ready") {
      if (sessionStatus === "expired") {
        throw new DeviceSessionExpiredError();
      }
      throw new Error(
        sessionStatus === "needsRenewal"
          ? "This device's zKube fee allowance is low. Renew it before continuing."
          : "Enable zKube before changing player state.",
      );
    }
    const current = connectedRef.current;
    if (!current) throw new Error("The connected wallet account changed");
    return requireCurrentDeviceSession(session, current.publicKey);
  }, [session, sessionStatus]);

  const markSessionNeedsRenewal = useCallback(() => {
    setSessionStatus((status) =>
      status === "ready" ? "needsRenewal" : status,
    );
  }, []);

  const value = useMemo<ConnectedPlayerValue>(
    () => ({
      connectors,
      connectionStatus,
      connector: connectedWallet?.connector ?? null,
      publicKey: connectedWallet?.publicKey ?? null,
      wallet: connectedWallet?.wallet ?? null,
      readOnlyWallet,
      session,
      sessionStatus,
      balanceLamports,
      balanceLoading,
      error,
      connectAndEnable,
      enable: authorizeDeviceSession,
      renew: authorizeDeviceSession,
      disconnect,
      refreshBalance,
      requireSession,
      markSessionNeedsRenewal,
    }),
    [
      authorizeDeviceSession,
      balanceLamports,
      balanceLoading,
      connectAndEnable,
      connectedWallet,
      connectionStatus,
      connectors,
      disconnect,
      error,
      readOnlyWallet,
      refreshBalance,
      requireSession,
      markSessionNeedsRenewal,
      session,
      sessionStatus,
    ],
  );

  return (
    <ConnectedPlayerContext.Provider value={value}>
      {children}
    </ConnectedPlayerContext.Provider>
  );
}

async function submitOwnerSessionTransaction(args: {
  connection: Connection;
  wallet: WalletLike;
  owner: PublicKey;
  label: string;
  instructions: TransactionInstruction[];
  signers: Keypair[];
  assertWalletCurrent(): void;
}): Promise<string> {
  if (!args.wallet.publicKey.equals(args.owner)) {
    throw new Error("The connected wallet is not the session owner");
  }
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
    throw new Error(
      `${args.label} simulation failed: ${JSON.stringify(simulation.value.err)}`,
    );
  }
  const signed = await args.wallet.signTransaction(transaction);
  args.assertWalletCurrent();
  const signature = await args.connection.sendRawTransaction(
    signed.serialize(),
    { maxRetries: 5, skipPreflight: false },
  );
  const confirmation = await args.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error(`${args.label} was not confirmed`);
  }
  return signature;
}

function assertConnectedWallet(
  expected: ConnectedWalletState,
  current: ConnectedWalletState | null,
): void {
  if (!sameConnectedWallet(expected, current)) {
    throw new Error("The wallet account changed during session authorization");
  }
}

function sameConnectedWallet(
  expected: ConnectedWalletState,
  current: ConnectedWalletState | null,
): boolean {
  return Boolean(
    current &&
    current.publicKey.equals(expected.publicKey) &&
    current.connector.id === expected.connector.id,
  );
}

function walletErrorMessage(cause: unknown): string {
  return isWalletRejection(cause)
    ? "The wallet rejected the request."
    : errorMessage(cause);
}

function isNormalizedPlayerFunding(info: AccountInfo<Buffer> | null): boolean {
  return Boolean(
    info &&
    !info.executable &&
    info.owner.equals(SystemProgram.programId) &&
    info.data.length === 0,
  );
}

function validatedPlayerFundingTarget(value: { toString(): string }): number {
  const target = Number(value.toString());
  if (
    !Number.isSafeInteger(target) ||
    target <= 0 ||
    target > PLAYER_FUNDING_TARGET_LAMPORTS
  ) {
    throw new Error("Protocol player funding target is invalid");
  }
  return target;
}
