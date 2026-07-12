import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCampaignController } from "@/contexts/campaign";
import { useDailyController } from "@/contexts/daily";
import { useMusicPlayer } from "@/contexts/hooks";
import { useProgressController } from "@/contexts/progress";
import { useRun } from "@/contexts/run";
import { Game } from "@/game/model";
import { rulesToGameLevelData, type GameLevelData } from "@/hooks/useGameLevel";
import type { ActiveRunView } from "@/solana/reboot/runPlan";
import type { RunReceiptView } from "@/solana/reboot/resumeRun";
import type { SettleStage } from "@/solana/reboot/useRebootRun";
import { toDisplayGrid } from "@/solana/reboot/rebootGrid";
import {
  useNavigationStore,
  type PendingLevelCompletion,
} from "@/stores/navigationStore";
import type { ReceiptProjection } from "@/ui/components/Grid";

export interface TerminalRunSnapshot {
  activeRun: ActiveRunView;
  game: Game;
  gameLevel: GameLevelData;
  isBoss: boolean;
  isDaily: boolean;
  completed: boolean;
}

export type PlayOutcome = "victory" | "daily" | null;
export type SettledCleanupStatus = "idle" | "running" | "complete" | "failed";
export type SessionRenewalStatus = "idle" | "renewing" | "failed";

export function canSettleTerminalRun(
  phase: string,
  sessionAuthorized: boolean,
  recoveryRunId: bigint | null = null,
): boolean {
  if (recoveryRunId !== null) return false;
  return phase === "settleable" || (phase === "delegated" && sessionAuthorized);
}

export function isTerminalLifecycle(lifecycle: string): boolean {
  return (
    lifecycle === "levelComplete" ||
    lifecycle === "finished" ||
    lifecycle === "settled"
  );
}

export function projectRunReceipt(activeRun: ActiveRunView): ReceiptProjection {
  return {
    blocks: toDisplayGrid(activeRun.grid),
    nextRow: activeRun.nextRow ?? [],
    over: isTerminalLifecycle(activeRun.lifecycle),
  };
}

export function pendingCompletionFromRun(
  activeRun: ActiveRunView,
): PendingLevelCompletion {
  return {
    level: activeRun.level,
    levelMoves: activeRun.moves,
    prevTotalScore: 0,
    totalScore: activeRun.score,
    gameLevel: rulesToGameLevelData(
      activeRun.rules,
      activeRun.level,
      activeRun.runId,
    ),
    isIncomplete: activeRun.lifecycle === "finished",
  };
}

export function settleStageLabel(stage: SettleStage | null): string {
  switch (stage) {
    case "sealing":
      return "Sealing result…";
    case "committing":
      return "Committing to Solana…";
    case "settling":
      return "Waiting for base copyback…";
    case "consuming":
      return "Crediting progress…";
    case "cleaning":
      return "Recovering rent…";
    case "preparing":
      return "Preparing on-chain run…";
    default:
      return "Settling…";
  }
}

function snapshotRun(
  activeRun: ActiveRunView,
  levelStars: readonly number[],
): TerminalRunSnapshot {
  return {
    activeRun,
    game: new Game(activeRun, levelStars),
    gameLevel: rulesToGameLevelData(
      activeRun.rules,
      activeRun.level,
      activeRun.runId,
    ),
    isBoss: activeRun.level === 10 || activeRun.rules.bossId > 0,
    isDaily: activeRun.mode === "daily",
    completed: activeRun.lifecycle === "levelComplete",
  };
}

