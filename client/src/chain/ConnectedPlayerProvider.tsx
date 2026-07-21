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
  connectWalletStandard,
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
import { zkubeProgram } from "./runPlan";
import {
  DEVICE_FEE_ALLOWANCE_LAMPORTS,
  deviceSignerTopUpLamports,
  validatedDeviceSignerBalance,
  validateDeviceSignerFunding,
} from "./deviceSessionFunding";
import {
  buildDeviceSessionRefillInstructions,
  buildDeviceSignerReclaimInstruction,
} from "./deviceSessionLifecycle";
import { buildRevokeExpiredSessionInstruction } from "./sessionCleanup";
import { createChainTraceId, emitChainMetric } from "./telemetry";

const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60 - 5 * 60;
const SESSION_READY_SKEW_SECONDS = 60;
const PLAYER_FUNDING_TARGET_LAMPORTS = 25_000_000;

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
  const readOnlyWallet = useMemo(
    () => createReadOnlyWallet(connectedWallet?.publicKey),
    [connectedWallet?.publicKey],
  );

  useEffect(() => {
    connectedRef.current = connectedWallet;
  }, [connectedWallet]);

  useEffect(() => {
    if (!session) return;
    const milliseconds =
      (session.validUntil -
        Math.floor(Date.now() / 1_000) -
        SESSION_READY_SKEW_SECONDS) *
      1_000;
    if (milliseconds <= 0) {
      setSessionStatus("expired");
      return;
    }
    const timer = globalThis.setTimeout(
      () => setSessionStatus("expired"),
      milliseconds,
    );
    return () => globalThis.clearTimeout(timer);
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
      const previous = connectedRef.current;
      if (previous && clearOwner) clearOwnerState(previous.publicKey);
      connectedRef.current = null;
      setConnectedWallet(null);
      setConnectionStatus("disconnected");
      setSession(null);
      setSessionStatus("missing");
      setBalanceLamports(null);
      setError(reason);
    },
    [clearOwnerState],
  );

  useEffect(() => {
    if (!connectedWallet) return;
    return subscribeWalletAccounts(
      connectedWallet.connector.wallet,
      (accounts) => {
        const account = accounts[0];
        if (account?.address === connectedWallet.publicKey.toBase58()) return;
        clearOwnerState(connectedWallet.publicKey);
        clearLastWallet();
        void disconnectWalletStandard(connectedWallet.connector.wallet).catch(
          () => undefined,
        );
        resetConnection(
          account
            ? "The wallet account changed. Connect and enable the new address."
            : "The wallet disconnected.",
          false,
        );
      },
    );
  }, [clearOwnerState, connectedWallet, resetConnection]);

  const refreshBalance = useCallback(async () => {
    const owner = connectedRef.current?.publicKey;
    if (!owner) {
      setBalanceLamports(null);
      return;
    }
    setBalanceLoading(true);
    try {
      const lamports = await connection.getBalance(owner, "confirmed");
      setBalanceLamports(lamports);
    } catch (cause) {
      setBalanceLamports(null);
      setError(walletErrorMessage(cause));
    } finally {
      setBalanceLoading(false);
    }
  }, [connection]);

  const refreshSession = useCallback(
    async (owner: PublicKey): Promise<SessionRefreshResult> => {
      const traceId = createChainTraceId();
      const stored = loadDeviceSession(owner);
      if (!stored) {
        setSession(null);
        setSessionStatus("missing");
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
      setSession(stored);
      setSessionStatus("checking");
      let info;
      let fundingInfo;
      let signerInfo;
      let signerRentFloor;
      try {
        [[info, fundingInfo, signerInfo], signerRentFloor] = await Promise.all([
          connection.getMultipleAccountsInfo(
            [
              stored.sessionToken,
              derivePlayerFundingPda(owner),
              stored.signer.publicKey,
            ],
            "confirmed",
          ),
          connection.getMinimumBalanceForRentExemption(0, "confirmed"),
        ]);
      } catch (cause) {
        const message = walletErrorMessage(cause);
        setError(
          `Solana Devnet unavailable; the local session was retained. ${message}`,
        );
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
          setSession(null);
          setSessionStatus("missing");
          return "missing";
        }
        const now = Math.floor(Date.now() / 1_000);
        const fundingStatus = validateDeviceSignerFunding({
          info: signerInfo,
          rentFloorLamports: signerRentFloor,
        });
        const result =
          token.validUntil - now > SESSION_READY_SKEW_SECONDS
            ? fundingStatus
            : "expired";
        setSessionStatus(result);
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
        clearDeviceSession(owner);
        setSession(null);
        setSessionStatus("missing");
        const message = walletErrorMessage(cause);
        setError(message);
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
    async (connectorId: string): Promise<SessionRefreshResult> => {
      const connector = connectors.find(
        (candidate) => candidate.id === connectorId,
      );
      if (!connector)
        throw new Error("The selected wallet is no longer available");
      setConnectionStatus("connecting");
      setError(null);
      try {
        const connected = await connectWalletStandard(connector);
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
        return sessionResult;
      } catch (cause) {
        resetConnection(walletErrorMessage(cause), false);
        throw cause;
      }
    },
    [connectors, refreshBalance, refreshSession, resetConnection],
  );

  // Silently restore the last wallet on page load so a refresh never forces a
  // reconnect tap. One attempt per page load; wallets register asynchronously,
  // so the effect waits for the remembered connector to appear.
  const autoReconnectAttempted = useRef(false);
  useEffect(() => {
    if (autoReconnectAttempted.current || connectedRef.current) return;
    const stored = loadLastWallet();
    if (!stored) {
      autoReconnectAttempted.current = true;
      return;
    }
    const connector = connectors.find(
      (candidate) => candidate.id === stored.connectorId,
    );
    if (!connector) return;
    autoReconnectAttempted.current = true;
    void (async () => {
      setConnectionStatus("connecting");
      try {
        const connected = await connectWalletStandard(connector, {
          silent: true,
        });
        if (connectedRef.current) return;
        if (connected.wallet.publicKey.toBase58() !== stored.address) {
          // A different account came back — require an explicit tap instead
          // of silently adopting it.
          await disconnectWalletStandard(connector.wallet).catch(
            () => undefined,
          );
          setConnectionStatus("disconnected");
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
        // Silent restore is best-effort; the gate stays one tap away.
        if (!connectedRef.current) setConnectionStatus("disconnected");
      }
    })();
  }, [connectors, refreshBalance, refreshSession]);

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
      if (token.validUntil - now > SESSION_READY_SKEW_SECONDS) {
        const topUpLamports = deviceSignerTopUpLamports(previousSignerBalance);
        if (topUpLamports === 0) {
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
          validUntil: stored.validUntil,
        });
        const refill = buildDeviceSessionRefillInstructions({
          owner: current.publicKey,
          signer: stored.signer.publicKey,
          balanceLamports: previousSignerBalance,
        });
        const signature = await submitOwnerSessionTransaction({
          connection,
          wallet: current.wallet,
          owner: current.publicKey,
          label: "Refill zKube device session",
          instructions: refill.instructions,
          signers: [stored.signer],
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
    const program = zkubeProgram(connection, current.wallet);
    const playerState = derivePlayerStatePda(current.publicKey);
    const playerFunding = derivePlayerFundingPda(current.publicKey);
    const [protocol, profileInfo, fundingInfo] = await Promise.all([
      program.account.protocolConfig.fetch(deriveProtocolConfigPda()),
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
    if (
      fundingInfo &&
      !isNormalizedPlayerFunding(fundingInfo)
    ) {
      throw new Error(
        "Player funding PDA has an invalid owner or account layout",
      );
    }
    const configuredFundingTarget = Number(
      protocol.playerFundingTargetLamports,
    );
    if (
      !Number.isSafeInteger(configuredFundingTarget) ||
      configuredFundingTarget <= 0 ||
      configuredFundingTarget > PLAYER_FUNDING_TARGET_LAMPORTS
    ) {
      throw new Error("Protocol player funding target is invalid");
    }
    const fundingTopUp = Math.max(
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
    if (fundingTopUp > 0) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: current.publicKey,
          toPubkey: playerFunding,
          lamports: fundingTopUp,
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
      fundingTopUpLamports: fundingTopUp,
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
        const message = walletErrorMessage(cause);
        setError(message);
        throw new Error(message);
      }
    },
    [authorizeDeviceSession, connectWallet, refreshSession],
  );

  const disconnect = useCallback(async () => {
    const current = connectedRef.current;
    if (current) {
      clearOwnerState(current.publicKey);
      await disconnectWalletStandard(current.connector.wallet).catch(
        () => undefined,
      );
    }
    clearLastWallet();
    resetConnection(null, false);
  }, [clearOwnerState, resetConnection]);

  const requireSession = useCallback(() => {
    if (!session || sessionStatus !== "ready") {
      throw new Error(
        sessionStatus === "expired"
          ? "The zKube device session expired. Renew it before continuing."
          : sessionStatus === "needsRenewal"
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
      instructions: args.instructions,
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
  if (
    !current ||
    !current.publicKey.equals(expected.publicKey) ||
    current.connector.id !== expected.connector.id
  ) {
    throw new Error("The wallet account changed during session authorization");
  }
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
