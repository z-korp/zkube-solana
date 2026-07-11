import { useCallback, useEffect, useRef, useState } from "react";
import { useSolanaConnection } from "../connectionContext";
import { Keypair } from "@solana/web3.js";
import { fetchPaymasterClient, type PaymasterClient } from "./paymasterClient";
import { PersistedRunWatcher, type RunWatchStatus } from "./runWatcher";
import { SessionWallet } from "./sessionWallet";
import type { WalletLike } from "./sessionWallet";
import {
  buildCloseSettledRunPlan,
  buildApplyBonusPlan,
  buildCommitRunPlan,
  buildDelegateRunPlan,
  buildPlayMovePlan,
  buildPrepareCampaignRunPlan,
  buildRequestRowPlan,
  buildSealRunPlan,
  fetchActiveRun,
  resolveRunErConnection,
  submitPreparedRunPlan,
  submitSponsoredTransactionPlan,
  submitWalletTransactionPlan,
  type ActiveRunView,
  type PreparedRunPlan,
} from "./runPlan";
import {
  recoverDelegatedRunSession,
  resolvePersistedRun,
  type ResumedRun,
  type RunReceiptView,
} from "./resumeRun";
import { clearRunSession, loadRunSession } from "./runSessionStore";
import {
  buildCommitDailyRunPlan,
  buildPrepareDailyRunPlan,
  type DailyView,
} from "./dailyClient";
import { withTransientErRetry } from "./erRetry";
import { useEmbeddedIdentity } from "./embeddedIdentityContext";

export interface RebootRunState {
  activeRun: ActiveRunView | null;
  receipt: RunReceiptView | null;
  phase: ResumedRun["phase"];
  watchStatus: RunWatchStatus | null;
  busy: boolean;
  error: string | null;
  lastSignature: string | null;
  sessionAuthorized: boolean;
}

