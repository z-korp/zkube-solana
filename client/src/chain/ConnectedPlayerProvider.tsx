import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import {
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  type PublicKey,
} from "@solana/web3.js";

import {
  connectWalletStandard,
  disconnectWalletStandard,
  discoverWalletConnectors,
  subscribeWalletAccounts,
  walletRegistry,
  type WalletConnector,
} from "@/platform/walletStandard";
import { CANONICAL_DEVNET_USDC_MINT, ZKUBE_PROGRAM_ID } from "./constants";
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
import { fetchPaymasterClient } from "./paymasterClient";
import { clearRunSession } from "./runSessionStore";
import {
  buildCreateSessionV2Instruction,
  decodeSessionTokenV2Account,
  deriveSessionTokenV2Pda,
} from "./sessionV2";
import type { WalletLike } from "./sessionWallet";
import { createReadOnlyWallet } from "./readOnlyWallet";

const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60 - 5 * 60;
const SESSION_READY_SKEW_SECONDS = 60;

interface ConnectedWalletState {
  connector: WalletConnector;
  publicKey: PublicKey;
  wallet: WalletLike;
}

type SessionRefreshResult = "ready" | "missing" | "expired" | "unavailable";

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
  const [usdcBaseUnits, setUsdcBaseUnits] = useState<bigint | null>(null);
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
      setUsdcBaseUnits(null);
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
      setUsdcBaseUnits(null);
      return;
    }
    setBalanceLoading(true);
    try {
      const ata = getAssociatedTokenAddressSync(
        CANONICAL_DEVNET_USDC_MINT,
        owner,
        false,
        TOKEN_PROGRAM_ID,
      );
      const [lamports, tokenInfo] = await Promise.all([
        connection.getBalance(owner, "confirmed"),
        connection.getAccountInfo(ata, "confirmed"),
      ]);
      const token = tokenInfo ? unpackAccount(ata, tokenInfo, TOKEN_PROGRAM_ID) : null;
      if (
        token &&
        (!token.owner.equals(owner) ||
          !token.mint.equals(CANONICAL_DEVNET_USDC_MINT))
      ) {
        throw new Error("Connected wallet USDC account identity is invalid");
      }
      setBalanceLamports(lamports);
      setUsdcBaseUnits(token?.amount ?? 0n);
    } catch (cause) {
      setBalanceLamports(null);
      setUsdcBaseUnits(null);
      setError(errorMessage(cause));
    } finally {
      setBalanceLoading(false);
    }
  }, [connection]);

  const refreshSession = useCallback(
    async (owner: PublicKey): Promise<SessionRefreshResult> => {
      const stored = loadDeviceSession(owner);
      if (!stored) {
        setSession(null);
        setSessionStatus("missing");
        return "missing";
      }
      setSession(stored);
      setSessionStatus("checking");
      let info;
      try {
        info = await connection.getAccountInfo(
          stored.sessionToken,
          "confirmed",
        );
      } catch (cause) {
        setError(
          `Solana Devnet unavailable; the local session was retained. ${errorMessage(cause)}`,
        );
        return "unavailable";
      }
      try {
        if (!info) throw new Error("Stored device session does not exist on Devnet");
        const token = decodeSessionTokenV2Account(stored.sessionToken, info);
        if (
          !token.authority.equals(owner) ||
          !token.sessionSigner.equals(stored.signer.publicKey) ||
          !token.targetProgram.equals(ZKUBE_PROGRAM_ID) ||
          token.validUntil !== stored.validUntil
        ) {
          throw new Error("Stored device session does not match the connected wallet");
        }
        let paymaster: Awaited<ReturnType<typeof fetchPaymasterClient>> | null = null;
        try {
          paymaster = await fetchPaymasterClient(connection);
        } catch (cause) {
          setError(`Paymaster unavailable; the local session was retained. ${errorMessage(cause)}`);
        }
        if (paymaster && !token.feePayer.equals(paymaster.pubkey)) {
          throw new Error("Stored device session belongs to a different paymaster");
        }
        const now = Math.floor(Date.now() / 1_000);
        const result =
          token.validUntil - now > SESSION_READY_SKEW_SECONDS
            ? "ready"
            : "expired";
        setSessionStatus(result);
        return result;
      } catch (cause) {
        clearDeviceSession(owner);
        setSession(null);
        setSessionStatus("missing");
        setError(errorMessage(cause));
        return "missing";
      }
    },
    [connection],
  );

  const connectWallet = useCallback(
    async (connectorId: string): Promise<SessionRefreshResult> => {
      const connector = connectors.find((candidate) => candidate.id === connectorId);
      if (!connector) throw new Error("The selected wallet is no longer available");
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
        resetConnection(errorMessage(cause), false);
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
        await Promise.all([
          refreshSession(next.publicKey),
          refreshBalance(),
        ]);
      } catch {
        // Silent restore is best-effort; the gate stays one tap away.
        if (!connectedRef.current) setConnectionStatus("disconnected");
      }
    })();
  }, [connectors, refreshBalance, refreshSession]);

  const authorizeDeviceSession = useCallback(async () => {
    const current = connectedRef.current;
    if (!current) throw new Error("Connect a Solana wallet before enabling zKube");
    assertDeviceSessionStorageAvailable();
    const paymaster = await fetchPaymasterClient(connection);
    const signer = Keypair.generate();
    const now = Math.floor(Date.now() / 1_000);
    const validUntil = now + SESSION_LIFETIME_SECONDS;
    const { sessionToken } = deriveSessionTokenV2Pda({
      authority: current.publicKey,
      sessionSigner: signer.publicKey,
    });
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: paymaster.pubkey,
        recentBlockhash: blockhash,
        instructions: [
          buildCreateSessionV2Instruction({
            authority: current.publicKey,
            sessionSigner: signer.publicKey,
            feePayer: paymaster.pubkey,
            targetProgram: ZKUBE_PROGRAM_ID,
            topUp: false,
            validUntil,
          }),
        ],
      }).compileToV0Message(),
    );
    transaction.sign([signer]);
    const simulation = await connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: false,
    });
    if (simulation.value.err) {
      throw new Error(
        `Enable zKube simulation failed: ${JSON.stringify(simulation.value.err)}`,
      );
    }
    const signed = await current.wallet.signTransaction(transaction);
    const stillConnected = connectedRef.current;
    if (
      !stillConnected ||
      !stillConnected.publicKey.equals(current.publicKey) ||
      stillConnected.connector.id !== current.connector.id
    ) {
      throw new Error("The wallet account changed before zKube was enabled");
    }
    const signature = await paymaster.submit(signed.serialize());
    const confirmation = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (confirmation.value.err) throw new Error("Enable zKube was not confirmed");
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
        const message = errorMessage(cause);
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
          : "Enable zKube before changing player state.",
      );
    }
    const current = connectedRef.current;
    if (!current) throw new Error("The connected wallet account changed");
    return requireCurrentDeviceSession(session, current.publicKey);
  }, [session, sessionStatus]);

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
      usdcBaseUnits,
      balanceLoading,
      error,
      connectAndEnable,
      enable: authorizeDeviceSession,
      renew: authorizeDeviceSession,
      disconnect,
      refreshBalance,
      requireSession,
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
      session,
      sessionStatus,
      usdcBaseUnits,
    ],
  );

  return (
    <ConnectedPlayerContext.Provider value={value}>
      {children}
    </ConnectedPlayerContext.Provider>
  );
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && /reject|declin|cancel/i.test(cause.message)) {
    return "The wallet rejected the request.";
  }
  return cause instanceof Error ? cause.message : String(cause);
}
