import { useCallback, useEffect, useRef, useState } from "react";
import { useSolanaConnection } from "./connectionContext";
import { Keypair, type PublicKey } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "./constants";
import { PersistedRunWatcher, type RunWatchStatus } from "./runWatcher";
import { SessionWallet } from "./sessionWallet";
import type { WalletLike } from "./sessionWallet";
import {
  buildApplyBonusPlan,
  buildCommitRunPlan,
  buildDelegateRunPlan,
  buildAbandonRunPlan,
  buildFinalizeRunPlan,
  buildPlayMovePlan,
  buildPrepareCampaignRunPlan,
  buildRequestRowPlan,
  buildSealRunPlan,
  fetchActiveRun,
  resolveRunErConnection,
  submitPreparedRunPlan,
  submitVersionedTransactionPlan,
  submitWalletTransactionPlan,
  type ActiveRunView,
  type PreparedRunPlan,
} from "./runPlan";
import {
  fetchReceipt,
  resolvePersistedRun,
  type ResumedRun,
  type RunReceiptView,
} from "./resumeRun";
import { getDelegationStatus } from "./router";
import {
  clearRunSession,
  loadRunSession,
  saveRunSession,
  type RunSessionMarker,
} from "./runSessionStore";
import { loadDeviceSession } from "./deviceSessionStore";
import { deriveRunAddresses, type RunAddresses } from "./pdas";
import {
  buildCommitDailyRunPlan,
  buildPrepareDailyRunPlan,
  type DailyView,
} from "./dailyClient";
import { withTransientErRetry } from "./erRetry";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { awaitAccountCondition } from "./awaitAccountCondition";
import { createChainTraceId, emitChainMetric, type ChainMetricLayer } from "./telemetry";

const plog = (
  traceId: string,
  label: string,
  layer: ChainMetricLayer,
  data: Record<string, unknown>,
): void => {
  const phases = label.split(":");
  emitChainMetric({
    traceId,
    operation: label,
    layer,
    phase: phases[phases.length - 1] ?? label,
    ok: true,
    ...data,
  });
};

const plogFailure = (
  traceId: string,
  label: string,
  layer: ChainMetricLayer,
  error: unknown,
  data: Record<string, unknown> = {},
): void => {
  const phases = label.split(":");
  emitChainMetric({
    traceId,
    operation: label,
    layer,
    phase: phases[phases.length - 1] ?? label,
    ok: false,
    error:
      (error instanceof Error ? error.message : String(error)).slice(0, 200),
    ...data,
  });
};

export type SettleStage =
  | "abandoning"
  | "sealing"
  | "committing"
  | "settling"
  | "consuming"
  | "cleaning"
  | "preparing";

