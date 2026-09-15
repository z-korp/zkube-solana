import {
  Context,
  Effect,
  Layer,
  Schedule,
  Stream,
  SubscriptionRef,
} from "effect";

import {
  coreCampaignMoveBudget,
  coreApplyRunBonus,
  coreApplyRunVrf,
  coreBuildRunConfig,
  coreEmptyContinuationRows,
  coreFinishRun,
  coreInitializeRun,
  corePlayRunMove,
  coreProtocol,
  coreRequestRunReroll,
  coreRunSummary,
  type CoreRunConfigInput,
} from "@/core/zkubeCore";
import { CAMPAIGN_CATALOG } from "@/core/campaignCatalog.generated";
import {
  currentDailyDayId,
  dailyContentFromPairIndex,
} from "@/core/dailyRules";
import {
  CAMPAIGN_TARGET_LADDER,
  DAILY_MAX_MOVES,
  PRESSURE_STEP,
  TIER_BLOCK_WEIGHTS,
} from "@/core/protocolVersions.generated";
import {
  Boards,
  Content,
  Economy,
  Identity,
  Runs,
  Session,
  StoreEconomy,
  type BoardsService,
  type ContentService,
  type EconomyService,
  type IdentityService,
  type RunsService,
  type SessionService,
  type StoreEconomyService,
} from "../services";
import {
  type CampaignCatalog,
  type CampaignRealmContent,
  type DailyContent,
  type EconomyState,
  type IdentityState,
  type RunAction,
  type RunEvent,
  type RunFinishReason,
  type RunMode,
  type RunView,
  type SessionState,
  type StoreEconomyState,
  type TierTable,
  type WalletChoice,
} from "../views";
import {
  EconomyRejected,
  EconomyUnavailable,
  IdentityRejected,
  RunsRejected,
  RunsUnavailable,
} from "../errors";
import type { StorageLike } from "@/platform/storage";
import {
  localProductStorage,
  normalizeLocalName,
  type LocalProductState,
} from "./localPersistence";
import type { CampaignBilling, CampaignStoreAnswer } from "./storeBilling";
export const LOCAL_BACKEND_SENTINEL = "zkube_local_backend_v1";

const LOCAL_WALLET: WalletChoice = {
  id: "local",
  name: "Local player",
  platform: "browser",
};
const DEFAULT_SEED = new Uint8Array(32).fill(0x5a);
const LOCAL_DAILY_SEED = new TextEncoder().encode(
  "zkube-local-daily-row-seed-v1",
);
const DEFAULT_RULES_HASH = new Uint8Array(32).fill(0x33);
const DEFAULT_REPLAY_HASH = new Uint8Array(32).fill(0x42);

interface LocalRunRecord {
  readonly mode: RunMode;
  readonly runId: string;
  readonly realm: number;
  readonly level: number;
  readonly dayId?: number;
  readonly config: Uint8Array;
  readonly seed: Uint8Array;
  readonly events: SubscriptionRef.SubscriptionRef<RunEvent>;
  state: Uint8Array;
  requestCounter: number;
  recorded: boolean;
}

export interface LocalBackendOptions {
  readonly target: "store" | "playtest";
  readonly seed?: Uint8Array;
  readonly dailyVrfOutputs?: ReadonlyArray<Uint8Array>;
  readonly dailyConfig?: CoreRunConfigInput;
  readonly deadlineAfterAcceptedActions?: number;
  readonly ownerControls?: LocalOwnerControls;
  readonly storage?: StorageLike | null;
  readonly nowUnix?: () => number;
  readonly campaignBilling?: CampaignBilling;
  readonly onRuntimeStart?: () => void;
  readonly onRuntimeStop?: () => void;
}

export interface LocalOwnerControls {
  readonly seed: () => Uint8Array;
  readonly today: (nowUnix: number) => DailyContent;
  readonly subscribe: (listener: () => void) => () => void;
}

export async function localDailySeed(dayId: number): Promise<Uint8Array> {
  if (!Number.isInteger(dayId) || dayId < 0 || dayId > 0xffff_ffff) {
    throw new Error("local Daily day must be a u32");
  }
  const input = new Uint8Array(LOCAL_DAILY_SEED.length + 4);
  input.set(LOCAL_DAILY_SEED);
  new DataView(input.buffer).setUint32(LOCAL_DAILY_SEED.length, dayId, true);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

export async function localVrfOutput(
  seed: Uint8Array,
  counter: number,
): Promise<Uint8Array> {
  if (seed.length === 0) throw new Error("local row seed must not be empty");
  if (!Number.isInteger(counter) || counter < 1 || counter > 0xffff_ffff) {
    throw new Error("local row counter must be a positive u32");
  }
  const input = new Uint8Array(seed.length + 4);
  input.set(seed);
  new DataView(input.buffer).setUint32(seed.length, counter, true);
  return new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", input),
  );
}

