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
} from "@solana/web3.js";

import {
  connectWalletStandard,
  disconnectWalletStandard,
  discoverWalletConnectors,
  subscribeWalletAccounts,
  walletRegistry,
  type WalletConnector,
} from "@/platform/walletStandard";
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
  deriveCampaignProgressPda,
  derivePlayerFundingPda,
  derivePlayerProfilePda,
} from "./pdas";
import { zkubeProgram } from "./runPlan";

const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60 - 5 * 60;
const SESSION_READY_SKEW_SECONDS = 60;
const DEVICE_FEE_ALLOWANCE_LAMPORTS = 1_000_000;
export const PLAYER_FUNDING_TARGET_LAMPORTS = 35_000_000;
const LEGACY_PLAYER_FUNDING_BYTES = 42;
const LEGACY_PLAYER_FUNDING_DISCRIMINATOR = Uint8Array.from([
  61, 237, 220, 223, 77, 198, 8, 22,
]);

interface ConnectedWalletState {
  connector: WalletConnector;
  publicKey: PublicKey;
  wallet: WalletLike;
}

type SessionRefreshResult = "ready" | "missing" | "expired" | "unavailable";

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
      let fundingInfo;
      try {
        [info, fundingInfo] = await connection.getMultipleAccountsInfo(
          [stored.sessionToken, derivePlayerFundingPda(owner)],
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
        if (!token.feePayer.equals(owner)) {
          throw new Error("Stored device session was created by a different owner payer");
        }
        if (!isNormalizedPlayerFunding(fundingInfo)) {
          // A live legacy session cannot use the new rent wrappers. Keep the
          // old local record only until the immediately-following Enable flow
          // replaces it with a migrated, freshly authorized session.
          setSession(null);
          setSessionStatus("missing");
          return "missing";
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
    const signer = Keypair.generate();
    const now = Math.floor(Date.now() / 1_000);
    const validUntil = now + SESSION_LIFETIME_SECONDS;
    const { sessionToken } = deriveSessionTokenV2Pda({
      authority: current.publicKey,
      sessionSigner: signer.publicKey,
    });
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    const program = zkubeProgram(connection, current.wallet);
    const playerProfile = derivePlayerProfilePda(current.publicKey);
    const playerFunding = derivePlayerFundingPda(current.publicKey);
    const campaignProgress = deriveCampaignProgressPda(current.publicKey);
    const [profileInfo, campaignInfo, fundingInfo] = await Promise.all([
      connection.getAccountInfo(playerProfile, "confirmed"),
      connection.getAccountInfo(campaignProgress, "confirmed"),
      connection.getAccountInfo(playerFunding, "confirmed"),
    ]);
    if (profileInfo) {
      if (
        !profileInfo.owner.equals(ZKUBE_PROGRAM_ID) ||
        profileInfo.executable ||
        profileInfo.data.length !== program.account.playerProfile.size
      ) {
        throw new Error("PlayerProfile has an invalid owner or account layout");
      }
      const profile = await program.account.playerProfile.fetch(playerProfile);
      if (!profile.owner.equals(current.publicKey)) {
        throw new Error("PlayerProfile belongs to a different wallet");
      }
    }
    if (Boolean(profileInfo) !== Boolean(campaignInfo)) {
      throw new Error(
        "Devnet player initialization is incomplete; the program release must be reset.",
      );
    }
    if (campaignInfo) {
      if (
        !campaignInfo.owner.equals(ZKUBE_PROGRAM_ID) ||
        campaignInfo.executable ||
        campaignInfo.data.length !== program.account.campaignProgress.size
      ) {
        throw new Error("CampaignProgress has an invalid owner or account layout");
      }
      const campaign = await program.account.campaignProgress.fetch(campaignProgress);
      if (!campaign.owner.equals(current.publicKey)) {
        throw new Error("CampaignProgress belongs to a different wallet");
      }
    }
    if (
      fundingInfo &&
      !isNormalizedPlayerFunding(fundingInfo) &&
      !isLegacyPlayerFunding(fundingInfo, current.publicKey)
    ) {
      throw new Error("Player funding PDA has an invalid owner or account layout");
    }
    const fundingTopUp = Math.max(
      0,
      PLAYER_FUNDING_TARGET_LAMPORTS - (fundingInfo?.lamports ?? 0),
    );
    const instructions = [
      await program.methods
        .initializePlayer()
        .accountsPartial({
          playerProfile,
          campaignProgress,
          playerFunding,
          payer: current.publicKey,
          ownerAuthority: current.publicKey,
          sessionToken: null,
          actor: current.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    ];
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
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: current.publicKey,
        recentBlockhash: blockhash,
        instructions,
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
    const signature = await connection.sendRawTransaction(signed.serialize(), {
      maxRetries: 5,
      skipPreflight: false,
    });
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

function isNormalizedPlayerFunding(
  info: AccountInfo<Buffer> | null,
): boolean {
  return Boolean(
    info &&
      !info.executable &&
      info.owner.equals(SystemProgram.programId) &&
      info.data.length === 0,
  );
}

function isLegacyPlayerFunding(
  info: AccountInfo<Buffer>,
  owner: PublicKey,
): boolean {
  if (
    info.executable ||
    !info.owner.equals(ZKUBE_PROGRAM_ID) ||
    info.data.length !== LEGACY_PLAYER_FUNDING_BYTES ||
    !LEGACY_PLAYER_FUNDING_DISCRIMINATOR.every(
      (byte, index) => info.data[index] === byte,
    ) ||
    info.data[8] !== 1 ||
    !new PublicKey(info.data.subarray(9, 41)).equals(owner)
  ) {
    return false;
  }
  const [, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("player_funding"), owner.toBuffer()],
    ZKUBE_PROGRAM_ID,
  );
  return info.data[41] === bump;
}