export interface RunControllerState {
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
  dailyVersion?: 1 | 2;
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
    throw new Error("ActiveRun owner does not match the connected wallet");
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

export function useRunController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const { publicKey, wallet, readOnlyWallet } = player;
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<RunControllerState>({
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
  // While a move/bonus is in flight the action itself is the authoritative
  // state source; watcher snapshots taken mid-action (awaitingVrf, stale
  // counters) must not clobber currentRun or reach the board.
  const actionInFlight = useRef(false);
  const telemetryTrace = useRef(createChainTraceId());
  useEffect(() => {
    if (!publicKey || !wallet) {
      currentRun.current = null;
      settleableRun.current = null;
      setState((value) => ({
        ...value,
        phase: "none",
        activeRun: null,
        receipt: null,
        sessionAuthorized: false,
      }));
      return;
    }
    const watcher = new PersistedRunWatcher({
      resolve: () =>
        resolvePersistedRun({
          owner: publicKey,
          wallet: readOnlyWallet,
          baseConnection: connection,
          deviceSession: player.session,
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
  }, [connection, epoch, player.session, publicKey, readOnlyWallet, wallet]);

  useEffect(() => {
    if (!publicKey || player.sessionStatus !== "ready") return;
    const device = player.session;
    if (!device || !device.owner.equals(publicKey)) return;
    const marker = loadRunSession(publicKey);
    if (!marker || marker.session.publicKey.equals(device.signer.publicKey)) return;
    saveRunSession({
      ...marker,
      session: device.signer,
      sessionToken: device.sessionToken,
      validUntil: device.validUntil,
    });
    if (currentRun.current?.marker.runId === marker.runId) {
      currentRun.current.marker = {
        ...marker,
        session: device.signer,
        sessionToken: device.sessionToken,
        validUntil: device.validUntil,
      };
      currentRun.current.sessionAuthorized = true;
    }
    setEpoch((value) => value + 1);
  }, [player.session, player.sessionStatus, publicKey]);

  const launchCampaignRun = useCallback(
    async (mapId: number, level: number) => {
      if (!wallet || !publicKey) {
        throw new Error("Connect a wallet before starting a run");
      }
      const device = player.requireSession();
      const session = device.signer;
      const sessionWallet = new SessionWallet(session);
      telemetryTrace.current = createChainTraceId();
      const traceId = telemetryTrace.current;
      const launchStart = Date.now();
      let mark = launchStart;
      const lap = (
        label: string,
        layer: ChainMetricLayer = "solana-base",
        data: Record<string, unknown> = {},
      ) => {
        const now = Date.now();
        plog(traceId, `launch:${label}`, layer, {
          durationMs: now - mark,
          ...data,
        });
        mark = now;
      };
      const prepared = await buildPrepareCampaignRunPlan({
        wallet: sessionWallet,
        ownerAuthority: publicKey,
        sessionToken: device.sessionToken,
        mapId,
        level,
        connection,
        sessionValidUntil: device.validUntil,
      });
      const prepareSignature = await submitPreparedRunPlan({
        preparedRun: prepared,
        owner: publicKey,
        wallet: sessionWallet,
        sessionSigner: session,
      });
      lap("prepare", "solana-base", { signature: prepareSignature });
      const delegate = await buildDelegateRunPlan({
        wallet: sessionWallet,
        ownerAuthority: publicKey,
        sessionToken: device.sessionToken,
        addresses: prepared.addresses,
        connection,
      });
      const delegateSignature = await submitVersionedTransactionPlan({
        transactionPlan: delegate,
        wallet: sessionWallet,
      });
      await connection.confirmTransaction(delegateSignature, "confirmed");
      lap("delegate", "solana-base", { signature: delegateSignature });
      const erConnection = await resolveRunErConnection(
        prepared.addresses.activeRun,
      );
      lap("er-resolve", "router");
      plog(traceId, "launch:router-resolved", "router", {
        endpointHost: new URL(erConnection.rpcEndpoint).host,
        runId: prepared.runId.toString(),
      });
      const activeRun = await hydrateRows({
        prepared,
        session,
        erConnection,
        owner: publicKey,
        traceId,
      });
      lap("vrf-hydrate", "orchestration");
      plog(traceId, "launch:total", "orchestration", {
        durationMs: Date.now() - launchStart,
        mapId,
        level,
        reusedSession: true,
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
    [connection, player, publicKey, wallet],
  );

  const startCampaignRun = useCallback(
    async (mapId: number, level: number) => {
      try {
        return await withBusy(setState, () => launchCampaignRun(mapId, level));
      } catch (error) {
        plogFailure(telemetryTrace.current, "launch:error", "orchestration", error, {
          mode: "campaign",
          mapId,
          level,
        });
        throw error;
      }
    },
    [launchCampaignRun],
  );

  const startDailyRun = useCallback(
    async (daily: DailyView) => {
      return withBusy(setState, async () => {
        if (!wallet || !publicKey) {
          throw new Error("Connect a wallet before starting a run");
        }
        const device = player.requireSession();
        const session = device.signer;
        const sessionWallet = new SessionWallet(session);
        telemetryTrace.current = createChainTraceId();
        const traceId = telemetryTrace.current;
        const launchStart = Date.now();
        let mark = launchStart;
        const lap = (
          label: string,
          layer: ChainMetricLayer = "solana-base",
          data: Record<string, unknown> = {},
        ) => {
          const now = Date.now();
          plog(traceId, `launch:${label}`, layer, {
            durationMs: now - mark,
            mode: "daily",
            ...data,
          });
          mark = now;
        };
        const prepared = await buildPrepareDailyRunPlan({
          wallet: sessionWallet,
          ownerAuthority: publicKey,
          sessionToken: device.sessionToken,
          daily,
          connection,
          sessionValidUntil: device.validUntil,
        });
        const prepareSignature = await submitPreparedRunPlan({
          preparedRun: prepared,
          owner: publicKey,
          wallet: sessionWallet,
          sessionSigner: session,
          mode: "daily",
          dailyVersion: daily.economyVersion,
        });
        lap("prepare", "solana-base", { signature: prepareSignature });
        const delegate = await buildDelegateRunPlan({
          wallet: sessionWallet,
          ownerAuthority: publicKey,
          sessionToken: device.sessionToken,
          addresses: prepared.addresses,
          connection,
        });
        const delegateSignature = await submitVersionedTransactionPlan({
          transactionPlan: delegate,
          wallet: sessionWallet,
        });
        await connection.confirmTransaction(delegateSignature, "confirmed");
        lap("delegate", "solana-base", { signature: delegateSignature });
        const erConnection = await resolveRunErConnection(
          prepared.addresses.activeRun,
        );
        lap("er-resolve", "router");
        plog(traceId, "launch:router-resolved", "router", {
          endpointHost: new URL(erConnection.rpcEndpoint).host,
          runId: prepared.runId.toString(),
          mode: "daily",
        });
        const activeRun = await hydrateRows({
          prepared,
          session,
          erConnection,
          owner: publicKey,
          traceId,
        });
        lap("vrf-hydrate", "orchestration");
        plog(traceId, "launch:total", "orchestration", {
          durationMs: Date.now() - launchStart,
          mode: "daily",
          dayId: daily.dayId,
          reusedSession: true,
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
      }).catch((error: unknown) => {
        plogFailure(telemetryTrace.current, "launch:error", "orchestration", error, {
          mode: "daily",
          dayId: daily.dayId,
        });
        throw error;
      });
    },
    [connection, player, publicKey, wallet],
  );

  const playMove = useCallback(
    async (row: number, start: number, destination: number) => {
      const run = currentRun.current;
      if (!run) throw new Error("No delegated run is attached");
      actionInFlight.current = true;
      try {
        return await withBusy(setState, async () => {
          const device = player.requireSession();
          const sessionWallet = new SessionWallet(device.signer);
          const moveStart = Date.now();
          plog(telemetryTrace.current, "move:start", "magicblock-er", {
            move: run.activeRun.moves,
            action: run.activeRun.actionCounter,
            row,
            start,
            destination,
          });
          const plan = await buildPlayMovePlan({
            owner: run.marker.owner,
            sessionWallet,
            sessionToken: device.sessionToken,
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
          const submittedAt = Date.now();
          plog(telemetryTrace.current, "move:submit", "magicblock-er", {
            durationMs: submittedAt - moveStart,
            signature,
            endpointHost: new URL(run.connection.rpcEndpoint).host,
          });
          const activeRun = await hydrateRows({
            prepared: {
              runId: run.marker.runId,
              addresses: run.marker.addresses,
              sessionToken: device.sessionToken,
              sessionValidUntil: device.validUntil,
              transactionPlan: plan,
            },
            session: device.signer,
            erConnection: run.connection,
            owner: device.owner,
            traceId: telemetryTrace.current,
          });
          plog(telemetryTrace.current, "move:total", "magicblock-er", {
            durationMs: Date.now() - moveStart,
            vrfHydrateMs: Date.now() - submittedAt,
            newMove: activeRun.moves,
            newScore: activeRun.score,
            lifecycle: activeRun.lifecycle,
          });
          run.activeRun = activeRun;
          setState((value) => ({
            ...value,
            activeRun,
            lastSignature: signature,
          }));
          return activeRun;
        });
      } catch (error) {
        plogFailure(
          telemetryTrace.current,
          "move:error",
          "magicblock-er",
          error,
        );
        throw error;
      } finally {
        actionInFlight.current = false;
      }
    },
    [player],
  );

  const setStage = useCallback(
    (settleStage: SettleStage | null) =>
      setState((value) => ({ ...value, settleStage })),
    [],
  );

  /**
   * Canonical base-layer settlement tail: consume the receipt and close the
   * ActiveRun atomically with the current device session
   * and clear the local marker. Shared by the normal pipeline and the
   * stuck-run recovery.
   */
  const finalizeBaseSettlement = useCallback(
    async (descriptor: PublicRunSettlementDescriptor) => {
      if (!wallet || !publicKey) throw new Error("Connect the run owner wallet");
      const device = player.requireSession();
      const sessionWallet = new SessionWallet(device.signer);
      const receiptReadStartedAt = Date.now();
      const receipt = await fetchReceipt(
        connection,
        readOnlyWallet,
        descriptor.addresses.runReceipt,
      );
      plog(telemetryTrace.current, "settle:receipt-read", "solana-base", {
        durationMs: Date.now() - receiptReadStartedAt,
        receiptConsumed: Boolean(receipt?.consumed),
      });
      plog(telemetryTrace.current, "settle:finalize-start", "solana-base", {
        runId: descriptor.runId.toString(),
        receiptConsumed: Boolean(receipt?.consumed),
        mode: descriptor.mode,
      });
      setStage(receipt?.consumed ? "cleaning" : "consuming");
      const finalizePlan = await buildFinalizeRunPlan({
        wallet: sessionWallet,
        owner: descriptor.owner,
        sessionToken: device.sessionToken,
        runId: descriptor.runId,
        addresses: descriptor.addresses,
        mode: descriptor.mode,
        dailyChallenge: descriptor.dailyChallenge,
        dailyVersion: descriptor.dailyVersion ?? 1,
        receiptConsumed: Boolean(receipt?.consumed),
        connection,
      });
      const submitStartedAt = Date.now();
      const signature = await submitVersionedTransactionPlan({
        transactionPlan: finalizePlan,
        wallet: sessionWallet,
      });
      plog(telemetryTrace.current, "settle:consume-close-submit", "solana-base", {
        durationMs: Date.now() - submitStartedAt,
        signature,
        consumedInTransaction: !receipt?.consumed,
      });
      const confirmationStartedAt = Date.now();
      await connection.confirmTransaction(signature, "confirmed");
      plog(telemetryTrace.current, "settle:consume-close-confirm", "solana-base", {
        durationMs: Date.now() - confirmationStartedAt,
        signature,
      });
      const remaining = await connection.getMultipleAccountsInfo(
        [
          descriptor.addresses.runShell,
          descriptor.addresses.activeRun,
          descriptor.addresses.runReceipt,
        ],
        "confirmed",
      );
      if (remaining.some((account) => account !== null)) {
        throw new Error("Canonical settlement confirmed without closing every run account");
      }
      plog(telemetryTrace.current, "settle:postcondition", "solana-base", {
        runAccountsClosed: true,
        signature,
      });
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
    [connection, player, publicKey, readOnlyWallet, setStage, wallet],
  );

  /**
   * Full auto-settle pipeline for the attached delegated run:
   * seal (session) → commit-and-undelegate (session) → wait for the base
   * copyback → consume receipt + close for rent
   * → optionally launch the next campaign level. No manual settle button.
   */
  const settleAndAdvance = useCallback(
    async (next?: { mapId: number; level: number }) => {
      const run = currentRun.current;
      if (!run || !wallet) throw new Error("No delegated run is attached");
      actionInFlight.current = true;
      try {
        return await withBusy(setState, async () => {
          const device = player.requireSession();
          const sessionWallet = new SessionWallet(device.signer);
          setStage("sealing");
          const sealStartedAt = Date.now();
          const seal = await buildSealRunPlan({
            owner: run.marker.owner,
            sessionWallet,
            sessionToken: device.sessionToken,
            activeRun: run.marker.addresses.activeRun,
            erConnection: run.connection,
          });
          const sealSignature = await submitWalletTransactionPlan({
            transactionPlan: seal,
            wallet: sessionWallet,
          });
          plog(telemetryTrace.current, "settle:seal", "magicblock-er", {
            durationMs: Date.now() - sealStartedAt,
            signature: sealSignature,
          });
          setStage("committing");
          const commitStartedAt = Date.now();
          const commit =
            run.marker.mode === "daily"
              ? await buildCommitDailyRunPlan({
                  owner: run.marker.owner,
                  payerWallet: sessionWallet,
                  addresses: run.marker.addresses,
                  dailyChallenge: run.activeRun.dailyChallenge,
                  economyVersion: run.marker.dailyVersion ?? 1,
                  erConnection: run.connection,
                })
              : await buildCommitRunPlan({
                  owner: run.marker.owner,
                  payerWallet: sessionWallet,
                  addresses: run.marker.addresses,
                  erConnection: run.connection,
                });
          const signature = await submitWalletTransactionPlan({
            transactionPlan: commit,
            wallet: sessionWallet,
          });
          plog(
            telemetryTrace.current,
            "settle:commit-undelegate",
            "magicblock-er",
            {
              durationMs: Date.now() - commitStartedAt,
              signature,
            },
          );
          setStage("settling");
          // Wait for the commit-and-undelegate to copy back to Solana base.
          // Subscribe to the base ActiveRun account and re-check delegation on
          // each write, instead of polling every 1.5s; on timeout we proceed to
          // finalize anyway (matching the old break-and-continue behaviour).
          const pollStart = Date.now();
          let timedOut = false;
          try {
            await awaitAccountCondition({
              connection,
              address: run.marker.addresses.activeRun,
              isSatisfied: async () =>
                !(await getDelegationStatus(run.marker.addresses.activeRun))
                  .isDelegated,
              fallbackPollMs: 1_500,
              timeoutMs: 90_000,
              timeoutMessage: "Timed out waiting for undelegation copyback",
            });
          } catch {
            timedOut = true;
          }
          plog(telemetryTrace.current, "settle:copyback", "orchestration", {
            durationMs: Date.now() - pollStart,
            timedOut,
            signature,
          });
          const finalizeStart = Date.now();
          const finalizeSignature = await finalizeBaseSettlement(
            settlementDescriptor(run.marker, run.activeRun.dailyChallenge),
          );
          plog(telemetryTrace.current, "settle:finalize-done", "solana-base", {
            durationMs: Date.now() - finalizeStart,
            signature: finalizeSignature,
          });
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
      } catch (error) {
        plogFailure(
          telemetryTrace.current,
          "settle:error",
          "orchestration",
          error,
        );
        throw error;
      } finally {
        setStage(null);
        actionInFlight.current = false;
      }
    },
    [connection, finalizeBaseSettlement, launchCampaignRun, player, setStage, wallet],
  );

  /**
   * Explicit recovery for an undelegated terminal run whose receipt was not
   * consumed on base. Keeping this controller-driven prevents a
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
   * Every PDA is reconstructed from the connected owner, so this path
   * remains available when the local RunSessionMarker has been lost.
   */
  const recoverBaseRun = useCallback(
    async (runId: bigint): Promise<string> => {
      if (!wallet || !publicKey) throw new Error("Connect the run owner wallet");
      if (actionInFlight.current) {
        throw new Error("Another run action is already in progress");
      }
      actionInFlight.current = true;
      try {
        return await withBusy(setState, async () => {
          const validRunId = requirePositiveRunId(runId);
          if (!wallet.publicKey.equals(publicKey)) {
            throw new Error(
              "Connected wallet changed before run recovery",
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
            readOnlyWallet,
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
    [
      connection,
      finalizeBaseSettlement,
      publicKey,
      readOnlyWallet,
      setStage,
      wallet,
    ],
  );

  /**
   * Give up the current run on-chain (cycling-sim abort semantics): force it
   * terminal with zero stars, settle through the unchanged pipeline, and
   * reclaim the ActiveRun rent. A delegated run abandons on the ER
   * (session-signed) and then settles normally; a stuck non-terminal base
   * run abandons inside one session-signed finalize envelope. Throws for
   * callers to fall back to the local `dismissRun` (e.g. against a deployed
   * program that predates `abandonRun`).
   */
  const abandonRun = useCallback(async () => {
    if (!wallet || !publicKey) throw new Error("Connect the run owner wallet");
    const device = player.requireSession();
    const sessionWallet = new SessionWallet(device.signer);
    const run = currentRun.current;
    if (run) {
      if (actionInFlight.current) {
        throw new Error("Another run action is already in progress");
      }
      actionInFlight.current = true;
      try {
        await withBusy(setState, async () => {
          setStage("abandoning");
          const abandon = await buildAbandonRunPlan({
            owner: run.marker.owner,
            signerWallet: sessionWallet,
            sessionToken: device.sessionToken,
            activeRun: run.marker.addresses.activeRun,
            erConnection: run.connection,
          });
          const signature = await submitWalletTransactionPlan({
            transactionPlan: abandon,
            wallet: sessionWallet,
          });
          const abandoned = await fetchActiveRun(
            run.connection,
            sessionWallet,
            run.marker.addresses.activeRun,
          );
          if (abandoned) run.activeRun = abandoned;
          return signature;
        });
      } finally {
        setStage(null);
        actionInFlight.current = false;
      }
      await settleAndAdvance();
      return;
    }
    // No delegated attachment: recover the marker and abandon on base.
    const marker = loadRunSession(publicKey);
    if (!marker) throw new Error("No run marker to abandon");
    if (actionInFlight.current) {
      throw new Error("Another run action is already in progress");
    }
    actionInFlight.current = true;
    try {
      await withBusy(setState, async () => {
        const delegation = await getDelegationStatus(
          marker.addresses.activeRun,
        );
        if (delegation.isDelegated) {
          throw new Error(
            "Run is still delegated to the ER; resume it before abandoning",
          );
        }
        const activeRun = await fetchActiveRun(
          connection,
          readOnlyWallet,
          marker.addresses.activeRun,
        );
        if (!activeRun) {
          throw new Error(
            `ActiveRun for run ${marker.runId.toString()} is missing on Solana base`,
          );
        }
        if (isTerminal(activeRun.lifecycle)) {
          // Already terminal: nothing to abandon — finish the normal
          // consume/close settlement tail instead.
          return finalizeBaseSettlement(
            settlementDescriptor(marker, activeRun.dailyChallenge),
          );
        }
        setStage("abandoning");
        const finalizePlan = await buildFinalizeRunPlan({
          wallet: sessionWallet,
          owner: marker.owner,
          sessionToken: device.sessionToken,
          runId: marker.runId,
          addresses: marker.addresses,
          mode: marker.mode,
          dailyChallenge: activeRun.dailyChallenge,
          dailyVersion: marker.dailyVersion ?? 1,
          receiptConsumed: false,
          abandonFirst: true,
          connection,
        });
        const signature = await submitVersionedTransactionPlan({
          transactionPlan: finalizePlan,
          wallet: sessionWallet,
        });
        await connection.confirmTransaction(signature, "confirmed");
        clearRunSession(publicKey);
        currentRun.current = null;
        settleableRun.current = null;
        setEpoch((value) => value + 1);
        setState((value) => ({
          ...value,
          phase: "none",
          activeRun: null,
          receipt: null,
          sessionAuthorized: false,
          lastSignature: signature,
        }));
        return signature;
      });
    } finally {
      setStage(null);
      actionInFlight.current = false;
    }
  }, [
    connection,
    finalizeBaseSettlement,
    player,
    publicKey,
    setStage,
    settleAndAdvance,
    readOnlyWallet,
    wallet,
  ]);

  /** Local escape hatch: forget the stuck marker without touching chain
   *  accounts (they stay recoverable later). */
  const dismissRun = useCallback(() => {
    if (!publicKey) return;
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

  const applyBonus = useCallback(
    async (row: number, column: number) => {
      const run = currentRun.current;
      if (!run) throw new Error("No delegated run is attached");
      actionInFlight.current = true;
      try {
        return await withBusy(setState, async () => {
          const device = player.requireSession();
          const sessionWallet = new SessionWallet(device.signer);
        const plan = await buildApplyBonusPlan({
          owner: run.marker.owner,
          sessionWallet,
            sessionToken: device.sessionToken,
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
    },
    [player],
  );

  const cleanup = useCallback(async () => {
    if (!publicKey) throw new Error("Connect the run owner wallet");
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
    if (!run || !wallet || !publicKey)
      throw new Error("No delegated run is attached");
    if (actionInFlight.current) {
      throw new Error("Another run action is already in progress");
    }
    actionInFlight.current = true;
    try {
      return await withBusy(setState, async () => {
        await player.renew();
        const device = loadDeviceSession(publicKey);
        if (!device) throw new Error("Renewed device session was not persisted");
        const marker: RunSessionMarker = {
          ...run.marker,
          session: device.signer,
          sessionToken: device.sessionToken,
          validUntil: device.validUntil,
          createdAt: device.createdAt,
        };
        saveRunSession(marker);
        run.marker = marker;
        run.sessionAuthorized = true;
        setEpoch((value) => value + 1);
        setState((value) => ({ ...value, sessionAuthorized: true }));
        return marker;
      });
    } finally {
      actionInFlight.current = false;
    }
  }, [player, publicKey, wallet]);

  // Force an immediate watcher re-resolve (restarts the resolve/subscribe
  // loop). Used to retry a run stuck "resolving" while the ER catches up.
  const retryResolve = useCallback(() => {
    setEpoch((value) => value + 1);
  }, []);

  return {
    ...state,
    connected: Boolean(publicKey && wallet),
    publicKey,
    startCampaignRun,
    startDailyRun,
    playMove,
    applyBonus,
    settleAndAdvance,
    recoverSettlement,
    recoverBaseRun,
    abandonRun,
    dismissRun,
    cleanup,
    recoverSession,
    retryResolve,
  };
}

async function hydrateRows(args: {
  prepared: PreparedRunPlan;
  session: Keypair;
  erConnection: import("@solana/web3.js").Connection;
  owner: PublicKey;
  traceId: string;
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
      const requestStartedAt = Date.now();
      let signature = "";
      await withTransientErRetry(async () => {
        const request = await buildRequestRowPlan({
          owner: args.owner,
          sessionWallet,
          sessionToken: args.prepared.sessionToken,
          activeRun: args.prepared.addresses.activeRun,
          erConnection: args.erConnection,
        });
        signature = await submitWalletTransactionPlan({
          transactionPlan: request,
          wallet: sessionWallet,
        });
        return signature;
      });
      plog(args.traceId, "vrf:request", "vrf", {
        durationMs: Date.now() - requestStartedAt,
        signature,
        endpointHost: new URL(args.erConnection.rpcEndpoint).host,
        hydrateAttempt: attempt + 1,
        vrfRequestCounter: active.vrfRequestCounter,
      });
    }
    const callbackStartedAt = Date.now();
    await waitForVrf(
      args.erConnection,
      sessionWallet,
      args.prepared.addresses.activeRun,
    );
    plog(args.traceId, "vrf:callback", "vrf", {
      durationMs: Date.now() - callbackStartedAt,
      endpointHost: new URL(args.erConnection.rpcEndpoint).host,
    });
  }
  throw new Error("VRF initialization exceeded the configured row budget");
}

async function waitForVrf(
  connection: import("@solana/web3.js").Connection,
  wallet: WalletLike,
  activeRunAddress: import("@solana/web3.js").PublicKey,
): Promise<void> {
  // After a move the run sits in AwaitingVrf until the MagicBlock oracle writes
  // the next row (pendingVrfCounter → 0). Subscribe to the ER account and
  // resolve the instant that write lands, instead of polling — the ~1s fallback
  // is only a dropped-socket safety net.
  await awaitAccountCondition({
    connection,
    address: activeRunAddress,
    isSatisfied: async () => {
      const active = await fetchActiveRun(connection, wallet, activeRunAddress);
      return active !== null && active.pendingVrfCounter === 0;
    },
    fallbackPollMs: 1_000,
    timeoutMs: 20_000,
    timeoutMessage: "Timed out waiting for the MagicBlock VRF callback",
  });
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
    `Wallet ${args.owner.toBase58()} already has local run ${attached.runId.toString()} attached; leave recovery mode and resume or forget it before recovering run ${args.requestedRunId.toString()}`,
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
    dailyVersion: marker.dailyVersion ?? 1,
  };
}

async function withBusy<T>(
  setState: React.Dispatch<React.SetStateAction<RunControllerState>>,
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