export function localRowsFromVrf(args: {
  requestCounter: number;
  vrfOutput: Uint8Array;
  rulesHash: Uint8Array;
  weights: ReadonlyArray<number>;
}): { seedRow: number[]; previewRow: number[] } {
  return coreEmptyContinuationRows(args);
}

export async function localRowStream(args: {
  seed: Uint8Array;
  requestCounter: number;
  rulesHash: Uint8Array;
  weights: ReadonlyArray<number>;
}): Promise<{
  vrfOutput: Uint8Array;
  seedRow: number[];
  previewRow: number[];
}> {
  const vrfOutput = await localVrfOutput(args.seed, args.requestCounter);
  return {
    vrfOutput,
    ...localRowsFromVrf({ ...args, vrfOutput }),
  };
}

/** Local engine backend used by development and the explicitly flagged owner build. */
export function makeLocalBackendLive(
  options: LocalBackendOptions,
): Layer.Layer<
  Identity | Session | Runs | Content | Boards | Economy | StoreEconomy
> {
  return Layer.scopedContext(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => options.onRuntimeStart?.()),
        () => Effect.sync(() => options.onRuntimeStop?.()),
      );

      const persistence = localProductStorage(options.storage);
      const initialProduct = persistence.read();
      const identityRef = yield* SubscriptionRef.make<IdentityState>({
        status: "disconnected",
      });
      const sessionRef = yield* SubscriptionRef.make<SessionState>({
        status: "none",
        expiresAt: 0,
        floatLamports: 0n,
      });
      const catalog = defaultCatalog(options.target);
      const nowUnix = options.nowUnix ?? (() => Math.floor(Date.now() / 1_000));
      const synthesizeToday = () =>
        options.ownerControls
          ? localControlledToday(
              catalog,
              options.ownerControls.today(nowUnix()),
            )
          : defaultToday(catalog, nowUnix());
      const todayRef =
        yield* SubscriptionRef.make<DailyContent>(synthesizeToday());
      const economyRef = yield* SubscriptionRef.make<EconomyState>(
        localEconomy(initialProduct, options.target),
      );
      const storeEconomyRef = yield* SubscriptionRef.make<StoreEconomyState>(
        localStoreEconomy(initialProduct, options.target),
      );
      const activeRefs = {
        campaign: yield* SubscriptionRef.make<RunView | null>(null),
        arcade: yield* SubscriptionRef.make<RunView | null>(null),
      };
      const records = new Map<string, LocalRunRecord>();
      let nextRunId = 1n;

      const refreshToday = (force = false) =>
        Effect.gen(function* () {
          const previous = yield* SubscriptionRef.get(todayRef);
          const today = synthesizeToday();
          if (!force && previous.dayId === today.dayId) return previous;
          yield* SubscriptionRef.set(todayRef, today);
          return today;
        });

      const applyCampaignStoreAnswer = (answer: CampaignStoreAnswer) =>
        Effect.gen(function* () {
          const product = persistence.write((current) => ({
            ...current,
            campaignOwned: answer.campaignOwned,
            campaignPrice: answer.price,
          }));
          const state = localStoreEconomy(product, options.target);
          yield* SubscriptionRef.set(storeEconomyRef, state);
          return state;
        });

      const queryCampaignStore = () => {
        if (options.target !== "store" || !options.campaignBilling) {
          return Effect.fail(
            new EconomyUnavailable({
              message: "Campaign store is unavailable",
            }),
          );
        }
        return Effect.tryPromise({
          try: options.campaignBilling.queryCampaign,
          catch: (cause) =>
            new EconomyUnavailable({ message: errorMessage(cause) }),
        }).pipe(Effect.flatMap(applyCampaignStoreAnswer));
      };

      if (options.target === "store" && options.campaignBilling) {
        yield* queryCampaignStore().pipe(
          Effect.catchAll(() => Effect.void),
          Effect.forkScoped,
        );
      }

      if (options.ownerControls) {
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            options.ownerControls!.subscribe(() => {
              Effect.runFork(refreshToday(true));
            }),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        );
      }

      const localIdentity = (): IdentityState => ({
        status: "connected",
        ...(persistence.read().name ? { label: persistence.read().name! } : {}),
      });

      const liveLocalSession = (): SessionState => ({
        status: "live",
        expiresAt: Number.MAX_SAFE_INTEGER,
        floatLamports: 0n,
      });

      const identity: IdentityService = {
        wallets: () => Effect.succeed([]),
        connect: (walletId) =>
          walletId === LOCAL_WALLET.id
            ? Effect.all([
                SubscriptionRef.set(identityRef, localIdentity()),
                SubscriptionRef.set(sessionRef, liveLocalSession()),
              ]).pipe(Effect.asVoid)
            : Effect.fail(
                new IdentityRejected({
                  message: `Unknown local wallet ${walletId}`,
                }),
              ),
        reconnect: () =>
          persistence.read().name === null
            ? Effect.void
            : Effect.all([
                SubscriptionRef.set(identityRef, localIdentity()),
                SubscriptionRef.set(sessionRef, liveLocalSession()),
              ]).pipe(Effect.asVoid),
        disconnect: () =>
          SubscriptionRef.set(identityRef, { status: "disconnected" }),
        setLabel: (label) => {
          const normalized = normalizeLocalName(label);
          persistence.write((current) => ({ ...current, name: normalized }));
          return SubscriptionRef.update(identityRef, (state) => ({
            ...state,
            label: normalized,
          }));
        },
        state: identityRef.changes,
      };

      const session: SessionService = {
        ensure: () =>
          Effect.gen(function* () {
            const state: SessionState = {
              status: "live",
              expiresAt: Number.MAX_SAFE_INTEGER,
              floatLamports: 0n,
            };
            yield* SubscriptionRef.set(sessionRef, state);
            return state;
          }),
        fund: (lamports) =>
          SubscriptionRef.modify(sessionRef, (state) => {
            const next: SessionState = {
              ...state,
              floatLamports: state.floatLamports + lamports,
            };
            return [next, next];
          }),
        revoke: () =>
          SubscriptionRef.set(sessionRef, {
            status: "none",
            expiresAt: 0,
            floatLamports: 0n,
          } satisfies SessionState),
        state: sessionRef.changes,
      };

      const start = (
        mode: RunMode,
        realm: number,
        level: number,
        config: CoreRunConfigInput,
        seed?: Uint8Array,
        dayId?: number,
      ) =>
        Effect.gen(function* () {
          const runId = (nextRunId++).toString();
          const eventRef = yield* SubscriptionRef.make<RunEvent>({
            _tag: "Prepared",
          });
          const initialized = yield* Effect.try({
            try: () => {
              const builtConfig = coreBuildRunConfig(config);
              return {
                config: builtConfig,
                state: coreInitializeRun(builtConfig),
              };
            },
            catch: asRunsRejected,
          });
          const record: LocalRunRecord = {
            mode,
            runId,
            realm,
            level,
            dayId,
            config: initialized.config,
            state: initialized.state,
            seed:
              seed ??
              options.seed ??
              options.ownerControls?.seed() ??
              DEFAULT_SEED,
            requestCounter: 0,
            events: eventRef,
            recorded: false,
          };
          records.set(runId, record);
          yield* SubscriptionRef.set(eventRef, { _tag: "Delegated" });
          yield* applyNextRow(record, options);
          const view = runView(record);
          yield* SubscriptionRef.set(activeRefs[mode], view);
          return view;
        }).pipe(Effect.mapError(asRunsRejected));

      const runs: RunsService = {
        startCampaign: (realm, level) =>
          Effect.gen(function* () {
            const lock = localRealmLock(
              options.target,
              persistence.read(),
              realm,
            );
            if (lock !== null) {
              return yield* Effect.fail(
                new RunsRejected({
                  message:
                    lock === "purchase"
                      ? "Unlock the full Campaign first"
                      : "Defeat the previous guardian first",
                }),
              );
            }
            const config = yield* Effect.try({
              try: () => campaignConfig(catalog, realm, level),
              catch: asRunsRejected,
            });
            return yield* start("campaign", realm, level, config);
          }),
        enterDaily: () =>
          Effect.gen(function* () {
            yield* refreshToday();
            const today = yield* SubscriptionRef.get(todayRef);
            if (
              options.target === "store" &&
              persistence.read().dailyAttempt?.dayId === today.dayId
            ) {
              return yield* Effect.fail(
                new RunsRejected({
                  message: "Today's Daily challenge has already been played",
                }),
              );
            }
            const config = yield* Effect.try({
              try: () => options.dailyConfig ?? dailyConfig(catalog, today),
              catch: asRunsRejected,
            });
            const seed =
              options.target === "store"
                ? yield* Effect.promise(() => localDailySeed(today.dayId))
                : undefined;
            const view = yield* start("arcade", today.realm, 1, config, seed, today.dayId);
            if (options.target === "store") {
              const previous = persistence.read();
              const streak =
                previous.lastAttemptDayId === today.dayId - 1
                  ? previous.streak + 1
                  : 1;
              const product = persistence.write((current) => ({
                ...current,
                streak,
                lastAttemptDayId: today.dayId,
                dailyAttempt: {
                  dayId: today.dayId,
                  realm: today.realm,
                  objectiveKind: today.objective.kind,
                  objectiveValue: today.objective.value,
                  dailyScore: 0,
                  objectiveTotal: "0",
                  finished: false,
                },
              }));
              yield* SubscriptionRef.set(
                economyRef,
                localEconomy(product, options.target),
              );
            }
            return view;
          }),
        act: (runId, action) =>
          Effect.gen(function* () {
            const record = records.get(runId);
            if (!record) {
              return yield* Effect.fail(
                new RunsUnavailable({
                  message: `Local run ${runId} was not found`,
                }),
              );
            }
            const before = yield* Effect.try({
              try: () => coreRunSummary(record.state),
              catch: asRunsRejected,
            });
            record.state = yield* Effect.try({
              try: () => applyAction(record, action, before),
              catch: asRunsRejected,
            });
            const accepted: RunEvent = {
              _tag: "ActionAccepted",
              kind: actionKind(action),
              index: before.actionCounter,
              token: record.state,
            };
            yield* SubscriptionRef.set(record.events, accepted);
            const afterAction = coreRunSummary(record.state);
            if (afterAction.phase === "awaitingVrf") {
              if (action._tag === "Reroll") {
                yield* SubscriptionRef.set(record.events, {
                  _tag: "RerollPending",
                });
              }
              yield* applyNextRow(record, options);
            }
            if (
              options.deadlineAfterAcceptedActions !== undefined &&
              coreRunSummary(record.state).actionCounter >=
                options.deadlineAfterAcceptedActions &&
              coreRunSummary(record.state).phase !== "finished"
            ) {
              record.state = yield* Effect.try({
                try: () =>
                  coreFinishRun(record.config, record.state, "deadline"),
                catch: asRunsRejected,
              });
            }
            const summary = coreRunSummary(record.state);
            const terminal =
              summary.phase === "finished" || summary.phase === "levelComplete";
            const view = runView(record);
            yield* SubscriptionRef.update(
              activeRefs[record.mode],
              (current) => current?.runId === record.runId ? (terminal ? null : view) : current,
            );
            if (terminal) {
              if (!record.recorded) {
                record.recorded = true;
                if (record.mode === "arcade") {
                  if (options.target === "store") {
                    const product = persistence.write((current) => ({
                      ...current,
                      bestDailyScore: Math.max(
                        current.bestDailyScore,
                        summary.dailyScore,
                      ),
                      dailyAttempt: current.dailyAttempt && current.dailyAttempt.dayId === record.dayId
                        ? {
                            ...current.dailyAttempt,
                            dailyScore: summary.dailyScore,
                            objectiveTotal: summary.objectiveTotal.toString(),
                            finished: true,
                          }
                        : current.dailyAttempt,
                    }));
                    yield* SubscriptionRef.set(
                      economyRef,
                      localEconomy(product, options.target),
                    );
                  }
                } else {
                  const earned = countStarSources(summary.latchedStarSources);
                  const starIndex = (record.realm - 1) * 10 + record.level - 1;
                  const product = persistence.write((current) => ({
                    ...current,
                    stars: current.stars.map((value, index) =>
                      index === starIndex ? Math.max(value, earned) : value,
                    ),
                  }));
                  yield* SubscriptionRef.set(
                    economyRef,
                    localEconomy(product, options.target),
                  );
                }
              }
              yield* SubscriptionRef.set(record.events, {
                _tag: "Finished",
                reason: finishReason(summary.phase, summary.endReason),
              });
            }
            return view;
          }).pipe(Effect.mapError(asRunsRejected)),
        resume: (mode) => SubscriptionRef.get(activeRefs[mode]),
        spectate: (_address, mode) => SubscriptionRef.get(activeRefs[mode]),
        active: (mode) => SubscriptionRef.get(activeRefs[mode]),
        events: (runId) => {
          const record = records.get(runId);
          return record
            ? record.events.changes
            : Stream.fail(
                new RunsUnavailable({
                  message: `Local run ${runId} was not found`,
                }),
              );
        },
      };

      const content: ContentService = {
        today: () => refreshToday(),
        catalog: () => Effect.succeed(catalog),
        tierTable: () => Effect.succeed(defaultTierTable()),
        todayChanges: Stream.merge(
          todayRef.changes,
          Stream.repeatEffectWithSchedule(
            refreshToday(),
            Schedule.spaced("30 seconds"),
          ),
        ).pipe(Stream.changes),
      };

      const boards: BoardsService = {
        boards: () => Effect.succeed([]),
        yourRows: () => Effect.succeed([]),
        watch: () => Stream.empty,
      };

      const economy: EconomyService = {
        buy: (pack) =>
          SubscriptionRef.modify(economyRef, (state) => {
            const next = { ...state, kredits: state.kredits + BigInt(pack) };
            return [next, next];
          }),
        claim: (dayId, board) =>
          SubscriptionRef.modify(economyRef, (state) => {
            const next = {
              ...state,
              claimable: state.claimable.filter(
                (reward) => reward.dayId !== dayId || reward.board !== board,
              ),
            };
            return [next, next];
          }),
        setWorn: (emblem) =>
          Effect.sync(() =>
            persistence.write((current) => ({
              ...current,
              wornEmblem: emblem,
            })),
          ).pipe(
            Effect.flatMap((product) => {
              const next = localEconomy(product, options.target);
              return SubscriptionRef.set(economyRef, next).pipe(
                Effect.as(next),
              );
            }),
          ),
        state: economyRef.changes,
      };

      const fullCampaignState: StoreEconomyState = {
        campaignOwned: true,
        price: null,
      };
      const storeEconomy: StoreEconomyService =
        options.target === "playtest"
          ? {
              unlockCampaign: () => Effect.succeed(fullCampaignState),
              restorePurchases: () => Effect.succeed(fullCampaignState),
              state: Stream.succeed(fullCampaignState),
            }
          : {
              unlockCampaign: () =>
                Effect.gen(function* () {
                  if (!options.campaignBilling) {
                    return yield* Effect.fail(
                      new EconomyUnavailable({
                        message: "Campaign store is unavailable",
                      }),
                    );
                  }
                  yield* Effect.tryPromise({
                    try: options.campaignBilling.purchaseCampaign,
                    catch: (cause) =>
                      new EconomyRejected({ message: errorMessage(cause) }),
                  });
                  return yield* queryCampaignStore();
                }),
              restorePurchases: () =>
                Effect.gen(function* () {
                  if (!options.campaignBilling) {
                    return yield* Effect.fail(
                      new EconomyUnavailable({
                        message: "Campaign store is unavailable",
                      }),
                    );
                  }
                  yield* Effect.tryPromise({
                    try: options.campaignBilling.restorePurchases,
                    catch: (cause) =>
                      new EconomyRejected({ message: errorMessage(cause) }),
                  });
                  return yield* queryCampaignStore();
                }),
              state: storeEconomyRef.changes,
            };

      return Context.mergeAll(
        Context.make(Identity, identity),
        Context.make(Session, session),
        Context.make(Runs, runs),
        Context.make(Content, content),
        Context.make(Boards, boards),
        Context.make(Economy, economy),
        Context.make(StoreEconomy, storeEconomy),
      );
    }),
  );
}

