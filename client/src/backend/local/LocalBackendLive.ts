import {
  Context,
  Effect,
  Layer,
  Stream,
  SubscriptionRef,
} from "effect";

import {
  coreApplyRunBonus,
  coreApplyRunVrf,
  coreBuildRunConfig,
  coreEmptyContinuationRows,
  coreFinishRun,
  coreInitializeRun,
  corePlayRunMove,
  coreRequestRunReroll,
  coreRunSummary,
  type CoreRunConfigInput,
} from "@/core/zkubeCore";
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
  readonly config: Uint8Array;
  readonly seed: Uint8Array;
  readonly events: SubscriptionRef.SubscriptionRef<RunEvent>;
  state: Uint8Array;
  requestCounter: number;
}

export interface LocalBackendOptions {
  readonly seed?: Uint8Array;
  readonly dailyVrfOutputs?: ReadonlyArray<Uint8Array>;
  readonly dailyConfig?: CoreRunConfigInput;
  readonly deadlineAfterAcceptedActions?: number;
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
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input));
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

/** Dev-only backend. Production imports no symbol from this module. */
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
      const todayRef = yield* SubscriptionRef.make<DailyContent>(defaultToday());
      const economyRef = yield* SubscriptionRef.make<EconomyState>(defaultEconomy());
      const scoreBoardRef = yield* SubscriptionRef.make<BoardState>(
        defaultBoard("score"),
      );
      const themeBoardRef = yield* SubscriptionRef.make<BoardState>(
        defaultBoard("theme"),
      );
      const activeRefs = {
        campaign: yield* SubscriptionRef.make<RunView | null>(null),
        arcade: yield* SubscriptionRef.make<RunView | null>(null),
      };
      const records = new Map<string, LocalRunRecord>();
      let nextRunId = 1n;

      const identity: IdentityService = {
        wallets: () => Effect.succeed([LOCAL_WALLET]),
        connect: (walletId) =>
          walletId === LOCAL_WALLET.id
            ? SubscriptionRef.set(identityRef, {
                status: "connected",
                address: LOCAL_ADDRESS,
                label: "Local Player",
                wallet: LOCAL_WALLET,
              })
            : Effect.fail(
                new IdentityRejected({
                  message: `Unknown local wallet ${walletId}`,
                }),
              ),
        reconnect: () =>
          SubscriptionRef.set(identityRef, {
            status: "connected",
            address: LOCAL_ADDRESS,
            label: "Local Player",
            wallet: LOCAL_WALLET,
          }),
        disconnect: () =>
          SubscriptionRef.set(identityRef, { status: "disconnected" }),
        setLabel: (label) =>
          SubscriptionRef.update(identityRef, (state) => ({
            ...state,
            label,
          })),
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
            const next = {
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
          }),
        state: sessionRef.changes,
      };

      const start = (mode: RunMode, config: CoreRunConfigInput) =>
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
            config: initialized.config,
            state: initialized.state,
            seed: options.seed ?? DEFAULT_SEED,
            requestCounter: 0,
            events: eventRef,
          };
          records.set(runId, record);
          yield* SubscriptionRef.set(eventRef, { _tag: "Delegated" });
          yield* applyNextRow(record, options);
          const view = runView(record);
          yield* SubscriptionRef.set(activeRefs[mode], view);
          return view;
        }).pipe(Effect.mapError(asRunsRejected));

      const runs: RunsService = {
        startCampaign: () => start("campaign", campaignConfig()),
        enterDaily: () =>
          Effect.gen(function* () {
            yield* SubscriptionRef.update(economyRef, (state) => ({
              ...state,
              kredits: state.kredits > 0n ? state.kredits - 1n : 0n,
              claimable: [],
            }));
            return yield* start(
              "arcade",
              options.dailyConfig ?? dailyConfig(),
            );
          }),
        act: (runId, action) =>
          Effect.gen(function* () {
            const record = records.get(runId);
            if (!record) {
              return yield* Effect.fail(
                new RunsUnavailable({ message: `Local run ${runId} was not found` }),
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
            if (summary.phase === "finished" || summary.phase === "levelComplete") {
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
                new RunsUnavailable({ message: `Local run ${runId} was not found` }),
              );
        },
      };

      const content: ContentService = {
        today: () => SubscriptionRef.get(todayRef),
        catalog: () => Effect.succeed(defaultCatalog()),
        tierTable: () => Effect.succeed(defaultTierTable()),
        todayChanges: todayRef.changes,
      };

      const boardRefs = [scoreBoardRef, themeBoardRef] as const;
      const boards: BoardsService = {
        boards: (dayId) =>
          Effect.all(boardRefs.map(SubscriptionRef.get)).pipe(
            Effect.map((states) => states.filter((state) => state.dayId === dayId)),
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
        prescribed ?? (await localVrfOutput(record.seed, record.requestCounter));
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
  const terminal = summary.phase === "finished" || summary.phase === "levelComplete";
  return {
    mode: record.mode,
    runId: record.runId,
    token: record.state,
    phase: summary.phase,
    deadlineAt:
      record.mode === "arcade" ? Math.floor(Date.now() / 1_000) + 86_400 : undefined,
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

function dailyConfig(): CoreRunConfigInput {
  return {
    mode: "daily",
    rulesHash: DEFAULT_RULES_HASH,
    initialReplay: DEFAULT_REPLAY_HASH,
    maxMoves: 100,
    bonusType: 3,
    trigger: 0,
    triggerThreshold: 0,
    startingHeight: 4,
    fixedTier: 0,
    pointsRequired: 0,
    primary: { kind: 0, value: 0, requiredCount: 0 },
    secondary: { kind: 0, value: 0, requiredCount: 0 },
    objective: { kind: 0, value: 0, requiredCount: 0 },
  };
}

function campaignConfig(): CoreRunConfigInput {
  return {
    ...dailyConfig(),
    mode: "campaign",
    maxMoves: 20,
    pointsRequired: 10,
    primary: { kind: 3, value: 0, requiredCount: 2 },
    secondary: { kind: 14, value: 4, requiredCount: 1 },
  };
}

function defaultToday(): DailyContent {
  return {
    dayId: 0,
    realm: 1,
    objective: { kind: 0, value: 0 },
    startingHeight: 4,
    opensAt: 0,
    freezesAt: 86_399,
    suspended: false,
  };
}

function defaultCatalog(): CampaignCatalog {
  return { contentVersion: 0, realms: [] };
}

function defaultTierTable(): TierTable {
  return {
    pressureStep: 15,
    blockWeights: [
      [16, 20, 22, 24, 18],
      [15, 19, 22, 25, 19],
      [14, 18, 22, 26, 20],
      [13, 17, 22, 27, 21],
      [12, 16, 22, 28, 22],
      [11, 15, 22, 29, 23],
      [10, 14, 22, 30, 24],
      [9, 13, 22, 31, 25],
    ],
  };
}

function defaultBoard(kind: BoardKind): BoardState {
  const row: BoardRow = {
    address: LOCAL_ADDRESS,
    label: "Local Player",
    emblem: 0,
    tier: 0,
    metric: 0n,
    rank: 1,
    payoutLamports: 0n,
  };
  return {
    dayId: 0,
    kind,
    status: "open",
    potLamports: 0n,
    rows: [],
    yourRow: row,
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
