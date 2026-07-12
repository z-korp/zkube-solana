import { useCallback, useEffect, useRef, useState } from "react";
import { useSolanaConnection } from "../connectionContext";
import { Keypair, type PublicKey } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "../constants";
import { fetchPaymasterClient, type PaymasterClient } from "./paymasterClient";
import { PersistedRunWatcher, type RunWatchStatus } from "./runWatcher";
import { SessionWallet } from "./sessionWallet";
import type { WalletLike } from "./sessionWallet";
import {
  buildApplyBonusPlan,
  buildCommitRunPlan,
  buildDelegateRunPlan,
  buildFinalizeRunPlan,
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
  fetchReceipt,
  recoverDelegatedRunSession,
  resolvePersistedRun,
  type ResumedRun,
  type RunReceiptView,
} from "./resumeRun";
import { getDelegationStatus } from "./router";
import {
  clearRunSession,
  loadRunSession,
  type RunSessionMarker,
} from "./runSessionStore";
import { deriveRunAddresses, type RunAddresses } from "./pdas";
import {
  buildCommitDailyRunPlan,
  buildPrepareDailyRunPlan,
  type DailyView,
} from "./dailyClient";
import { withTransientErRetry } from "./erRetry";
import { useEmbeddedIdentity } from "./embeddedIdentityContext";

export type SettleStage =
  | "sealing"
  | "committing"
  | "settling"
  | "consuming"
  | "cleaning"
  | "preparing";

export interface RebootRunState {
  activeRun: ActiveRunView | null;
  receipt: RunReceiptView | null;
  phase: ResumedRun["phase"];
  watchStatus: RunWatchStatus | null;
  busy: boolean;
  error: string | null;
  lastSignature: string | null;
  sessionAuthorized: boolean;
  settleStage: SettleStage | null;
}

/**
 * The public chain data needed by the base settlement tail. Deliberately
 * excludes the ephemeral session key and local marker metadata so a run can
 * still be finalized after browser storage is lost.
 */
export interface PublicRunSettlementDescriptor {
  owner: PublicKey;
  runId: bigint;
  addresses: RunAddresses;
  mode: "campaign" | "daily";
  dailyChallenge: PublicKey | null;
}

type BaseRunRecoveryView = Pick<
  ActiveRunView,
  "owner" | "runId" | "mode" | "lifecycle"
>;

