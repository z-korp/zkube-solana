import { Duration, Effect, Layer, Schedule, Stream, SubscriptionRef } from "effect";
import { Connection, PublicKey } from "@solana/web3.js";

import { RunsRejected, RunsUnavailable, type RunsError } from "../../errors";
import { Runs, type RunsService } from "../../services";
import type {
  RunAction,
  RunEvent,
  RunFinishReason,
  RunMode,
  RunView,
} from "../../views";
import {
  buildCommitDailyRunPlan,
  buildPrepareDailyRunPlan,
  currentDailyDayId,
  fetchDailyView,
} from "../content/dailyClient";
import { projectRunFromLocalState } from "../../../core/runProjection";
import {
  coreApplyRunBonus,
  coreFinishRun,
  corePlayRunMove,
  coreRequestRunReroll,
  coreRunSummary,
} from "../../../core/zkubeCore";
import {
  SolanaIdentitySessionState,
  type SolanaIdentitySessionStateService,
} from "../SolanaIdentitySessionLive";
import { createReadOnlyWallet } from "../identity/readOnlyWallet";
import { SessionWallet } from "../session/sessionWallet";
import { SolanaWalletDriver } from "../wallet/SolanaWalletDriver";
import { watchAccount } from "../watch";
import { ActiveRunObserver } from "./activeRunObserver";
import { submitErTransactionPlan } from "./erTransport";
import { resolvePersistedRun } from "./resumeRun";
import {
  buildApplyBonusPlan,
  buildCommitRunPlan,
  buildFinalizeRunPlan,
  buildFinishRunPlan,
  buildPlayMovePlan,
  buildPrepareCampaignRunPlan,
  buildRequestRerollPlan,
  buildRequestRowPlan,
  combinePreparedAndDelegatePlan,
  decodeActiveRunAccount,
  fetchActiveRun,
  resolveRunErConnection,
  submitPreparedRunPlan,
  submitVersionedTransactionPlan,
  type ActiveRunView,
  type PreparedRunPlan,
} from "./runPlan";
import {
  clearRunSession,
  loadRunSession,
  type RunSessionMarker,
  type RunSlot,
} from "./runSessionStore";
import { getDelegationStatus } from "./router";
import { resolveSpectatedRun } from "./spectateRun";

export interface SolanaRunsOptions {
  readonly connection: Connection;
}

interface AttachedRun {
  readonly marker: RunSessionMarker;
  readonly connection: Connection;
  readonly observer: ActiveRunObserver<ActiveRunView>;
  readonly events: SubscriptionRef.SubscriptionRef<RunEvent>;
  activeRun: ActiveRunView;
  busy: boolean;
}