export function usePlayController() {
  const run = useRun();
  const campaign = useCampaignController();
  const progress = useProgressController();
  const daily = useDailyController();
  const { playSfx } = useMusicPlayer();
  const navigate = useNavigationStore((state) => state.navigate);
  const mapId = useNavigationStore((state) => state.mapZoneId);
  const previewLevel = useNavigationStore((state) => state.pendingPreviewLevel);
  const setPreviewLevel = useNavigationStore(
    (state) => state.setPendingPreviewLevel,
  );
  const setGameId = useNavigationStore((state) => state.setGameId);
  const setRecoveryRunId = useNavigationStore(
    (state) => state.setRecoveryRunId,
  );
  const recoveryRunId = useNavigationStore((state) => state.recoveryRunId);
  const setPendingLevelCompletion = useNavigationStore(
    (state) => state.setPendingLevelCompletion,
  );
  const [localActionPending, setLocalActionPending] = useState(false);
  const [cascadeVersion, setCascadeVersion] = useState(0);
  const [terminalSnapshot, setTerminalSnapshot] =
    useState<TerminalRunSnapshot | null>(null);
  const [outcome, setOutcome] = useState<PlayOutcome>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [settledReceiptSnapshot, setSettledReceiptSnapshot] =
    useState<RunReceiptView | null>(null);
  const [settledCleanupStatus, setSettledCleanupStatus] =
    useState<SettledCleanupStatus>("idle");
  const [sessionRenewalStatus, setSessionRenewalStatus] =
    useState<SessionRenewalStatus>("idle");
  const [sessionRenewalVersion, setSessionRenewalVersion] = useState(0);
  const startIntentRef = useRef<string | null>(null);
  const renewingSessionRunRef = useRef<bigint | null>(null);
  const terminalAwaitingCascadeRef = useRef<bigint | null>(null);
  const settlingRunRef = useRef<bigint | null>(null);
  const previousLifecycleRef = useRef<{
    runId: bigint;
    lifecycle: string;
  } | null>(null);

  const selectedMap = campaign.campaign?.maps.find(
    (map) => map.mapId === mapId,
  );
  const mapPlayable = campaign.campaign
    ? selectedMap?.enabled === true && selectedMap.unlocked
    : mapId === 1;
  const startCampaignRun = run.startCampaignRun;

  useEffect(() => {
    if (
      previewLevel === null ||
      recoveryRunId !== null ||
      run.phase !== "none" ||
      run.busy ||
      run.watchStatus?.phase === "resolving" ||
      campaign.loading ||
      !mapPlayable
    ) {
      return;
    }
    const intent = `${mapId}:${previewLevel}`;
    if (startIntentRef.current === intent) return;
    startIntentRef.current = intent;
    setPreviewLevel(null);
    setStartError(null);
    void startCampaignRun(mapId, previewLevel)
      .then((activeRun) => {
        setGameId(activeRun.runId);
        setTerminalSnapshot(null);
        setOutcome(null);
      })
      .catch((cause: unknown) => {
        startIntentRef.current = null;
        setStartError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [
    campaign.loading,
    mapId,
    mapPlayable,
    previewLevel,
    recoveryRunId,
    run.busy,
    run.phase,
    run.watchStatus?.phase,
    setGameId,
    setPreviewLevel,
    startCampaignRun,
  ]);

  const rememberTerminal = useCallback(
    (activeRun: ActiveRunView) => {
      const levelStars =
        activeRun.mode === "daily"
          ? []
          : (campaign.campaign?.maps.find(
              (map) => map.mapId === activeRun.mapId,
            )?.levelStars ?? []);
      setTerminalSnapshot(snapshotRun(activeRun, levelStars));
    },
    [campaign.campaign?.maps],
  );

  const playMove = run.playMove;
  const onMove = useCallback(
    async (row: number, start: number, destination: number) => {
      setLocalActionPending(true);
      try {
        const activeRun = await playMove(row, start, destination);
        if (isTerminalLifecycle(activeRun.lifecycle)) {
          terminalAwaitingCascadeRef.current = activeRun.runId;
          rememberTerminal(activeRun);
        }
        return projectRunReceipt(activeRun);
      } finally {
        setLocalActionPending(false);
      }
    },
    [playMove, rememberTerminal],
  );

  const applyBonus = run.applyBonus;
  const onBonus = useCallback(
    async (row: number, column: number) => {
      setLocalActionPending(true);
      try {
        const activeRun = await applyBonus(row, column);
        if (isTerminalLifecycle(activeRun.lifecycle)) {
          terminalAwaitingCascadeRef.current = activeRun.runId;
          rememberTerminal(activeRun);
        }
        return projectRunReceipt(activeRun);
      } finally {
        setLocalActionPending(false);
      }
    },
    [applyBonus, rememberTerminal],
  );

  const onCascadeComplete = useCallback(() => {
    terminalAwaitingCascadeRef.current = null;
    setCascadeVersion((value) => value + 1);
  }, []);

  const settleAndAdvance = run.settleAndAdvance;
  const recoverSettlement = run.recoverSettlement;
  const recoverSession = run.recoverSession;
  const cleanup = run.cleanup;
  const chainSettledReceipt = run.receipt;
  const campaignRefresh = campaign.refresh;
  const progressRefresh = progress.refresh;
  const dailyRefresh = daily.refresh;
  const terminalRun =
    run.activeRun && isTerminalLifecycle(run.activeRun.lifecycle)
      ? run.activeRun
      : null;

  const lifecycleRun = run.activeRun;
  useEffect(() => {
    if (!lifecycleRun) {
      previousLifecycleRef.current = null;
      return;
    }
    const previous = previousLifecycleRef.current;
    previousLifecycleRef.current = {
      runId: lifecycleRun.runId,
      lifecycle: lifecycleRun.lifecycle,
    };
    if (
      !previous ||
      previous.runId !== lifecycleRun.runId ||
      previous.lifecycle === lifecycleRun.lifecycle ||
      !isTerminalLifecycle(lifecycleRun.lifecycle)
    ) {
      return;
    }

    if (
      lifecycleRun.mode === "daily" ||
      lifecycleRun.lifecycle === "finished"
    ) {
      playSfx("over");
      return;
    }
    const boss = lifecycleRun.level === 10 || lifecycleRun.rules.bossId > 0;
    playSfx(
      boss
        ? lifecycleRun.mapId === 10
          ? "victory"
          : "boss-defeat"
        : "levelup",
    );
    const starTimer = window.setTimeout(() => playSfx("star"), 350);
    const coinTimer = window.setTimeout(() => playSfx("coin"), 650);
    return () => {
      window.clearTimeout(starTimer);
      window.clearTimeout(coinTimer);
    };
  }, [lifecycleRun, playSfx]);

  useEffect(() => {
    const activeRun = run.activeRun;
    if (run.phase !== "delegated" || !activeRun) {
      // Preserve the latch across watcher reconnect/missing snapshots. Run IDs
      // are unique, so a genuinely new run can still renew independently.
      return;
    }
    if (run.sessionAuthorized) {
      if (renewingSessionRunRef.current === activeRun.runId) {
        renewingSessionRunRef.current = null;
      }
      setSessionRenewalStatus("idle");
      return;
    }
    if (recoveryRunId !== null || run.busy) return;
    if (renewingSessionRunRef.current === activeRun.runId) return;

    // Session rotation is infrastructure, not a player decision. Attempt it
    // silently once for each authorization lapse; a failure keeps this latch
    // set until the explicit retry affordance resets it, protecting the
    // paymaster from watcher-driven resubmission loops.
    renewingSessionRunRef.current = activeRun.runId;
    setSessionRenewalStatus("renewing");
    void recoverSession().catch(() => setSessionRenewalStatus("failed"));
  }, [
    recoveryRunId,
    recoverSession,
    run.activeRun,
    run.busy,
    run.phase,
    run.sessionAuthorized,
    sessionRenewalVersion,
  ]);

  useEffect(() => {
    const canSettle = canSettleTerminalRun(
      run.phase,
      run.sessionAuthorized,
      recoveryRunId,
    );
    if (!terminalRun || !canSettle || localActionPending || run.busy) return;
    if (terminalAwaitingCascadeRef.current === terminalRun.runId) return;
    if (settlingRunRef.current === terminalRun.runId) return;

    const levelStars =
      terminalRun.mode === "daily"
        ? []
        : (campaign.campaign?.maps.find(
            (map) => map.mapId === terminalRun.mapId,
          )?.levelStars ?? []);
    const snapshot = snapshotRun(terminalRun, levelStars);
    setTerminalSnapshot(snapshot);
    settlingRunRef.current = terminalRun.runId;

    if (!snapshot.isDaily && !(snapshot.isBoss && snapshot.completed)) {
      setPendingLevelCompletion(pendingCompletionFromRun(terminalRun));
    }

    const settle =
      run.phase === "settleable" ? recoverSettlement : settleAndAdvance;
    void settle()
      .then(async () => {
        await Promise.all([
          campaignRefresh(),
          progressRefresh(),
          dailyRefresh(),
        ]);
        if (snapshot.isDaily) {
          setOutcome("daily");
        } else if (snapshot.isBoss && snapshot.completed) {
          setOutcome("victory");
        } else {
          navigate("map");
        }
      })
      .catch(() => {
        // The run hook exposes the failure. Keep the per-run guard set until
        // the user explicitly retries so watcher refreshes cannot hammer the
        // settlement pipeline with repeated sponsored transactions.
      });
  }, [
    campaign.campaign?.maps,
    campaignRefresh,
    cascadeVersion,
    dailyRefresh,
    localActionPending,
    navigate,
    progressRefresh,
    recoveryRunId,
    run.phase,
    run.busy,
    run.sessionAuthorized,
    recoverSettlement,
    setPendingLevelCompletion,
    settleAndAdvance,
    terminalRun,
  ]);

  useEffect(() => {
    if (
      recoveryRunId !== null ||
      run.phase !== "settled" ||
      !chainSettledReceipt ||
      run.busy
    ) {
      return;
    }
    setSettledReceiptSnapshot(chainSettledReceipt);
    if (settlingRunRef.current === chainSettledReceipt.runId) {
      if (run.error) setSettledCleanupStatus("failed");
      return;
    }

    // A consumed receipt still leaves transient ActiveRun rent to reclaim.
    // Fire that sponsored cleanup once on attachment; only an explicit retry
    // clears this per-run latch after failure, so watcher refreshes cannot
    // hammer the paymaster.
    settlingRunRef.current = chainSettledReceipt.runId;
    setSettledCleanupStatus("running");
    void cleanup()
      .then(async () => {
        await Promise.allSettled([
          campaignRefresh(),
          progressRefresh(),
          dailyRefresh(),
        ]);
        setSettledCleanupStatus("complete");
      })
      .catch(() => {
        // The run hook owns the error message. Keep the latch set until the
        // player chooses the existing explicit retry affordance.
        setSettledCleanupStatus("failed");
      });
  }, [
    campaignRefresh,
    cascadeVersion,
    chainSettledReceipt,
    cleanup,
    dailyRefresh,
    progressRefresh,
    recoveryRunId,
    run.busy,
    run.error,
    run.phase,
  ]);

  const retrySettlement = useCallback(() => {
    settlingRunRef.current = null;
    terminalAwaitingCascadeRef.current = null;
    setSettledCleanupStatus("idle");
    setCascadeVersion((value) => value + 1);
  }, []);

  const retrySessionRenewal = useCallback(() => {
    renewingSessionRunRef.current = null;
    setSessionRenewalStatus("idle");
    setSessionRenewalVersion((value) => value + 1);
  }, []);

  const recoverBaseRun = run.recoverBaseRun;
  const settledReceipt = chainSettledReceipt ?? settledReceiptSnapshot;
  const continueSettled = useCallback(() => {
    if (!settledReceipt) return;

    if (
      settledReceipt.mode !== "daily" &&
      !(settledReceipt.completed && settledReceipt.level === 10)
    ) {
      const rules = campaign.campaign?.maps.find(
        (map) => map.mapId === settledReceipt.mapId,
      )?.levels[settledReceipt.level - 1];
      setPendingLevelCompletion({
        level: settledReceipt.level,
        levelMoves: settledReceipt.moves,
        prevTotalScore: 0,
        totalScore: settledReceipt.score,
        gameLevel: rules
          ? rulesToGameLevelData(
              rules,
              settledReceipt.level,
              settledReceipt.runId,
            )
          : null,
        isIncomplete: !settledReceipt.completed,
      });
    }

    setSettledReceiptSnapshot(null);
    setSettledCleanupStatus("idle");
    navigate(settledReceipt.mode === "daily" ? "daily" : "map");
  }, [
    campaign.campaign?.maps,
    navigate,
    setPendingLevelCompletion,
    settledReceipt,
  ]);

  const closeOutcome = useCallback(() => {
    setOutcome(null);
    navigate(terminalSnapshot?.isDaily ? "daily" : "map");
  }, [navigate, terminalSnapshot?.isDaily]);

  const recoverOrphanedBaseRun = useCallback(
    async (runId: bigint) => {
      setStartError(null);
      const signature = await recoverBaseRun(runId);
      await Promise.allSettled([
        campaignRefresh(),
        progressRefresh(),
        dailyRefresh(),
      ]);
      setRecoveryRunId(null);
      navigate("map");
      return signature;
    },
    [
      campaignRefresh,
      dailyRefresh,
      navigate,
      progressRefresh,
      recoverBaseRun,
      setRecoveryRunId,
    ],
  );

  const activeGame = useMemo(() => {
    if (!run.activeRun) return null;
    const stars =
      run.activeRun.mode === "daily"
        ? []
        : (campaign.campaign?.maps.find(
            (map) => map.mapId === run.activeRun?.mapId,
          )?.levelStars ?? []);
    return new Game(run.activeRun, stars);
  }, [campaign.campaign?.maps, run.activeRun]);
  const activeGameLevel = useMemo(
    () =>
      run.activeRun
        ? rulesToGameLevelData(
            run.activeRun.rules,
            run.activeRun.level,
            run.activeRun.runId,
          )
        : null,
    [run.activeRun],
  );

  return {
    run,
    game: activeGame ?? terminalSnapshot?.game ?? null,
    gameLevel: activeGameLevel ?? terminalSnapshot?.gameLevel ?? null,
    activeRun: run.activeRun ?? terminalSnapshot?.activeRun ?? null,
    terminalSnapshot,
    outcome,
    closeOutcome,
    startError,
    onMove,
    onBonus,
    onCascadeComplete,
    retrySettlement,
    retrySessionRenewal,
    sessionRenewalStatus,
    continueSettled,
    settledReceipt,
    settledCleanupStatus,
    recoverBaseRun: recoverOrphanedBaseRun,
    settlingLabel: settleStageLabel(run.settleStage),
  };
}
