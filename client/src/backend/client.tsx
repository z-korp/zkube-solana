/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Effect, Stream } from "effect";

import { campaignGuardianPresentation } from "@/core/campaignCatalog";
import type { ActiveRunRulesView } from "@/core/runProjection";
import {
  DAILY_MAX_MOVES,
  ARENA_ENTRY_LAMPORTS,
} from "@/core/protocolVersions.generated";
import { coreRunSummary } from "@/core/zkubeCore";
import { appStorage } from "@/platform/storage";
import { subscribeNativeResume } from "@/platform/nativeShell";
import { useNavigationStore } from "@/stores/navigationStore";
import { errorMessage } from "@/utils/errors";
import { useBackendRuntime } from "./runtime";
import { Boards, Content, Economy, Identity, Runs, Session } from "./services";
import { PlayerAddress } from "./views";
import type {
  BoardState,
  CampaignCatalog,
  CampaignRealmContent,
  DailyContent,
  EconomyState,
  IdentityState,
  RunAction,
  RunMode,
  RunView,
  SessionState,
  WalletChoice,
} from "./views";

export type SettleStage =
  | "preparing"
  | "committing"
  | "settling"
  | "consuming"
  | "cleaning"
  | "abandoning";

export interface ClientRunView {
  runId: bigint;
  mode: "campaign" | "daily";
  mapId: number;
  level: number;
  rules: ActiveRunRulesView;
  lifecycle: string;
  finishReason?: string;
  deadlineAt?: number;
  score: number;
  dailyScore: number;
  pressureScore: number;
  objectiveTotal: bigint;
  actionCounter: number;
  moves: number;
  comboCounter: number;
  maxCombo: number;
  primaryProgress: number;
  secondaryProgress: number;
  latchedStarSources: number;
  streak: number;
  chargesEarned: number;
  levelLinesCleared: number;
  totalLinesCleared: number;
  currentTier: number;
  currentDifficulty: number;
  bonusType: number;
  bonusCharges: number;
  rerollCharges: number;
  grid: number[];
  nextRow: number[] | null;
  pendingVrfCounter: number;
  vrfRequestCounter: number;
  rulesHash: number[];
  replayHash: number[];
  dailyTheme: { kind: number; value: number };
  dailyPressure: { maxMoves: number };
}

export interface ClientRunReceipt {
  runId: bigint;
  mode: "campaign" | "daily";
  mapId: number;
  level: number;
  score: number;
  dailyScore: number;
  pressureScore: number;
  finalPressureTier: number;
  moves: number;
  latchedStarSources: number;
  completed: boolean;
  consumed: boolean;
}

export interface ClientSlotRunController {
  activeRun: ClientRunView | null;
  receipt: ClientRunReceipt | null;
  phase: "none" | "missing" | "resolving" | "delegated" | "base" | "settleable";
  watchStatus: { phase: "subscribed" | "resolving" } | null;
  busy: boolean;
  error: string | null;
  lastSignature: string | null;
  sessionAuthorized: boolean;
  settleStage: SettleStage | null;
  connected: boolean;
  publicKey: string | null;
  startCampaignRun(mapId: number, level: number): Promise<ClientRunView>;
  startDailyRun(_daily?: unknown): Promise<ClientRunView>;
  playMove(
    row: number,
    start: number,
    destination: number,
  ): Promise<ClientRunView>;
  applyBonus(row: number, column: number): Promise<ClientRunView>;
  requestReroll(): Promise<ClientRunView>;
  settleAndAdvance(): Promise<ClientRunReceipt | null>;
  recoverSettlement(): Promise<ClientRunReceipt | null>;
  recoverBaseRun(): Promise<ClientRunReceipt | null>;
  abandonRun(): Promise<void>;
  dismissRun(): void;
  recoverSession(): Promise<void>;
  resumePreparedRun(): Promise<ClientRunView | null>;
  retryResolve(): Promise<ClientRunView | null>;
}