export function useRebootRun() {
  const { connection } = useSolanaConnection();
  const { publicKey, wallet } = useEmbeddedIdentity();
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<RebootRunState>({
    activeRun: null,
    receipt: null,
    phase: "none",
    watchStatus: null,
    busy: false,
    error: null,
    lastSignature: null,
    sessionAuthorized: false,
  });
  const currentRun = useRef<Extract<ResumedRun, { phase: "delegated" }> | null>(
    null,
  );
  const paymaster = useRef<PaymasterClient | null>(null);
  // While a move/bonus is in flight the action itself is the authoritative
  // state source; watcher snapshots taken mid-action (awaitingVrf, stale
  // counters) must not clobber currentRun or reach the board.
  const actionInFlight = useRef(false);

  useEffect(() => {
    paymaster.current = null;
  }, [connection.rpcEndpoint]);

  useEffect(() => {
    const watcher = new PersistedRunWatcher({
      resolve: () =>
        resolvePersistedRun({
          owner: publicKey,
          wallet,
          baseConnection: connection,
        }),
      onState: (run) => {
        if (actionInFlight.current) return;
        if (
          run.phase === "delegated" &&
          currentRun.current &&
          run.activeRun.runId === currentRun.current.activeRun.runId &&
          run.activeRun.actionCounter <
            currentRun.current.activeRun.actionCounter
        ) {
          return;
        }
        currentRun.current = run.phase === "delegated" ? run : null;
        setState((value) => ({
          ...value,
          phase: run.phase,
          activeRun:
            run.phase === "delegated" || run.phase === "base"
              ? run.activeRun
              : null,
          receipt: run.phase === "settled" ? run.receipt : null,
          sessionAuthorized:
            run.phase === "none" ? false : run.sessionAuthorized,
          error: null,
        }));
      },
      onStatus: (watchStatus) =>
        setState((value) => ({ ...value, watchStatus })),
    });
    watcher.start();
    return () => void watcher.stop();
  }, [connection, epoch, publicKey, wallet]);

  const startCampaignRun = useCallback(
    async (mapId: number, level: number) => {
      return withBusy(setState, async () => {
        const sponsor =
          paymaster.current ?? (await fetchPaymasterClient(connection));
        paymaster.current = sponsor;
        const session = Keypair.generate();
        const prepared = await buildPrepareCampaignRunPlan({
          wallet,
          session,
          mapId,
          level,
          connection,
          paymaster: sponsor.pubkey,
        });
        const prepareSignature = await submitPreparedRunPlan({
          preparedRun: prepared,
          wallet,
          paymaster: sponsor,
          session,
        });
        const delegate = await buildDelegateRunPlan({
          wallet,
          addresses: prepared.addresses,
          connection,
          paymaster: sponsor.pubkey,
        });
        const delegateSignature = await submitSponsoredTransactionPlan({
          transactionPlan: delegate,
          wallet,
          paymaster: sponsor,
        });
        await connection.confirmTransaction(delegateSignature, "confirmed");
        const erConnection = await resolveRunErConnection(
          prepared.addresses.activeRun,
        );
        const activeRun = await hydrateRows({
          prepared,
          session,
          erConnection,
          ownerWallet: wallet,
        });
        currentRun.current = {
          phase: "delegated",
          marker: loadRunSession(publicKey)!,
          activeRun,
          connection: erConnection,
          sessionAuthorized: true,
        };
        setEpoch((value) => value + 1);
        setState((value) => ({
          ...value,
          phase: "delegated",
          activeRun,
          receipt: null,
          lastSignature: delegateSignature || prepareSignature,
          sessionAuthorized: true,
        }));
        return activeRun;
      });
    },
    [connection, publicKey, wallet],
  );

  const startDailyRun = useCallback(
    async (daily: DailyView, payment: "stars" | "usdc") => {
      return withBusy(setState, async () => {
        const sponsor =
          paymaster.current ?? (await fetchPaymasterClient(connection));
        paymaster.current = sponsor;
        const session = Keypair.generate();
        const prepared = await buildPrepareDailyRunPlan({
          wallet,
          session,
          daily,
          payment,
          connection,
          paymaster: sponsor.pubkey,
        });
        const prepareSignature = await submitPreparedRunPlan({
          preparedRun: prepared,
          wallet,
          paymaster: sponsor,
          session,
          mode: "daily",
        });
        const delegate = await buildDelegateRunPlan({
          wallet,
          addresses: prepared.addresses,
          connection,
          paymaster: sponsor.pubkey,
        });
        const delegateSignature = await submitSponsoredTransactionPlan({
          transactionPlan: delegate,
          wallet,
          paymaster: sponsor,
        });
        await connection.confirmTransaction(delegateSignature, "confirmed");
        const erConnection = await resolveRunErConnection(
          prepared.addresses.activeRun,
        );
        const activeRun = await hydrateRows({
          prepared,
          session,
          erConnection,
          ownerWallet: wallet,
        });
        currentRun.current = {
          phase: "delegated",
          marker: loadRunSession(publicKey)!,
          activeRun,
          connection: erConnection,
          sessionAuthorized: true,
        };
        setEpoch((value) => value + 1);
        setState((value) => ({
          ...value,
          phase: "delegated",
          activeRun,
          receipt: null,
          lastSignature: delegateSignature || prepareSignature,
          sessionAuthorized: true,
        }));
        return activeRun;
      });
    },
    [connection, publicKey, wallet],
  );

  const playMove = useCallback(
    async (row: number, start: number, destination: number) => {
      const run = currentRun.current;
      if (!run) throw new Error("No delegated run is attached");
      actionInFlight.current = true;
      try {
        return await withBusy(setState, async () => {
          const sessionWallet = new SessionWallet(run.marker.session);
          const plan = await buildPlayMovePlan({
            owner: run.marker.owner,
            sessionWallet,
            sessionToken: run.marker.sessionToken,
            activeRun: run.marker.addresses.activeRun,
            erConnection: run.connection,
            expectedMove: run.activeRun.moves,
            expectedAction: run.activeRun.actionCounter,
            row,
            start,
            destination,
          });
          const signature = await submitWalletTransactionPlan({
            transactionPlan: plan,
            wallet: sessionWallet,
          });
          const activeRun = await hydrateRows({
            prepared: {
              runId: run.marker.runId,
              addresses: run.marker.addresses,
              sessionToken: run.marker.sessionToken,
              sessionValidUntil: run.marker.validUntil,
              transactionPlan: plan,
            },
            session: run.marker.session,
            erConnection: run.connection,
            ownerWallet: wallet!,
          });
          run.activeRun = activeRun;
          setState((value) => ({
            ...value,
            activeRun,
            lastSignature: signature,
          }));
          return activeRun;
        });
      } finally {
        actionInFlight.current = false;
      }
    },
    [wallet],
  );

  const settle = useCallback(async () => {
    const run = currentRun.current;
    if (!run || !wallet) throw new Error("No delegated run is attached");
    return withBusy(setState, async () => {
      const sessionWallet = new SessionWallet(run.marker.session);
      const seal = await buildSealRunPlan({
        owner: run.marker.owner,
        sessionWallet,
        sessionToken: run.marker.sessionToken,
        activeRun: run.marker.addresses.activeRun,
        erConnection: run.connection,
      });
      await submitWalletTransactionPlan({
        transactionPlan: seal,
        wallet: sessionWallet,
      });
      const commit =
        run.marker.mode === "daily"
          ? await buildCommitDailyRunPlan({
              owner: run.marker.owner,
              payerWallet: wallet,
              addresses: run.marker.addresses,
              dailyChallenge: run.activeRun.dailyChallenge,
              erConnection: run.connection,
            })
          : await buildCommitRunPlan({
              owner: run.marker.owner,
              payerWallet: wallet,
              addresses: run.marker.addresses,
              erConnection: run.connection,
            });
      const signature = await submitWalletTransactionPlan({
        transactionPlan: commit,
        wallet,
      });
      setState((value) => ({ ...value, lastSignature: signature }));
      setEpoch((value) => value + 1);
      return signature;
    });
  }, [wallet]);

  const applyBonus = useCallback(async (row: number, column: number) => {
    const run = currentRun.current;
    if (!run) throw new Error("No delegated run is attached");
    actionInFlight.current = true;
    try {
      return await withBusy(setState, async () => {
        const sessionWallet = new SessionWallet(run.marker.session);
        const plan = await buildApplyBonusPlan({
          owner: run.marker.owner,
          sessionWallet,
          sessionToken: run.marker.sessionToken,
          activeRun: run.marker.addresses.activeRun,
          erConnection: run.connection,
          expectedAction: run.activeRun.actionCounter,
          row,
          column,
        });
        const signature = await submitWalletTransactionPlan({
          transactionPlan: plan,
          wallet: sessionWallet,
        });
        const activeRun = await fetchActiveRun(
          run.connection,
          sessionWallet,
          run.marker.addresses.activeRun,
        );
        if (!activeRun)
          throw new Error("ActiveRun disappeared after bonus application");
        run.activeRun = activeRun;
        setState((value) => ({
          ...value,
          activeRun,
          lastSignature: signature,
        }));
        return activeRun;
      });
    } finally {
      actionInFlight.current = false;
    }
  }, []);

  const cleanup = useCallback(async () => {
    const marker = loadRunSession(publicKey);
    if (!marker) return null;
    return withBusy(setState, async () => {
      const sponsor =
        paymaster.current ?? (await fetchPaymasterClient(connection));
      paymaster.current = sponsor;
      const plan = await buildCloseSettledRunPlan({
        wallet,
        runId: marker.runId,
        addresses: marker.addresses,
        connection,
        paymaster: sponsor.pubkey,
      });
      const signature = await submitSponsoredTransactionPlan({
        transactionPlan: plan,
        wallet,
        paymaster: sponsor,
      });
      await connection.confirmTransaction(signature, "confirmed");
      clearRunSession(publicKey);
      currentRun.current = null;
      setEpoch((value) => value + 1);
      setState((value) => ({
        ...value,
        phase: "none",
        activeRun: null,
        receipt: null,
        lastSignature: signature,
        sessionAuthorized: false,
      }));
      return signature;
    });
  }, [connection, publicKey, wallet]);

  const recoverSession = useCallback(async () => {
    const run = currentRun.current;
    if (!run || !wallet) throw new Error("No delegated run is attached");
    return withBusy(setState, async () => {
      const sponsor =
        paymaster.current ?? (await fetchPaymasterClient(connection));
      paymaster.current = sponsor;
      const marker = await recoverDelegatedRunSession({
        run,
        wallet,
        paymaster: sponsor,
      });
      run.marker = marker;
      run.sessionAuthorized = true;
      setEpoch((value) => value + 1);
      setState((value) => ({ ...value, sessionAuthorized: true }));
      return marker;
    });
  }, [connection, wallet]);

  return {
    ...state,
    connected: true,
    publicKey,
    startCampaignRun,
    startDailyRun,
    playMove,
    applyBonus,
    settle,
    cleanup,
    recoverSession,
  };
}