export function makeSolanaRunsLive(
  options: SolanaRunsOptions,
): Layer.Layer<Runs, never, SolanaIdentitySessionState | SolanaWalletDriver> {
  return Layer.scoped(
    Runs,
    Effect.gen(function* () {
      const identitySession = yield* SolanaIdentitySessionState;
      yield* SolanaWalletDriver;
      const records = new Map<string, AttachedRun>();
      const eventRefs = new Map<
        string,
        SubscriptionRef.SubscriptionRef<RunEvent>
      >();
      const activeRefs = {
        campaign: yield* SubscriptionRef.make<RunView | null>(null),
        arcade: yield* SubscriptionRef.make<RunView | null>(null),
      };

      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await Promise.all(
            [...records.values()].map(({ observer }) => observer.close()),
          );
          records.clear();
          eventRefs.clear();
        }),
      );

      const launch = async (
        mode: RunMode,
        prepare: (
          owner: PublicKey,
          signer: SessionWallet,
          session: ReturnType<
            SolanaIdentitySessionStateService["deviceSession"]
          > & {},
        ) => Promise<PreparedRunPlan>,
      ): Promise<RunView> => {
        const { owner, device, wallet } = requireActor(identitySession);
        const slot = slotForMode(mode);
        if (recordsHasSlot(records, slot) || loadRunSession(owner, slot)) {
          throw new Error(
            `Finish the active ${mode} run before starting another`,
          );
        }
        const eventRef = await Effect.runPromise(
          SubscriptionRef.make<RunEvent>({ _tag: "Prepared" }),
        );
        const prepared = await prepare(owner, wallet, device);
        eventRefs.set(prepared.runId.toString(), eventRef);
        const combined = await combinePreparedAndDelegatePlan({
          prepared,
          ownerAuthority: owner,
          sessionToken: device.sessionToken,
          sessionSigner: device.signer,
        });
        await submitPreparedRunPlan({
          preparedRun: combined,
          owner,
          wallet,
          sessionSigner: device.signer,
          ...(mode === "arcade" ? { mode: "daily" as const } : {}),
        });
        await publish(eventRef, { _tag: "Delegated" });
        const erConnection = await resolveRunErConnection(
          prepared.addresses.activeRun,
        );
        const observer = await activeRunObserver(
          erConnection,
          prepared.addresses.activeRun,
          wallet,
        );
        const activeRun = await hydrateRows({
          prepared,
          owner,
          wallet,
          connection: erConnection,
          observer,
          events: eventRef,
        });
        const marker = loadRunSession(owner, slot);
        if (!marker)
          throw new Error("Confirmed run did not persist its marker");
        const attached: AttachedRun = {
          marker,
          connection: erConnection,
          observer,
          events: eventRef,
          activeRun,
          busy: false,
        };
        records.set(prepared.runId.toString(), attached);
        const view = projectSolanaRun(activeRun);
        await Effect.runPromise(SubscriptionRef.set(activeRefs[mode], view));
        return view;
      };

      const resume = async (mode: RunMode): Promise<RunView | null> => {
        const { owner, device, readOnly } = requireActor(identitySession);
        const resumed = await resolvePersistedRun({
          owner,
          slot: slotForMode(mode),
          wallet: readOnly,
          baseConnection: options.connection,
          deviceSession: device,
        });
        if (
          resumed.phase !== "delegated" &&
          resumed.phase !== "base" &&
          resumed.phase !== "settleable"
        ) {
          await Effect.runPromise(SubscriptionRef.set(activeRefs[mode], null));
          return null;
        }
        const runId = resumed.activeRun.runId.toString();
        const prior = records.get(runId);
        const eventRef =
          prior?.events ??
          (await Effect.runPromise(
            SubscriptionRef.make<RunEvent>({
              _tag: resumed.phase === "delegated" ? "Delegated" : "Committed",
            }),
          ));
        eventRefs.set(runId, eventRef);
        if (resumed.phase === "delegated") {
          const observer =
            prior?.observer ??
            (await activeRunObserver(
              resumed.connection,
              resumed.marker.addresses.activeRun,
              new SessionWallet(device.signer),
            ));
          records.set(runId, {
            marker: resumed.marker,
            connection: resumed.connection,
            observer,
            events: eventRef,
            activeRun: resumed.activeRun,
            busy: false,
          });
        }
        const view = projectSolanaRun(resumed.activeRun);
        await Effect.runPromise(SubscriptionRef.set(activeRefs[mode], view));
        return view;
      };

      const runs: RunsService = {
        startCampaign: (realm, level) =>
          runEffect(() =>
            launch("campaign", (owner, wallet, device) =>
              buildPrepareCampaignRunPlan({
                wallet,
                ownerAuthority: owner,
                sessionToken: device.sessionToken,
                mapId: realm,
                level,
                connection: options.connection,
                sessionValidUntil: device.validUntil,
              }),
            ),
          ),
        enterDaily: () =>
          runEffect(async () => {
            const { readOnly } = requireActor(identitySession);
            const daily = await fetchDailyView({
              connection: options.connection,
              wallet: readOnly,
              dayId: currentDailyDayId(),
            });
            if (!daily) throw new Error("Today's Daily is unavailable");
            return launch("arcade", (owner, wallet, device) =>
              buildPrepareDailyRunPlan({
                connection: options.connection,
                wallet,
                ownerAuthority: owner,
                sessionToken: device.sessionToken,
                daily,
                sessionValidUntil: device.validUntil,
              }),
            );
          }),
        act: (runId, action) =>
          runEffect(() =>
            act({
              runId,
              action,
              records,
              activeRefs,
              identitySession,
              baseConnection: options.connection,
            }),
          ),
        resume: (mode) => runEffect(() => resume(mode)),
        spectate: (address, mode) =>
          runEffect(async () => {
            const target = await resolveSpectatedRun({
              baseConnection: options.connection,
              target: { player: new PublicKey(address) },
            });
            if (target.phase !== "delegated" && target.phase !== "base") {
              return null;
            }
            const view = projectSolanaRun(target.activeRun);
            return view.mode === mode ? view : null;
          }),
        active: (mode) =>
          Effect.gen(function* () {
            const current = yield* SubscriptionRef.get(activeRefs[mode]);
            return current ?? (yield* Effect.promise(() => resume(mode)));
          }).pipe(Effect.mapError(asRunsError)),
        events: (runId) => {
          const ref = eventRefs.get(runId);
          return ref
            ? ref.changes
            : Stream.fail(
                new RunsUnavailable({
                  message: `Run ${runId} is not attached`,
                }),
              );
        },
      };
      return runs;
    }),
  );
}