export interface ClientRunController extends ClientSlotRunController {
  campaign: ClientSlotRunController;
  arcade: ClientSlotRunController;
}

export interface ClientCampaignMap {
  mapId: number;
  themeId: number;
  enabled: boolean;
  locked: null | "stars" | "purchase";
  cleared: boolean;
  perfected: boolean;
  levelStars: number[];
  levels: ActiveRunRulesView[];
}

export interface ClientCampaignView {
  contentVersion: number;
  maps: ClientCampaignMap[];
}

export interface ClientDailyView {
  dayId: number;
  status: "funding" | "open" | "finalized" | "unknown";
  mapId: number;
  opensAt: number;
  runsCloseAt: number;
  dailyPotLamports: bigint;
  followingDailyLamports: bigint | null;
  kreditBalance: bigint;
  uniquePlayers: number;
  entryLamports: bigint;
  dailyTheme: { kind: number; value: number };
  boards: ReadonlyArray<BoardState>;
  attempt: EconomyState["profile"]["dailyAttempt"];
}

export interface ClientState {
  identity: IdentityState;
  session: SessionState;
  economy: EconomyState;
  today: DailyContent | null;
  boards: ReadonlyArray<BoardState>;
  catalog: CampaignCatalog | null;
  campaignRun: ClientSlotRunController;
  arcadeRun: ClientSlotRunController;
}

const EMPTY_IDENTITY: IdentityState = { status: "disconnected" };
const EMPTY_SESSION: SessionState = {
  status: "none",
  expiresAt: 0,
  floatLamports: 0n,
};
const EMPTY_ECONOMY: EconomyState = {
  kredits: 0n,
  claimable: [],
  profile: {
    stars: Array<number>(100).fill(0),
    ladderPoints: 0n,
    ladderTier: 0,
    highestTier: 0,
    wornEmblem: 0,
    wornBorder: 0,
    records: {
      score: { bestPrizeRank: 0, podiums: 0, wins: 0, rewardsLamports: 0n },
      theme: { bestPrizeRank: 0, podiums: 0, wins: 0, rewardsLamports: 0n },
    },
    streak: 0,
    bestScore: 0,
  },
};

const ClientContext = createContext<ClientState | null>(null);
const SELECTION_KEY = "zkube:run-content:v1";