function applyAction(
  record: LocalRunRecord,
  action: RunAction,
  summary: ReturnType<typeof coreRunSummary>,
): Uint8Array {
  switch (action._tag) {
    case "Move":
      return corePlayRunMove({
        config: record.config,
        state: record.state,
        action: summary.actionCounter,
        expectedMove: summary.moves,
        row: action.row,
        start: action.start,
        destination: action.destination,
      });
    case "Bonus":
      return coreApplyRunBonus({
        config: record.config,
        state: record.state,
        action: summary.actionCounter,
        row: action.row,
        column: action.column,
      });
    case "Reroll":
      return coreRequestRunReroll(
        record.config,
        record.state,
        summary.actionCounter,
      );
    case "Finish":
      return coreFinishRun(record.config, record.state, action.reason);
  }
}

function actionKind(action: RunAction): "move" | "bonus" | "reroll" | "finish" {
  switch (action._tag) {
    case "Move":
      return "move";
    case "Bonus":
      return "bonus";
    case "Reroll":
      return "reroll";
    case "Finish":
      return "finish";
  }
}

function applyNextRow(record: LocalRunRecord, options: LocalBackendOptions) {
  return Effect.tryPromise({
    try: async () => {
      record.requestCounter += 1;
      const prescribed =
        record.mode === "arcade"
          ? options.dailyVrfOutputs?.[record.requestCounter - 1]
          : undefined;
      const output =
        prescribed ??
        (await localVrfOutput(record.seed, record.requestCounter));
      record.state = coreApplyRunVrf({
        config: record.config,
        state: record.state,
        requestCounter: record.requestCounter,
        vrfOutput: output,
      });
    },
    catch: asRunsRejected,
  }).pipe(
    Effect.andThen(
      SubscriptionRef.set(record.events, {
        _tag: "RowReady",
      }),
    ),
  );
}