async function act(args: {
  runId: string;
  action: RunAction;
  records: Map<string, AttachedRun>;
  activeRefs: Record<RunMode, SubscriptionRef.SubscriptionRef<RunView | null>>;
  identitySession: SolanaIdentitySessionStateService;
  baseConnection: Connection;
}): Promise<RunView> {
  const attached = args.records.get(args.runId);
  if (!attached) throw new Error(`Run ${args.runId} is not attached`);
  if (attached.busy)
    throw new Error("Another run action is already in progress");
  const { owner, device, wallet } = requireActor(args.identitySession);
  if (!attached.marker.owner.equals(owner))
    throw new Error("Run owner changed");
  attached.busy = true;
  let submitted = false;
  const before = attached.activeRun;
  try {
    const expectedAction = before.actionCounter + 1;
    const optimistic = optimisticAction(before, args.action);
    const plan = await actionPlan({
      action: args.action,
      active: before,
      marker: attached.marker,
      connection: attached.connection,
      wallet,
      sessionToken: device.sessionToken,
    });
    await submitWithErRetry(() =>
      submitErTransactionPlan({
        transactionPlan: plan,
        wallet,
      }),
    );
    submitted = true;
    attached.activeRun = optimistic;
    await publish(attached.events, {
      _tag: "ActionAccepted",
      kind: actionKind(args.action),
      index: before.actionCounter,
      token: projectSolanaRun(optimistic).token,
    });
    if (args.action._tag === "Reroll") {
      await publish(attached.events, { _tag: "RerollPending" });
    }
    let active: ActiveRunView;
    try {
      const update = await attached.observer.waitFor(
        (state) =>
          state.actionCounter >= expectedAction &&
          (isTerminal(state.lifecycle) ||
            (state.lifecycle === "playing" && state.pendingVrfCounter === 0)),
        {
          fallbackPollMs: 250,
          timeoutMs: 20_000,
          timeoutMessage: "Timed out waiting for the action and VRF callback",
        },
      );
      active = update.state;
    } catch {
      const pending =
        attached.observer.latest() ??
        (await fetchActiveRun(
          attached.connection,
          wallet,
          attached.marker.addresses.activeRun,
        ));
      if (pending && pending.actionCounter >= expectedAction) {
        attached.activeRun = pending;
        await publish(attached.events, {
          _tag: "AwaitingRow",
          since: Math.floor(Date.now() / 1_000),
        });
        const view = projectSolanaRun(pending);
        await Effect.runPromise(
          SubscriptionRef.set(args.activeRefs[view.mode], view),
        );
        return view;
      }
      throw new Error("Submitted action is awaiting authoritative state");
    }
    attached.activeRun = active;
    const view = projectSolanaRun(active);
    await Effect.runPromise(
      SubscriptionRef.set(args.activeRefs[view.mode], view),
    );
    if (isTerminal(active.lifecycle)) {
      await publish(attached.events, {
        _tag: "Finished",
        reason: finishReason(active),
      });
      await settle(args, attached, wallet, active);
    }
    return view;
  } catch (cause) {
    if (!submitted) {
      attached.activeRun = before;
      await publish(attached.events, {
        _tag: "ActionRejected",
        reason: message(cause),
      });
    }
    throw cause;
  } finally {
    attached.busy = false;
  }
}