export function BackendClientState({ children }: { children: ReactNode }) {
  const runtime = useBackendRuntime();
  const [identity, setIdentity] = useState(EMPTY_IDENTITY);
  const [session, setSession] = useState(EMPTY_SESSION);
  const [economy, setEconomy] = useState(EMPTY_ECONOMY);
  const [today, setToday] = useState<DailyContent | null>(null);
  const [boards, setBoards] = useState<ReadonlyArray<BoardState>>([]);
  const [catalog, setCatalog] = useState<CampaignCatalog | null>(null);
  const campaignRun = useRunSlot("campaign", {
    runtime,
    identity,
    session,
    today,
    catalog,
  });
  const arcadeRun = useRunSlot("arcade", {
    runtime,
    identity,
    session,
    today,
    catalog,
  });

  useEffect(() => {
    void runtime
      .runPromise(Effect.flatMap(Identity, (service) => service.reconnect()))
      .catch(() => undefined);
  }, [runtime]);

  useEffect(
    () =>
      runtime.runCallback(
        Effect.flatMap(Identity, (service) =>
          Stream.runForEach(service.state, (value) =>
            Effect.sync(() => setIdentity(value)),
          ),
        ),
      ),
    [runtime],
  );
  useEffect(
    () =>
      runtime.runCallback(
        Effect.flatMap(Session, (service) =>
          Stream.runForEach(service.state, (value) =>
            Effect.sync(() => setSession(value)),
          ),
        ),
      ),
    [runtime],
  );
  useEffect(
    () =>
      runtime.runCallback(
        Effect.flatMap(Economy, (service) =>
          Stream.runForEach(service.state, (value) =>
            Effect.sync(() => setEconomy(value)),
          ),
        ),
      ),
    [runtime],
  );
  useEffect(
    () =>
      runtime.runCallback(
        Effect.flatMap(Content, (service) =>
          Stream.runForEach(service.todayChanges, (value) =>
            Effect.sync(() => setToday(value)),
          ),
        ),
      ),
    [runtime],
  );

  useEffect(() => {
    let cancelled = false;
    void runtime
      .runPromise(Effect.flatMap(Content, (service) => service.catalog()))
      .then((value) => {
        if (!cancelled) setCatalog(value);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, identity.address]);

  useEffect(() => {
    if (!today) {
      setBoards([]);
      return;
    }
    const cancel = runtime.runCallback(
      Effect.flatMap(Boards, (service) =>
        service
          .watch(today.dayId)
          .pipe(
            Stream.runForEach((board) =>
              Effect.sync(() =>
                setBoards((current) => [
                  ...current.filter((value) => value.kind !== board.kind),
                  board,
                ]),
              ),
            ),
          ),
      ),
    );
    return cancel;
  }, [runtime, today]);

  const value = useMemo<ClientState>(
    () => ({
      identity,
      session,
      economy,
      today,
      boards,
      catalog,
      campaignRun,
      arcadeRun,
    }),
    [
      arcadeRun,
      boards,
      campaignRun,
      catalog,
      economy,
      identity,
      session,
      today,
    ],
  );
  return createElement(ClientContext.Provider, { value }, children);
}

function useRunSlot(
  mode: RunMode,
  args: {
    runtime: ReturnType<typeof useBackendRuntime>;
    identity: IdentityState;
    session: SessionState;
    today: DailyContent | null;
    catalog: CampaignCatalog | null;
  },
): ClientSlotRunController {
  const [activeRun, setActiveRun] = useState<ClientRunView | null>(null);
  const [receipt, setReceipt] = useState<ClientRunReceipt | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = args.identity.status === "connected";
  const sessionAuthorized =
    args.session.status === "live" || args.session.status === "expiring";

  const project = useCallback(
    (view: RunView, selection?: RunSelection) =>
      projectClientRun(
        view,
        selection ?? loadSelection(view.runId),
        args.catalog,
        args.today,
      ),
    [args.catalog, args.today],
  );

  const resume = useCallback(async () => {
    const view = await args.runtime.runPromise(
      Effect.flatMap(Runs, (service) => service.resume(mode)),
    );
    const next = view ? project(view) : null;
    setActiveRun(next);
    setLoaded(true);
    return next;
  }, [args.runtime, mode, project]);

  useEffect(() => {
    if (!connected || !sessionAuthorized) {
      setActiveRun(null);
      setLoaded(true);
      return;
    }
    void resume().catch((cause) => {
      setError(errorMessage(cause));
      setLoaded(true);
    });
  }, [connected, resume, sessionAuthorized]);

  useEffect(
    () =>
      subscribeNativeResume(() => {
        if (!connected || !sessionAuthorized) return;
        void resume().catch((cause) => setError(errorMessage(cause)));
      }),
    [connected, resume, sessionAuthorized],
  );

  const runAction = useCallback(
    async (action: RunAction) => {
      if (!activeRun) throw new Error("No active run");
      setBusy(true);
      setError(null);
      try {
        const view = await args.runtime.runPromise(
          Effect.flatMap(Runs, (service) =>
            service.act(activeRun.runId.toString(), action),
          ),
        );
        const next = project(view);
        setActiveRun(next);
        return next;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [activeRun, args.runtime, project],
  );

  const start = useCallback(
    async (selection: RunSelection) => {
      setBusy(true);
      setError(null);
      try {
        const view = await args.runtime.runPromise(
          Effect.flatMap(Runs, (service) =>
            selection.mode === "campaign"
              ? service.startCampaign(selection.realm, selection.level)
              : service.enterDaily(),
          ),
        );
        saveSelection(view.runId, selection);
        const next = project(view, selection);
        setActiveRun(next);
        return next;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [args.runtime, project],
  );

  const settle = useCallback(async () => {
    if (!activeRun) return null;
    const result = receiptFromRun(activeRun);
    setReceipt(result);
    await resume().catch(() => null);
    return result;
  }, [activeRun, resume]);

  return useMemo(
    () => ({
      activeRun,
      receipt,
      phase: !loaded ? "resolving" : activeRun ? "delegated" : "none",
      watchStatus: { phase: loaded ? "subscribed" : "resolving" },
      busy,
      error,
      lastSignature: null,
      sessionAuthorized,
      settleStage: null,
      connected,
      publicKey: args.identity.address ?? null,
      startCampaignRun: (mapId: number, level: number) =>
        start({ mode: "campaign", realm: mapId, level }),
      startDailyRun: () =>
        start({ mode: "arcade", realm: args.today?.realm ?? 1, level: 1 }),
      playMove: (row: number, startColumn: number, destination: number) =>
        runAction({ _tag: "Move", row, start: startColumn, destination }),
      applyBonus: (row: number, column: number) =>
        runAction({ _tag: "Bonus", row, column }),
      requestReroll: () => runAction({ _tag: "Reroll" }),
      settleAndAdvance: settle,
      recoverSettlement: settle,
      recoverBaseRun: settle,
      abandonRun: async () => {
        await runAction({ _tag: "Finish", reason: "abandon" });
      },
      dismissRun: () => setActiveRun(null),
      recoverSession: async () => {
        await args.runtime.runPromise(
          Effect.flatMap(Session, (service) => service.ensure()),
        );
      },
      resumePreparedRun: resume,
      retryResolve: resume,
    }),
    [
      activeRun,
      args.identity.address,
      args.runtime,
      args.today?.realm,
      busy,
      connected,
      error,
      loaded,
      receipt,
      resume,
      runAction,
      sessionAuthorized,
      settle,
      start,
    ],
  );
}

interface RunSelection {
  mode: RunMode;
  realm: number;
  level: number;
}

function projectClientRun(
  view: RunView,
  selection: RunSelection | null,
  catalog: CampaignCatalog | null,
  today: DailyContent | null,
): ClientRunView {
  const summary = coreRunSummary(view.token);
  const realmId = selection?.realm ?? today?.realm ?? 1;
  const level = selection?.level ?? 1;
  const realm = catalog?.realms.find(
    (candidate) => candidate.realm === realmId,
  );
  const rules = clientRules(
    view.mode,
    realm,
    level,
    today,
    summary.currentTier,
  );
  return {
    runId: BigInt(view.runId),
    mode: view.mode === "campaign" ? "campaign" : "daily",
    mapId: realmId,
    level,
    rules,
    lifecycle: summary.phase,
    ...(view.finishReason ? { finishReason: view.finishReason } : {}),
    ...(view.deadlineAt !== undefined ? { deadlineAt: view.deadlineAt } : {}),
    score: summary.score,
    dailyScore: summary.dailyScore,
    pressureScore: summary.pressureScore,
    objectiveTotal: summary.objectiveTotal,
    actionCounter: summary.actionCounter,
    moves: summary.moves,
    comboCounter: summary.comboCounter,
    maxCombo: summary.maxCombo,
    primaryProgress: summary.primaryProgress,
    secondaryProgress: summary.secondaryProgress,
    latchedStarSources: summary.latchedStarSources,
    streak: summary.streak,
    chargesEarned: summary.chargesEarned,
    levelLinesCleared: summary.levelLinesCleared,
    totalLinesCleared: summary.levelLinesCleared,
    currentTier: summary.currentTier,
    currentDifficulty: summary.currentTier,
    bonusType: summary.bonusType,
    bonusCharges: summary.bonusCharges,
    rerollCharges: summary.rerollCharges,
    grid: [...summary.grid],
    nextRow: summary.nextRow ? [...summary.nextRow] : null,
    pendingVrfCounter:
      summary.phase === "awaitingVrf" ? summary.lastVrfCounter + 1 : 0,
    vrfRequestCounter: summary.lastVrfCounter,
    rulesHash: Array.from(summary.rulesHash),
    replayHash: Array.from(summary.replayHash),
    dailyTheme: today?.objective ?? { kind: 0, value: 0 },
    dailyPressure: { maxMoves: DAILY_MAX_MOVES },
  };
}

function clientRules(
  mode: RunMode,
  realm: CampaignRealmContent | undefined,
  level: number,
  today: DailyContent | null,
  currentTier: number,
): ActiveRunRulesView {
  const content = realm?.levels[level - 1];
  const presentation = campaignGuardianPresentation(
    realm?.realm ?? today?.realm ?? 1,
  );
  if (mode === "campaign" && content && realm) {
    return {
      pointsRequired: content.target,
      maxMoves: content.moveBudget,
      difficulty: content.tier,
      primary: { ...content.primary },
      secondary: { ...content.secondary },
      activeMutatorId: presentation.activeMutatorId,
      bossId: level === 10 ? presentation.bossId : 0,
      guardian: { ...realm.guardian },
      startingRows: realm.startingHeight,
    };
  }
  return {
    pointsRequired: 0,
    maxMoves: DAILY_MAX_MOVES,
    difficulty: currentTier,
    primary: { kind: 0, value: 0, requiredCount: 0 },
    secondary: { kind: 0, value: 0, requiredCount: 0 },
    activeMutatorId: presentation.activeMutatorId,
    bossId: presentation.bossId,
    guardian: realm?.guardian ?? { bonus: 0, trigger: 0, threshold: 0 },
    startingRows: today?.startingHeight ?? realm?.startingHeight ?? 0,
  };
}

function receiptFromRun(run: ClientRunView): ClientRunReceipt {
  return {
    runId: run.runId,
    mode: run.mode,
    mapId: run.mapId,
    level: run.level,
    score: run.score,
    dailyScore: run.dailyScore,
    pressureScore: run.pressureScore,
    finalPressureTier: run.currentTier,
    moves: run.moves,
    latchedStarSources: run.latchedStarSources,
    completed: run.lifecycle === "levelComplete",
    consumed: true,
  };
}

function saveSelection(runId: string, selection: RunSelection): void {
  const storage = appStorage();
  if (!storage) return;
  try {
    const values = JSON.parse(storage.getItem(SELECTION_KEY) ?? "{}") as Record<
      string,
      RunSelection
    >;
    values[runId] = selection;
    storage.setItem(SELECTION_KEY, JSON.stringify(values));
  } catch {
    // The on-chain run remains authoritative when browser storage is absent.
  }
}

function loadSelection(runId: string): RunSelection | null {
  const storage = appStorage();
  if (!storage) return null;
  try {
    const value = (
      JSON.parse(storage.getItem(SELECTION_KEY) ?? "{}") as Record<
        string,
        RunSelection
      >
    )[runId];
    return value &&
      (value.mode === "campaign" || value.mode === "arcade") &&
      Number.isInteger(value.realm) &&
      Number.isInteger(value.level)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function useClientState(): ClientState {
  const value = useContext(ClientContext);
  if (!value) throw new Error("BackendProvider is missing client state");
  return value;
}

export function useRun(): ClientRunController {
  const { campaignRun, arcadeRun } = useClientState();
  const currentPage = useNavigationStore((state) => state.currentPage);
  const previousPage = useNavigationStore((state) => state.previousPage);
  const gameId = useNavigationStore((state) => state.gameId);
  const selected =
    campaignRun.activeRun?.runId === gameId ||
    (arcadeRun.activeRun?.runId !== gameId &&
      (currentPage === "map" ||
        (currentPage === "play" && previousPage === "map")))
      ? campaignRun
      : arcadeRun;
  return { ...selected, campaign: campaignRun, arcade: arcadeRun };
}

export function useCampaign() {
  const state = useClientState();
  const runtime = useBackendRuntime();
  const campaign = useMemo(
    () => projectCampaign(state.catalog, state.economy.profile.stars),
    [state.catalog, state.economy.profile.stars],
  );
  const refresh = useCallback(async () => {
    const catalog = await runtime.runPromise(
      Effect.flatMap(Content, (service) => service.catalog()),
    );
    return projectCampaign(catalog, state.economy.profile.stars);
  }, [runtime, state.economy.profile.stars]);
  return {
    campaign,
    loading: !state.catalog,
    loaded: Boolean(state.catalog),
    error: null,
    refresh,
  };
}

export function useDaily() {
  const state = useClientState();
  const runtime = useBackendRuntime();
  const [action, setAction] = useState<string | null>(null);
  const daily = useMemo(() => projectDaily(state), [state]);
  const enter = useCallback(async () => {
    setAction("enter:kredit");
    try {
      return await state.arcadeRun.startDailyRun();
    } finally {
      setAction(null);
    }
  }, [state.arcadeRun]);
  const buyKredits = useCallback(
    async (pack: 1 | 10 | 25 = 1) => {
      setAction("buy:kredits");
      try {
        await runtime.runPromise(
          Effect.flatMap(Economy, (service) => service.buy(pack)),
        );
        return "confirmed";
      } finally {
        setAction(null);
      }
    },
    [runtime],
  );
  const refresh = useCallback(async () => {
    const content = await runtime.runPromise(
      Effect.flatMap(Content, (service) => service.today()),
    );
    return daily && content.dayId === daily.dayId ? daily : null;
  }, [daily, runtime]);
  return {
    daily,
    loading: !state.today,
    action,
    error: null,
    refresh,
    maintain: refresh,
    enter,
    buyKredits,
    run: state.arcadeRun,
  };
}

function projectCampaign(
  catalog: CampaignCatalog | null,
  stars: readonly number[],
): ClientCampaignView | null {
  if (!catalog) return null;
  return {
    contentVersion: catalog.contentVersion,
    maps: catalog.realms.map((realm, index) => {
      const levelStars = Array.from(
        { length: 10 },
        (_, level) => stars[index * 10 + level] ?? 0,
      );
      return {
        mapId: realm.realm,
        themeId: realm.theme,
        enabled: true,
        locked:
          realm.locked === "purchase"
            ? "purchase"
            : realm.locked === "stars" &&
                index > 0 &&
                (stars[index * 10 - 1] ?? 0) === 0
              ? "stars"
              : null,
        cleared: levelStars[9]! > 0,
        perfected: levelStars.every((value) => value === 3),
        levelStars,
        levels: realm.levels.map((level) =>
          clientRules("campaign", realm, level.level, null, level.tier),
        ),
      };
    }),
  };
}

function projectDaily(state: ClientState): ClientDailyView | null {
  if (!state.today) return null;
  const now = Math.floor(Date.now() / 1_000);
  const suspended = state.today.suspended;
  const status = suspended
    ? "funding"
    : now < state.today.freezesAt
      ? "open"
      : state.boards.some(
            (board) => board.status === "sealed" || board.status === "expired",
          )
        ? "finalized"
        : "open";
  const players = new Set(
    state.boards.flatMap((board) => board.rows.map((row) => row.address)),
  );
  return {
    dayId: state.today.dayId,
    status,
    mapId: state.today.realm,
    opensAt: state.today.opensAt,
    runsCloseAt: state.today.freezesAt,
    dailyPotLamports: state.boards.reduce(
      (total, board) => total + board.potLamports,
      0n,
    ),
    followingDailyLamports: suspended ? null : 0n,
    kreditBalance: state.economy.kredits,
    uniquePlayers: players.size,
    entryLamports: ARENA_ENTRY_LAMPORTS,
    dailyTheme: state.today.objective,
    boards: state.boards,
    attempt:
      state.economy.profile.dailyAttempt?.dayId === state.today.dayId
        ? state.economy.profile.dailyAttempt
        : undefined,
  };
}

export interface ConnectedPlayer {
  connectors: ReadonlyArray<WalletChoice>;
  connectionStatus: IdentityState["status"];
  connector: WalletChoice | null;
  publicKey: string | null;
  label: string | null;
  wallet: WalletChoice | null;
  session: { validUntil: number } | null;
  sessionStatus: "missing" | "checking" | "ready" | "expired" | "needsRenewal";
  balanceLamports: number | null;
  balanceLoading: boolean;
  error: string | null;
  connectAndEnable(walletId: string): Promise<void>;
  enable(): Promise<string>;
  renew(): Promise<string>;
  disconnect(): Promise<void>;
  refreshBalance(): Promise<void>;
}

export function useConnectedPlayer(): ConnectedPlayer {
  const { identity, session } = useClientState();
  const runtime = useBackendRuntime();
  const [connectors, setConnectors] = useState<ReadonlyArray<WalletChoice>>([]);
  useEffect(() => {
    let cancelled = false;
    void runtime
      .runPromise(Effect.flatMap(Identity, (service) => service.wallets()))
      .then((value) => {
        if (!cancelled) setConnectors(value);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime]);
  const ensure = useCallback(async () => {
    await runtime.runPromise(
      Effect.flatMap(Session, (service) => service.ensure()),
    );
    return "confirmed";
  }, [runtime]);
  return {
    connectors,
    connectionStatus: identity.status,
    connector: identity.wallet ?? null,
    publicKey: identity.address ?? null,
    label: identity.label ?? null,
    wallet: identity.wallet ?? null,
    session:
      session.status === "none" ? null : { validUntil: session.expiresAt },
    sessionStatus:
      session.status === "live" || session.status === "expiring"
        ? "ready"
        : session.status === "expired"
          ? "expired"
          : "missing",
    balanceLamports: null,
    balanceLoading: false,
    error: null,
    connectAndEnable: async (walletId) => {
      await runtime.runPromise(
        Effect.flatMap(Identity, (service) => service.connect(walletId)),
      );
      await ensure();
    },
    enable: ensure,
    renew: ensure,
    disconnect: async () => {
      await runtime.runPromise(
        Effect.flatMap(Identity, (service) => service.disconnect()),
      );
    },
    refreshBalance: async () => undefined,
  };
}

export function useIdentityActions() {
  const runtime = useBackendRuntime();
  return {
    setLabel: (label: string) =>
      runtime.runPromise(
        Effect.flatMap(Identity, (service) => service.setLabel(label)),
      ),
    setWorn: (emblem: number, border: number) =>
      runtime.runPromise(
        Effect.flatMap(Economy, (service) => service.setWorn(emblem, border)),
      ),
  };
}

export function useEconomyActions() {
  const runtime = useBackendRuntime();
  return {
    claim: (dayId: number, board: "score" | "theme") =>
      runtime.runPromise(
        Effect.flatMap(Economy, (service) => service.claim(dayId, board)),
      ),
  };
}

export function useSpectatedRun(address: string, mode: RunMode) {
  const runtime = useBackendRuntime();
  const { catalog, today } = useClientState();
  const [run, setRun] = useState<ClientRunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const view = await runtime.runPromise(
        Effect.flatMap(Runs, (service) =>
          service.spectate(PlayerAddress.make(address), mode),
        ),
      );
      const next = view
        ? projectClientRun(view, loadSelection(view.runId), catalog, today)
        : null;
      setRun(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(errorMessage(cause));
      return null;
    }
  }, [address, catalog, mode, runtime, today]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { run, error, loading: false, refresh };
}