function runView(record: LocalRunRecord): RunView {
  const summary = coreRunSummary(record.state);
  const terminal =
    summary.phase === "finished" || summary.phase === "levelComplete";
  return {
    mode: record.mode,
    runId: record.runId,
    token: record.state,
    phase: summary.phase,
    deadlineAt:
      record.mode === "arcade"
        ? Math.floor(Date.now() / 1_000) + 86_400
        : undefined,
    finishReason: terminal
      ? finishReason(summary.phase, summary.endReason)
      : undefined,
  };
}

function finishReason(phase: string, endReason: number): RunFinishReason {
  if (phase === "levelComplete") return "levelComplete";
  if (endReason === 2) return "overflow";
  if (endReason === 3) return "abandon";
  if (endReason === 4) return "deadline";
  return "moveBudget";
}

function asRunsRejected(cause: unknown): RunsRejected {
  return cause instanceof RunsRejected
    ? cause
    : new RunsRejected({
        message: cause instanceof Error ? cause.message : String(cause),
      });
}

function dailyConfig(
  catalog: CampaignCatalog,
  today: DailyContent,
): CoreRunConfigInput {
  const realm = requireRealm(catalog, today.realm);
  return {
    mode: "daily",
    rulesHash: DEFAULT_RULES_HASH,
    initialReplay: DEFAULT_REPLAY_HASH,
    maxMoves: DAILY_MAX_MOVES,
    bonusType: realm.guardian.bonus,
    trigger: realm.guardian.trigger,
    triggerThreshold: realm.guardian.threshold,
    startingHeight: realm.startingHeight,
    fixedTier: 0,
    pointsRequired: 0,
    primary: { kind: 0, value: 0, requiredCount: 0 },
    secondary: { kind: 0, value: 0, requiredCount: 0 },
    objective: {
      kind: today.objective.kind,
      value: today.objective.value,
      requiredCount: 0,
    },
  };
}