async function actionPlan(args: {
  action: RunAction;
  active: ActiveRunView;
  marker: RunSessionMarker;
  connection: Connection;
  wallet: SessionWallet;
  sessionToken: PublicKey;
}) {
  const common = {
    owner: args.marker.owner,
    sessionToken: args.sessionToken,
    activeRun: args.marker.addresses.activeRun,
    erConnection: args.connection,
  };
  switch (args.action._tag) {
    case "Move":
      return buildPlayMovePlan({
        ...common,
        sessionWallet: args.wallet,
        expectedMove: args.active.moves,
        expectedAction: args.active.actionCounter,
        row: args.action.row,
        start: args.action.start,
        destination: args.action.destination,
      });
    case "Bonus":
      return buildApplyBonusPlan({
        ...common,
        sessionWallet: args.wallet,
        expectedAction: args.active.actionCounter,
        row: args.action.row,
        column: args.action.column,
      });
    case "Reroll":
      return buildRequestRerollPlan({
        ...common,
        sessionWallet: args.wallet,
        expectedAction: args.active.actionCounter,
      });
    case "Finish":
      return buildFinishRunPlan({
        ...common,
        signerWallet: args.wallet,
      });
  }
}

function optimisticAction(
  active: ActiveRunView,
  action: RunAction,
): ActiveRunView {
  const token = active.runToken;
  if (!token) throw new Error("ActiveRun has no reconciled core token");
  const state = (() => {
    switch (action._tag) {
      case "Move":
        return corePlayRunMove({
          config: token.config,
          state: token.state,
          action: active.actionCounter,
          expectedMove: active.moves,
          row: action.row,
          start: action.start,
          destination: action.destination,
        });
      case "Bonus":
        return coreApplyRunBonus({
          config: token.config,
          state: token.state,
          action: active.actionCounter,
          row: action.row,
          column: action.column,
        });
      case "Reroll":
        return coreRequestRunReroll(
          token.config,
          token.state,
          active.actionCounter,
        );
      case "Finish":
        return coreFinishRun(token.config, token.state, "abandon");
    }
  })();
  return projectRunFromLocalState(active, state);
}

async function settle(
  args: Parameters<typeof act>[0],
  attached: AttachedRun,
  wallet: SessionWallet,
  active: ActiveRunView,
): Promise<void> {
  await attached.observer.close();
  const commit =
    attached.marker.mode === "daily"
      ? await buildCommitDailyRunPlan({
          owner: attached.marker.owner,
          payerWallet: wallet,
          addresses: attached.marker.addresses,
          dailyChallenge: active.dailyChallenge,
          erConnection: attached.connection,
        })
      : await buildCommitRunPlan({
          owner: attached.marker.owner,
          payerWallet: wallet,
          addresses: attached.marker.addresses,
          erConnection: attached.connection,
        });
  await submitErTransactionPlan({ transactionPlan: commit, wallet });
  await publish(attached.events, { _tag: "Committed" });
  await waitForCopyback(
    args.baseConnection,
    attached.marker.addresses.activeRun,
  );
  const finalize = await buildFinalizeRunPlan({
    wallet,
    owner: attached.marker.owner,
    sessionToken: attached.marker.sessionToken,
    runId: attached.marker.runId,
    addresses: attached.marker.addresses,
    mode: attached.marker.mode,
    dailyChallenge: active.dailyChallenge,
    connection: args.baseConnection,
  });
  await submitVersionedTransactionPlan({ transactionPlan: finalize, wallet });
  await publish(attached.events, { _tag: "Consumed" });
  clearRunSession(
    attached.marker.owner,
    slotForMode(projectSolanaRun(active).mode),
  );
  args.records.delete(attached.marker.runId.toString());
  await Effect.runPromise(
    SubscriptionRef.set(args.activeRefs[projectSolanaRun(active).mode], null),
  );
}