/** Pure validation shared by the chain hook and focused recovery tests. */
export function validateBaseRunRecovery(args: {
  owner: PublicKey;
  runId: bigint | null | undefined;
  isDelegated: boolean;
  activeRun: BaseRunRecoveryView | null;
}): PublicRunSettlementDescriptor {
  const runId = requirePositiveRunId(args.runId);
  if (args.isDelegated) {
    throw new Error(
      `Run ${runId.toString()} is still delegated to MagicBlock and cannot be recovered on Solana base`,
    );
  }
  if (!args.activeRun) {
    throw new Error(
      `ActiveRun for run ${runId.toString()} is missing on Solana base`,
    );
  }
  if (!args.activeRun.owner.equals(args.owner)) {
    throw new Error("ActiveRun owner does not match the embedded Vault");
  }
  if (args.activeRun.runId !== runId) {
    throw new Error(
      `ActiveRun belongs to run ${args.activeRun.runId.toString()}, not requested run ${runId.toString()}`,
    );
  }
  if (args.activeRun.mode !== "campaign") {
    throw new Error(
      `ActiveRun mode ${args.activeRun.mode} cannot use campaign base-run recovery`,
    );
  }
  if (!isTerminal(args.activeRun.lifecycle)) {
    throw new Error(
      `ActiveRun lifecycle ${args.activeRun.lifecycle} is not terminal`,
    );
  }
  return {
    owner: args.owner,
    runId,
    addresses: deriveRunAddresses(args.owner, runId),
    mode: "campaign",
    dailyChallenge: null,
  };
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
    settleStage: null,
  });
  const currentRun = useRef<Extract<ResumedRun, { phase: "delegated" }> | null>(
    null,
  );
  const settleableRun = useRef<Extract<
    ResumedRun,
    { phase: "settleable" }
  > | null>(null);
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
        settleableRun.current = run.phase === "settleable" ? run : null;
        setState((value) => ({
          ...value,
          phase: run.phase,
          activeRun:
            run.phase === "delegated" ||
            run.phase === "base" ||
            run.phase === "settleable"
              ? run.activeRun
              : null,
          receipt: run.phase === "settled" ? run.receipt : null,
          sessionAuthorized:
            run.phase === "none" ? false : run.sessionAuthorized,
          error: value.phase === run.phase ? value.error : null,
        }));
      },
      onStatus: (watchStatus) =>
        setState((value) => ({ ...value, watchStatus })),
    });
    watcher.start();
    return () => void watcher.stop();
  }, [connection, epoch, publicKey, wallet]);

  const launchCampaignRun = useCallback(
    async (mapId: number, level: number) => {
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
    },
    [connection, publicKey, wallet],
  );

  const startCampaignRun = useCallback(
    async (mapId: number, level: number) => {
      return withBusy(setState, () => launchCampaignRun(mapId, level));
    },
    [launchCampaignRun],
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

  const setStage = useCallback(
    (settleStage: SettleStage | null) =>
      setState((value) => ({ ...value, settleStage })),
    [],
  );

  /**
   * Base-layer settlement tail: consume the receipt (signerless, sponsored
   * fee only) if the Magic Action didn't, then close the ActiveRun for rent
   * and clear the local marker. Shared by the normal pipeline and the
   * stuck-run recovery.
   */
  const finalizeBaseSettlement = useCallback(
    async (descriptor: PublicRunSettlementDescriptor) => {
      const sponsor =
        paymaster.current ?? (await fetchPaymasterClient(connection));
      paymaster.current = sponsor;
      const receipt = await fetchReceipt(
        connection,
        wallet,
        descriptor.addresses.runReceipt,
      );
      setStage(receipt?.consumed ? "cleaning" : "consuming");
      const finalizePlan = await buildFinalizeRunPlan({
        wallet,
        owner: descriptor.owner,
        runId: descriptor.runId,
        addresses: descriptor.addresses,
        mode: descriptor.mode,
        dailyChallenge: descriptor.dailyChallenge,
        receiptConsumed: Boolean(receipt?.consumed),
        connection,
        paymaster: sponsor.pubkey,
      });
      const signature = await submitSponsoredTransactionPlan({
        transactionPlan: finalizePlan,
        wallet,
        paymaster: sponsor,
      });
      await connection.confirmTransaction(signature, "confirmed");
      const marker = loadRunSession(publicKey);
      if (marker?.runId === descriptor.runId) clearRunSession(publicKey);
      if (currentRun.current?.marker.runId === descriptor.runId) {
        currentRun.current = null;
      }
      if (settleableRun.current?.marker.runId === descriptor.runId) {
        settleableRun.current = null;
      }
      return signature;
    },
    [connection, publicKey, setStage, wallet],
  );

  /**
   * Full auto-settle pipeline for the attached delegated run:
   * seal (session) → commit-and-undelegate (owner) → wait for the base
   * copyback → consume receipt if the Magic Action stalled → close for rent
   * → optionally launch the next campaign level. No manual settle button.
   */
  const settleAndAdvance = useCallback(
    async (next?: { mapId: number; level: number }) => {
      const run = currentRun.current;
      if (!run || !wallet) throw new Error("No delegated run is attached");
      actionInFlight.current = true;
      try {
        return await withBusy(setState, async () => {
          const sessionWallet = new SessionWallet(run.marker.session);
          setStage("sealing");
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
          setStage("committing");
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
          setStage("settling");
          const deadline = Date.now() + 90_000;
          while (Date.now() < deadline) {
            const status = await getDelegationStatus(
              run.marker.addresses.activeRun,
            );
            if (!status.isDelegated) break;
            await sleep(1_500);
          }
          await finalizeBaseSettlement(
            settlementDescriptor(run.marker, run.activeRun.dailyChallenge),
          );
          let activeRun: ActiveRunView | null = null;
          if (next) {
            setStage("preparing");
            activeRun = await launchCampaignRun(next.mapId, next.level);
          } else {
            setEpoch((value) => value + 1);
            setState((value) => ({
              ...value,
              phase: "none",
              activeRun: null,
              receipt: null,
              sessionAuthorized: false,
            }));
          }
          setStage(null);
          setState((value) => ({ ...value, lastSignature: signature }));
          return activeRun;
        });
      } finally {
        setStage(null);
        actionInFlight.current = false;
      }
    },
    [finalizeBaseSettlement, launchCampaignRun, setStage, wallet],
  );

  /**
   * Explicit recovery for an undelegated terminal run whose receipt was not
   * consumed by its Magic Action. Keeping this controller-driven prevents a
   * background watcher from erasing the result before the UI can snapshot it,
   * refresh progress, and route to the correct campaign/Daily destination.
   */
  const recoverSettlement = useCallback(async () => {
    const recovered = settleableRun.current;
    if (!recovered) throw new Error("No settleable run is attached");
    actionInFlight.current = true;
    try {
      return await withBusy(setState, async () => {
        await finalizeBaseSettlement(
          settlementDescriptor(
            recovered.marker,
            recovered.activeRun.dailyChallenge,
          ),
        );
        settleableRun.current = null;
        setEpoch((value) => value + 1);
        setState((value) => ({
          ...value,
          phase: "none",
          activeRun: null,
          receipt: null,
          sessionAuthorized: false,
          settleStage: null,
        }));
        return recovered.activeRun;
      });
    } finally {
      setStage(null);
      actionInFlight.current = false;
    }
  }, [finalizeBaseSettlement, setStage]);

  /**
   * Recover an undelegated terminal campaign ActiveRun using only its public run ID.
   * Every PDA is reconstructed from the current embedded owner, so this path
   * remains available when the local RunSessionMarker has been lost.
   */
  const recoverBaseRun = useCallback(
    async (runId: bigint): Promise<string> => {
      if (actionInFlight.current) {
        throw new Error("Another run action is already in progress");
      }
      actionInFlight.current = true;
      try {
        return await withBusy(setState, async () => {
          const validRunId = requirePositiveRunId(runId);
          if (!wallet.publicKey.equals(publicKey)) {
            throw new Error(
              "Embedded Vault identity changed before run recovery",
            );
          }
          requireNoAttachedRunSession({
            owner: publicKey,
            requestedRunId: validRunId,
            stored: loadRunSession(publicKey),
            active: currentRun.current?.marker ?? null,
            settleable: settleableRun.current?.marker ?? null,
          });
          const addresses = deriveRunAddresses(publicKey, validRunId);
          const delegation = await getDelegationStatus(addresses.activeRun);
          if (delegation.isDelegated) {
            // Run the same pure validator used after account hydration while
            // avoiding a misleading base-account lookup for delegated state.
            validateBaseRunRecovery({
              owner: publicKey,
              runId: validRunId,
              isDelegated: true,
              activeRun: null,
            });
          }
          const accountInfo = await connection.getAccountInfo(
            addresses.activeRun,
            "confirmed",
          );
          if (!accountInfo) {
            throw new Error(
              `ActiveRun for run ${validRunId.toString()} is missing on Solana base`,
            );
          }
          if (!accountInfo.owner.equals(ZKUBE_PROGRAM_ID)) {
            throw new Error(
              `ActiveRun account is not owned by the zKube program`,
            );
          }
          const activeRun = await fetchActiveRun(
            connection,
            wallet,
            addresses.activeRun,
          );
          const descriptor = validateBaseRunRecovery({
            owner: publicKey,
            runId: validRunId,
            isDelegated: false,
            activeRun,
          });
          requireNoAttachedRunSession({
            owner: publicKey,
            requestedRunId: validRunId,
            stored: loadRunSession(publicKey),
            active: currentRun.current?.marker ?? null,
            settleable: settleableRun.current?.marker ?? null,
          });
          const signature = await finalizeBaseSettlement(descriptor);
          setEpoch((value) => value + 1);
          setState((value) => ({
            ...value,
            phase: "none",
            activeRun: null,
            receipt: null,
            lastSignature: signature,
            sessionAuthorized: false,
            settleStage: null,
          }));
          return signature;
        });
      } finally {
        setStage(null);
        actionInFlight.current = false;
      }
    },
    [connection, finalizeBaseSettlement, publicKey, setStage, wallet],
  );

  /** Local escape hatch: forget the stuck marker without touching chain
   *  accounts (they stay recoverable later). */
  const dismissRun = useCallback(() => {
    clearRunSession(publicKey);
    currentRun.current = null;
    settleableRun.current = null;
    setEpoch((value) => value + 1);
    setState((value) => ({
      ...value,
      phase: "none",
      activeRun: null,
      receipt: null,
      error: null,
      settleStage: null,
      sessionAuthorized: false,
    }));
  }, [publicKey]);

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
      const signature = await finalizeBaseSettlement(
        settlementDescriptor(marker, null),
      );
      settleableRun.current = null;
      setEpoch((value) => value + 1);
      setState((value) => ({
        ...value,
        phase: "none",
        activeRun: null,
        receipt: null,
        lastSignature: signature,
        settleStage: null,
        sessionAuthorized: false,
      }));
      return signature;
    });
  }, [finalizeBaseSettlement, publicKey]);

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
    settleAndAdvance,
    recoverSettlement,
    recoverBaseRun,
    dismissRun,
    cleanup,
    recoverSession,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function requirePositiveRunId(runId: bigint | null | undefined): bigint {
  if (typeof runId !== "bigint" || runId <= 0n) {
    throw new Error("A positive run ID is required for base-run recovery");
  }
  return runId;
}

export function requireNoAttachedRunSession(args: {
  owner: PublicKey;
  requestedRunId: bigint;
  stored: Pick<RunSessionMarker, "runId"> | null;
  active: Pick<RunSessionMarker, "runId"> | null;
  settleable: Pick<RunSessionMarker, "runId"> | null;
}): void {
  const attached = args.stored ?? args.active ?? args.settleable;
  if (!attached) return;
  throw new Error(
    `Vault ${args.owner.toBase58()} already has local run ${attached.runId.toString()} attached; leave recovery mode and resume or forget it before recovering run ${args.requestedRunId.toString()}`,
  );
}

function settlementDescriptor(
  marker: RunSessionMarker,
  dailyChallenge: PublicKey | null,
): PublicRunSettlementDescriptor {
  return {
    owner: marker.owner,
    runId: marker.runId,
    addresses: marker.addresses,
    mode: marker.mode,
    dailyChallenge,
  };
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