function campaignConfig(
  catalog: CampaignCatalog,
  realmId: number,
  levelNumber: number,
): CoreRunConfigInput {
  const realm = requireRealm(catalog, realmId);
  const level = realm.levels[levelNumber - 1];
  if (!level || level.level !== levelNumber) {
    throw new Error(`Campaign level ${realmId}.${levelNumber} is not authored`);
  }
  return {
    mode: "campaign",
    rulesHash: DEFAULT_RULES_HASH,
    initialReplay: DEFAULT_REPLAY_HASH,
    maxMoves: level.moveBudget,
    bonusType: realm.guardian.bonus,
    trigger: realm.guardian.trigger,
    triggerThreshold: realm.guardian.threshold,
    startingHeight: realm.startingHeight,
    fixedTier: level.tier,
    pointsRequired: level.target,
    primary: { ...level.primary },
    secondary: { ...level.secondary },
    objective: { kind: 0, value: 0, requiredCount: 0 },
  };
}

function defaultToday(catalog: CampaignCatalog, nowUnix: number): DailyContent {
  const dayId = currentDailyDayId(nowUnix);
  const pair = dailyContentFromPairIndex(
    dayId,
    coreProtocol.dailyPairIndex(dayId),
  );
  const realm = requireRealm(catalog, pair.realmMapId);
  return {
    dayId,
    realm: pair.realmMapId,
    objective: { ...pair.objective },
    startingHeight: realm.startingHeight,
    opensAt: dayId * 86_400,
    freezesAt: (dayId + 1) * 86_400,
    suspended: false,
  };
}

