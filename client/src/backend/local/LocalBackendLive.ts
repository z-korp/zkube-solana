import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";

import {
  coreCampaignMoveBudget,
  coreApplyRunBonus,
  coreApplyRunVrf,
  coreBuildRunConfig,
  coreDailyBoardPools,
  coreEmptyContinuationRows,
  coreFinishRun,
  coreInitializeRun,
  corePlayRunMove,
  coreRankPayoutPlan,
  coreRequestRunReroll,
  coreRunSummary,
  type CoreRunConfigInput,
} from "@/core/zkubeCore";
import { CAMPAIGN_CATALOG } from "@/core/campaignCatalog.generated";
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
  type BoardsService,
  type ContentService,
  type EconomyService,
  type IdentityService,
  type RunsService,
  type SessionService,
} from "../services";
import {
  PlayerAddress,
  type BoardKind,
  type BoardRow,
  type BoardState,
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
  type TierTable,
  type WalletChoice,
} from "../views";
import { IdentityRejected, RunsRejected, RunsUnavailable } from "../errors";
import {
  playtestSeed,
  playtestToday,
  readPlaytestName,
  storePlaytestName,
  subscribePlaytestSettings,
} from "./playtest";

export const LOCAL_BACKEND_SENTINEL = "zkube_local_backend_v1";

const LOCAL_ADDRESS = PlayerAddress.make("local:zkube-player");
const LOCAL_WALLET: WalletChoice = {
  id: "local",
  name: "Local playtest",
  platform: "browser",
};
const DEFAULT_SEED = new Uint8Array(32).fill(0x5a);
const DEFAULT_RULES_HASH = new Uint8Array(32).fill(0x33);
const DEFAULT_REPLAY_HASH = new Uint8Array(32).fill(0x42);

interface LocalRunRecord {
  readonly mode: RunMode;
  readonly runId: string;
  readonly realm: number;
  readonly level: number;
  readonly config: Uint8Array;
  readonly seed: Uint8Array;
  readonly events: SubscriptionRef.SubscriptionRef<RunEvent>;
  state: Uint8Array;
  requestCounter: number;
  recorded: boolean;
}

interface LocalDailyAttempt {
  readonly runId: string;
  readonly dailyScore: bigint;
  readonly objectiveTotal: bigint;
}