async function hydrateRows(args: {
  prepared: PreparedRunPlan;
  session: Keypair;
  erConnection: import("@solana/web3.js").Connection;
  ownerWallet: WalletLike;
}): Promise<ActiveRunView> {
  const sessionWallet = new SessionWallet(args.session);
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const active = await fetchActiveRun(
      args.erConnection,
      sessionWallet,
      args.prepared.addresses.activeRun,
    );
    if (!active)
      throw new Error("Delegated ActiveRun is missing from the resolved ER");
    if (active.lifecycle === "playing" || isTerminal(active.lifecycle))
      return active;
    if (active.pendingVrfCounter === 0) {
      await withTransientErRetry(async () => {
        const request = await buildRequestRowPlan({
          owner: args.ownerWallet.publicKey,
          sessionWallet,
          sessionToken: args.prepared.sessionToken,
          activeRun: args.prepared.addresses.activeRun,
          erConnection: args.erConnection,
        });
        return submitWalletTransactionPlan({
          transactionPlan: request,
          wallet: sessionWallet,
        });
      });
    }
    await waitForVrf(
      args.erConnection,
      sessionWallet,
      args.prepared.addresses.activeRun,
    );
  }
  throw new Error("VRF initialization exceeded the configured row budget");
}

async function waitForVrf(
  connection: import("@solana/web3.js").Connection,
  wallet: WalletLike,
  activeRunAddress: import("@solana/web3.js").PublicKey,
): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const active = await fetchActiveRun(connection, wallet, activeRunAddress);
    if (active && active.pendingVrfCounter === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the MagicBlock VRF callback");
}

function isTerminal(lifecycle: string): boolean {
  return (
    lifecycle === "levelComplete" ||
    lifecycle === "finished" ||
    lifecycle === "settled"
  );
}

async function withBusy<T>(
  setState: React.Dispatch<React.SetStateAction<RebootRunState>>,
  action: () => Promise<T>,
): Promise<T> {
  setState((value) => ({ ...value, busy: true, error: null }));
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setState((value) => ({ ...value, error: message }));
    throw error;
  } finally {
    setState((value) => ({ ...value, busy: false }));
  }
}