function defaultCatalog(
  target: LocalBackendOptions["target"],
): CampaignCatalog {
  return {
    contentVersion: CAMPAIGN_CATALOG.contentVersion,
    realms: CAMPAIGN_CATALOG.maps.map((map) => {
      const [bonus, trigger, threshold, startingHeight] = map.rules;
      return {
        realm: map.mapId,
        theme: map.mapId,
        locked:
          target === "playtest"
            ? null
            : map.mapId >= 4
              ? "purchase"
              : map.mapId === 1
                ? null
                : "stars",
        guardian: { bonus, trigger, threshold },
        startingHeight,
        levels: map.levels.map(([tier, primary, secondary], index) => {
          const level = index + 1;
          const target = CAMPAIGN_TARGET_LADDER[index];
          if (target === undefined)
            throw new Error(`Campaign level ${level} has no target`);
          return {
            level,
            tier,
            target,
            moveBudget: coreCampaignMoveBudget(level, tier),
            primary: {
              kind: primary[0],
              value: primary[1],
              requiredCount: primary[2],
            },
            secondary: {
              kind: secondary[0],
              value: secondary[1],
              requiredCount: secondary[2],
            },
          };
        }),
      };
    }),
  };
}

function defaultTierTable(): TierTable {
  return {
    pressureStep: PRESSURE_STEP,
    blockWeights: TIER_BLOCK_WEIGHTS.map((weights) => [...weights]),
  };
}