export interface LocalBackendOptions {
  readonly seed?: Uint8Array;
  readonly dailyVrfOutputs?: ReadonlyArray<Uint8Array>;
  readonly dailyConfig?: CoreRunConfigInput;
  readonly deadlineAfterAcceptedActions?: number;
  readonly playtest?: boolean;
  readonly onRuntimeStart?: () => void;
  readonly onRuntimeStop?: () => void;
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
  options: LocalBackendOptions = {},
): Layer.Layer<Identity | Session | Runs | Content | Boards | Economy> {
  return Layer.scopedContext(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => options.onRuntimeStart?.()),
        () => Effect.sync(() => options.onRuntimeStop?.()),
      );

      const identityRef = yield* SubscriptionRef.make<IdentityState>({
        status: "disconnected",
      });
      const sessionRef = yield* SubscriptionRef.make<SessionState>({
        status: "none",
        expiresAt: 0,
        floatLamports: 0n,
      });
      const catalog = defaultCatalog();
      const todayRef = yield* SubscriptionRef.make<DailyContent>(
        options.playtest ? localPlaytestToday(catalog) : defaultToday(catalog),
      );
      const economyRef =
        yield* SubscriptionRef.make<EconomyState>(defaultEconomy());
      const initialToday = yield* SubscriptionRef.get(todayRef);
      const initialBoards = rankedLocalBoards(initialToday.dayId, []);
      const scoreBoardRef = yield* SubscriptionRef.make<BoardState>(
        initialBoards.score,
      );
      const themeBoardRef = yield* SubscriptionRef.make<BoardState>(
        initialBoards.theme,
      );
      const activeRefs = {
        campaign: yield* SubscriptionRef.make<RunView | null>(null),
        arcade: yield* SubscriptionRef.make<RunView | null>(null),
      };
      const records = new Map<string, LocalRunRecord>();
      const dailyAttempts: LocalDailyAttempt[] = [];
      let nextRunId = 1n;

      if (options.playtest) {
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            subscribePlaytestSettings(() => {
              const today = localPlaytestToday(catalog);
              dailyAttempts.length = 0;
              const boards = rankedLocalBoards(today.dayId, dailyAttempts);
              Effect.runFork(
                Effect.all([
                  SubscriptionRef.set(todayRef, today),
                  SubscriptionRef.set(scoreBoardRef, boards.score),
                  SubscriptionRef.set(themeBoardRef, boards.theme),
                ]),
              );
            }),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        );
      }

      const localIdentity = (): IdentityState => ({
        status: "connected",
        address: LOCAL_ADDRESS,
        label: (options.playtest ? readPlaytestName() : null) ?? "Local Player",
        wallet: LOCAL_WALLET,
      });

      const identity: IdentityService = {
        wallets: () => Effect.succeed([LOCAL_WALLET]),
        connect: (walletId) =>
          walletId === LOCAL_WALLET.id
            ? SubscriptionRef.set(identityRef, localIdentity())
            : Effect.fail(
                new IdentityRejected({
                  message: `Unknown local wallet ${walletId}`,
                }),
              ),
        reconnect: () =>
          options.playtest && readPlaytestName() === null
            ? Effect.void
            : SubscriptionRef.set(identityRef, localIdentity()),
        disconnect: () =>
          SubscriptionRef.set(identityRef, { status: "disconnected" }),
        setLabel: (label) => {
          const normalized = options.playtest
            ? storePlaytestName(label)
            : label;
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
              expiresAt: Math.floor(Date.now() / 1_000) + 7 * 86_400,
              floatLamports: 10_000_000n,
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
            config: initialized.config,
            state: initialized.state,
            seed:
              options.seed ??
              (options.playtest ? playtestSeed() : DEFAULT_SEED),
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
          Effect.try({
            try: () => campaignConfig(catalog, realm, level),
            catch: asRunsRejected,
          }).pipe(
            Effect.flatMap((config) => start("campaign", realm, level, config)),
          ),
        enterDaily: () =>
          Effect.gen(function* () {
            yield* SubscriptionRef.update(economyRef, (state) => ({
              ...state,
              kredits: state.kredits > 0n ? state.kredits - 1n : 0n,
              claimable: [],
            }));
            const today = options.playtest
              ? localPlaytestToday(catalog)
              : yield* SubscriptionRef.get(todayRef);
            const config = yield* Effect.try({
              try: () => options.dailyConfig ?? dailyConfig(catalog, today),
              catch: asRunsRejected,
            });
            return yield* start("arcade", today.realm, 1, config);
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
            const view = runView(record);
            yield* SubscriptionRef.set(activeRefs[record.mode], view);
            const summary = coreRunSummary(record.state);
            if (
              summary.phase === "finished" ||
              summary.phase === "levelComplete"
            ) {
              if (!record.recorded) {
                record.recorded = true;
                if (record.mode === "arcade") {
                  dailyAttempts.push({
                    runId: record.runId,
                    dailyScore: BigInt(summary.dailyScore),
                    objectiveTotal: summary.objectiveTotal,
                  });
                  const today = yield* SubscriptionRef.get(todayRef);
                  const localBoards = rankedLocalBoards(
                    today.dayId,
                    dailyAttempts,
                  );
                  yield* SubscriptionRef.set(scoreBoardRef, localBoards.score);
                  yield* SubscriptionRef.set(themeBoardRef, localBoards.theme);
                } else {
                  const earned = countStarSources(summary.latchedStarSources);
                  const starIndex = (record.realm - 1) * 10 + record.level - 1;
                  yield* SubscriptionRef.update(economyRef, (state) => ({
                    ...state,
                    profile: {
                      ...state.profile,
                      stars: state.profile.stars.map((value, index) =>
                        index === starIndex ? Math.max(value, earned) : value,
                      ),
                    },
                  }));
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
        today: () => SubscriptionRef.get(todayRef),
        catalog: () => Effect.succeed(catalog),
        tierTable: () => Effect.succeed(defaultTierTable()),
        todayChanges: todayRef.changes,
      };

      const boardRefs = [scoreBoardRef, themeBoardRef] as const;
      const boards: BoardsService = {
        boards: (dayId) =>
          Effect.all(boardRefs.map(SubscriptionRef.get)).pipe(
            Effect.map((states) =>
              states.filter((state) => state.dayId === dayId),
            ),
          ),
        yourRows: (dayId) =>
          Effect.all(boardRefs.map(SubscriptionRef.get)).pipe(
            Effect.map((states) =>
              states.flatMap((state) =>
                state.dayId === dayId && state.yourRow ? [state.yourRow] : [],
              ),
            ),
          ),
        watch: (dayId) =>
          Stream.merge(scoreBoardRef.changes, themeBoardRef.changes).pipe(
            Stream.filter((state) => state.dayId === dayId),
          ),
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
        setWorn: (emblem, border) =>
          SubscriptionRef.modify(economyRef, (state) => {
            const next = {
              ...state,
              profile: {
                ...state.profile,
                wornEmblem: emblem,
                wornBorder: border,
              },
            };
            return [next, next];
          }),
        state: economyRef.changes,
      };

      return Context.mergeAll(
        Context.make(Identity, identity),
        Context.make(Session, session),
        Context.make(Runs, runs),
        Context.make(Content, content),
        Context.make(Boards, boards),
        Context.make(Economy, economy),
      );
    }),
  );
}

export const LocalBackendLive = makeLocalBackendLive();

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

function defaultToday(catalog: CampaignCatalog): DailyContent {
  const now = Math.floor(Date.now() / 1_000);
  const realm = requireRealm(catalog, 1);
  return {
    dayId: 0,
    realm: 1,
    objective: { kind: 0, value: 0 },
    startingHeight: realm.startingHeight,
    opensAt: now - 60,
    freezesAt: now + 7 * 86_400,
    suspended: false,
  };
}

function defaultCatalog(): CampaignCatalog {
  return {
    contentVersion: CAMPAIGN_CATALOG.contentVersion,
    realms: CAMPAIGN_CATALOG.maps.map((map) => {
      const [bonus, trigger, threshold, startingHeight] = map.rules;
      return {
        realm: map.mapId,
        theme: map.mapId,
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

function defaultEconomy(): EconomyState {
  const emptyRecord = {
    bestPrizeRank: 0,
    podiums: 0,
    wins: 0,
    rewardsLamports: 0n,
  };
  return {
    kredits: 25n,
    claimable: [],
    profile: {
      stars: Array<number>(100).fill(0),
      ladderPoints: 0n,
      ladderTier: 0,
      highestTier: 0,
      wornEmblem: 0,
      wornBorder: 0,
      records: { score: emptyRecord, theme: emptyRecord },
      streak: 0,
      bestScore: 0,
    },
  };
}

function localPlaytestToday(catalog: CampaignCatalog): DailyContent {
  const today = playtestToday();
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

function rankedLocalBoards(
  dayId: number,
  attempts: ReadonlyArray<LocalDailyAttempt>,
): { score: BoardState; theme: BoardState } {
  const score = attempts
    .filter((attempt) => attempt.dailyScore > 0n)
    .map((attempt) => ({ attempt, metric: attempt.dailyScore }));
  const theme = attempts
    .filter((attempt) => attempt.objectiveTotal > 0n)
    .map((attempt) => ({ attempt, metric: attempt.objectiveTotal }));
  const pools = coreDailyBoardPools(10_000_000_000n, theme.length);
  return {
    score: rankedLocalBoard(dayId, "score", pools.score, score),
    theme: rankedLocalBoard(dayId, "theme", pools.theme, theme),
  };
}

function rankedLocalBoard(
  dayId: number,
  kind: BoardKind,
  potLamports: bigint,
  entries: ReadonlyArray<{
    readonly attempt: LocalDailyAttempt;
    readonly metric: bigint;
  }>,
): BoardState {
  const ranked = [...entries].sort(
    (left, right) =>
      Number(right.metric - left.metric) ||
      Number(BigInt(left.attempt.runId) - BigInt(right.attempt.runId)),
  );
  const payouts =
    ranked.length === 0 || potLamports === 0n
      ? []
      : coreRankPayoutPlan(potLamports, ranked.length, ranked.length).payouts;
  const rows = ranked
    .slice(0, payouts.length)
    .map(({ attempt, metric }, index) => ({
      address: PlayerAddress.make(`local:attempt:${attempt.runId}`),
      label: `Attempt ${attempt.runId}`,
      emblem: 0,
      tier: 0,
      metric,
      rank: index + 1,
      payoutLamports: payouts[index] ?? 0n,
    }));
  const latestAttempt = entries[entries.length - 1]?.attempt;
  const latest = ranked.find(({ attempt }) => attempt === latestAttempt);
  const latestIndex = latest ? ranked.indexOf(latest) : -1;
  const yourRow: BoardRow | undefined = latest
    ? {
        address: LOCAL_ADDRESS,
        label: "Latest attempt",
        emblem: 0,
        tier: 0,
        metric: latest.metric,
        rank: latestIndex + 1,
        payoutLamports: payouts[latestIndex] ?? 0n,
      }
    : undefined;
  return {
    dayId,
    kind,
    status: "open",
    potLamports,
    rows,
    ...(yourRow ? { yourRow } : {}),
  };
}