async function waitForCopyback(
  connection: Connection,
  address: PublicKey,
): Promise<void> {
  const ready = watchAccount({
    connection,
    address,
    decode: (info) => info !== null,
    fallbackPollMs: 1_500,
  }).pipe(
    Stream.filterEffect(() =>
      Effect.tryPromise({
        try: async () => !(await getDelegationStatus(address)).isDelegated,
        catch: (cause) => new Error(message(cause)),
      }),
    ),
    Stream.runHead,
    Effect.timeoutFail({
      duration: "90 seconds",
      onTimeout: () => new Error("Timed out waiting for undelegation copyback"),
    }),
  );
  await Effect.runPromise(ready);
}

async function hydrateRows(args: {
  prepared: PreparedRunPlan;
  owner: PublicKey;
  wallet: SessionWallet;
  connection: Connection;
  observer: ActiveRunObserver<ActiveRunView>;
  events: SubscriptionRef.SubscriptionRef<RunEvent>;
}): Promise<ActiveRunView> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const active =
      args.observer.latest() ??
      (await fetchActiveRun(
        args.connection,
        args.wallet,
        args.prepared.addresses.activeRun,
      ));
    if (!active) throw new Error("Delegated ActiveRun is missing from its ER");
    if (active.lifecycle === "playing" || isTerminal(active.lifecycle)) {
      await publish(args.events, { _tag: "RowReady" });
      return active;
    }
    let counter = active.pendingVrfCounter;
    if (counter === 0) {
      const request = await buildRequestRowPlan({
        owner: args.owner,
        sessionWallet: args.wallet,
        sessionToken: args.prepared.sessionToken,
        activeRun: args.prepared.addresses.activeRun,
        erConnection: args.connection,
      });
      await submitWithErRetry(() =>
        submitErTransactionPlan({
          transactionPlan: request,
          wallet: args.wallet,
        }),
      );
      counter = active.vrfRequestCounter + 1;
    }
    await publish(args.events, {
      _tag: "AwaitingRow",
      since: Math.floor(Date.now() / 1_000),
    });
    try {
      const update = await args.observer.waitFor(
        (state) =>
          state.vrfRequestCounter >= counter && state.pendingVrfCounter === 0,
        {
          fallbackPollMs: 250,
          timeoutMs: 20_000,
          timeoutMessage: "Timed out waiting for the MagicBlock VRF callback",
        },
      );
      if (
        update.state.lifecycle === "playing" ||
        isTerminal(update.state.lifecycle)
      ) {
        await publish(args.events, { _tag: "RowReady" });
        return update.state;
      }
    } catch {
      const pending = args.observer.latest();
      if (pending?.pendingVrfCounter === counter) return pending;
      throw new Error("VRF row request did not reach authoritative state");
    }
  }
  throw new Error("VRF initialization exceeded its bounded callback budget");
}

async function activeRunObserver(
  connection: Connection,
  address: PublicKey,
  wallet: SessionWallet,
): Promise<ActiveRunObserver<ActiveRunView>> {
  const observer = new ActiveRunObserver(
    connection,
    address,
    decodeActiveRunAccount,
    () => fetchActiveRun(connection, wallet, address),
  );
  await observer.start();
  return observer;
}