function localEconomy(
  product: LocalProductState,
  target: LocalBackendOptions["target"],
): EconomyState {
  const emptyRecord = {
    bestPrizeRank: 0,
    podiums: 0,
    wins: 0,
    rewardsLamports: 0n,
  };
  return {
    kredits: target === "playtest" ? 25n : 0n,
    claimable: [],
    profile: {
      stars: [...product.stars],
      ladderPoints: 0n,
      ladderTier: 0,
      highestTier: 0,
      wornEmblem: product.wornEmblem,
      wornBorder: 0,
      records: { score: emptyRecord, theme: emptyRecord },
      streak: product.streak,
      bestScore: product.bestDailyScore,
      ...(product.dailyAttempt
        ? {
            dailyAttempt: {
              dayId: product.dailyAttempt.dayId,
              realm: product.dailyAttempt.realm,
              objective: {
                kind: product.dailyAttempt.objectiveKind,
                value: product.dailyAttempt.objectiveValue,
              },
              dailyScore: product.dailyAttempt.dailyScore,
              objectiveTotal: BigInt(product.dailyAttempt.objectiveTotal),
              finished: product.dailyAttempt.finished,
            },
          }
        : {}),
    },
  };
}

function localStoreEconomy(
  product: LocalProductState,
  target: LocalBackendOptions["target"],
): StoreEconomyState {
  return target === "playtest"
    ? { campaignOwned: true, price: null }
    : {
        campaignOwned: product.campaignOwned,
        price: product.campaignPrice,
      };
}

function localRealmLock(
  target: LocalBackendOptions["target"],
  product: LocalProductState,
  realm: number,
): null | "stars" | "purchase" {
  if (target === "playtest") return null;
  if (realm >= 4 && !product.campaignOwned) return "purchase";
  if (realm > 1 && (product.stars[(realm - 1) * 10 - 1] ?? 0) === 0) {
    return "stars";
  }
  return null;
}

function localControlledToday(
  catalog: CampaignCatalog,
  today: DailyContent,
): DailyContent {
  const realm = requireRealm(catalog, today.realm);
  return { ...today, startingHeight: realm.startingHeight };
}

function requireRealm(
  catalog: CampaignCatalog,
  realmId: number,
): CampaignRealmContent {
  const realm = catalog.realms.find((candidate) => candidate.realm === realmId);
  if (!realm) throw new Error(`Campaign realm ${realmId} is not authored`);
  return realm;
}

function countStarSources(mask: number): number {
  return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