function requireActor(state: SolanaIdentitySessionStateService) {
  const binding = state.binding();
  const device = state.deviceSession();
  if (!binding) throw new Error("Connect a Solana wallet first");
  if (!device || !device.owner.equals(binding.wallet.publicKey)) {
    throw new Error("Enable or renew this device session first");
  }
  return {
    owner: binding.wallet.publicKey,
    device,
    wallet: new SessionWallet(device.signer),
    readOnly: createReadOnlyWallet(binding.wallet.publicKey),
  };
}

export function projectSolanaRun(active: ActiveRunView): RunView {
  const mode: RunMode = active.mode === "daily" ? "arcade" : "campaign";
  const phase =
    active.lifecycle === "levelComplete"
      ? "levelComplete"
      : active.lifecycle === "finished"
        ? "finished"
        : active.lifecycle === "playing"
          ? "playing"
          : "awaitingVrf";
  return {
    mode,
    runId: active.runId.toString(),
    token: active.runToken?.state ?? new Uint8Array(),
    phase,
    ...(active.deadlineAt && active.deadlineAt > 0
      ? { deadlineAt: active.deadlineAt }
      : {}),
    ...(phase === "finished" || phase === "levelComplete"
      ? { finishReason: finishReason(active) }
      : {}),
  };
}

function finishReason(active: ActiveRunView): RunFinishReason {
  if (active.lifecycle === "levelComplete") return "levelComplete";
  if (active.finishReason === "abandon") return "abandon";
  if (active.finishReason === "deadline") return "deadline";
  if (active.finishReason === "overflow") return "overflow";
  if (active.finishReason === "moveBudget") return "moveBudget";
  if (active.runToken) {
    const reason = coreRunSummary(active.runToken.state).endReason;
    if (reason === 2) return "overflow";
    if (reason === 3) return "moveBudget";
  }
  return "moveBudget";
}

function actionKind(action: RunAction): "move" | "bonus" | "reroll" | "finish" {
  return action._tag.toLowerCase() as "move" | "bonus" | "reroll" | "finish";
}

function slotForMode(mode: RunMode): RunSlot {
  return mode === "campaign" ? "campaign" : "arcade";
}

function recordsHasSlot(
  records: Map<string, AttachedRun>,
  slot: RunSlot,
): boolean {
  return [...records.values()].some(
    ({ marker }) =>
      (marker.mode === "campaign" ? "campaign" : "arcade") === slot,
  );
}

function isTerminal(lifecycle: string): boolean {
  return lifecycle === "levelComplete" || lifecycle === "finished";
}

function publish(
  ref: SubscriptionRef.SubscriptionRef<RunEvent>,
  event: RunEvent,
): Promise<void> {
  return Effect.runPromise(SubscriptionRef.set(ref, event));
}

function runEffect<A>(action: () => Promise<A>): Effect.Effect<A, RunsError> {
  return Effect.tryPromise({ try: action, catch: asRunsError });
}

function submitWithErRetry<A>(action: () => Promise<A>): Promise<A> {
  const schedule = Schedule.exponential(Duration.millis(400)).pipe(
    Schedule.modifyDelay((_, delay) =>
      Duration.min(delay, Duration.seconds(3)),
    ),
  );
  return Effect.runPromise(
    Effect.tryPromise({ try: action, catch: (cause) => cause }).pipe(
      Effect.retry({
        times: 5,
        schedule,
        while: (cause) =>
          /cloner|pending request owner|account.*not found|blockhash not found/i.test(
            message(cause),
          ),
      }),
    ),
  );
}

function asRunsError(cause: unknown): RunsError {
  return cause instanceof RunsUnavailable || cause instanceof RunsRejected
    ? cause
    : new RunsRejected({ message: message(cause) });
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
