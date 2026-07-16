import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCampaign } from "@/contexts/campaign";
import { useDaily } from "@/contexts/daily";
import { useMusicPlayer } from "@/contexts/hooks";
import { useProgress } from "@/contexts/progress";
import { useRun } from "@/contexts/run";
import { Game } from "@/game/model";
import {
  calculateCampaignXpAwarded,
  calculateLevelStars,
} from "@/game/level";
import { rulesToGameLevelData, type GameLevelData } from "@/hooks/useGameLevel";
import type { ActiveRunView } from "@/chain/runPlan";
import type { RunResultView } from "@/chain/resumeRun";
import type { SettleStage } from "@/chain/useRunController";
import { toDisplayGrid } from "@/chain/gridProjection";
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
  xpAwarded: number;
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
  return lifecycle === "levelComplete" || lifecycle === "finished";
}

export function projectRunResult(activeRun: ActiveRunView): ReceiptProjection {
  return {
    blocks: toDisplayGrid(activeRun.grid),
    nextRow: activeRun.nextRow ?? [],
    over: isTerminalLifecycle(activeRun.lifecycle),
  };
}

export function pendingCompletionFromRun(
  activeRun: ActiveRunView,
  previousBestStars = 0,
): PendingLevelCompletion {
  const gameLevel = rulesToGameLevelData(
    activeRun.rules,
    activeRun.level,
    activeRun.runId,
  );
  const isIncomplete = activeRun.lifecycle === "finished";
  const achievedStars = calculateLevelStars({
    movesUsed: activeRun.moves,
    star3UsedCap: gameLevel.star3Threshold,
    star2UsedCap: gameLevel.star2Threshold,
    isIncomplete,
  });
  return {
    level: activeRun.level,
    levelMoves: activeRun.moves,
    prevTotalScore: 0,
    totalScore: activeRun.score,
    gameLevel,
    xpAwarded:
      activeRun.mode === "daily"
        ? 0
        : calculateCampaignXpAwarded(previousBestStars, achievedStars),
    isIncomplete,
  };
}

/**
 * Translate low-level run-start failures into player-honest copy. A prepare
 * simulation failing with the System program's `Custom:1` means the device fee
 * allowance or shared player funding PDA is too low. The next Enable/renew
 * approval replenishes both balances.
 */
export function describeRunStartError(message: string): {
  headline: string;
  detail: string | null;
} {
  const fundingDry =
    message.includes("Simulation failed for") && message.includes('"Custom":1}');
  if (fundingDry) {
    return {
      headline:
        "Your zKube play balance is low — renew the device session to refill it.",
      detail: message,
    };
  }
  return { headline: message, detail: null };
}

export function settleStageLabel(stage: SettleStage | null): string {
  switch (stage) {
    case "abandoning":
      return "Abandoning run…";
    case "delegating":
      return "Resuming run on MagicBlock…";
    case "sealing":
      return "Sealing result…";
    case "committing":
      return "Committing to Solana…";
    case "settling":
      return "Waiting for base copyback…";
    case "consuming":
      return "Crediting progress…";
    case "cleaning":
      return "Cleaning up settled run…";
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
  const previousBestStars = levelStars[activeRun.level - 1] ?? 0;
  const pending = pendingCompletionFromRun(activeRun, previousBestStars);
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
    xpAwarded: pending.xpAwarded,
  };
}

export function usePlayController() {
  const run = useRun();
  const campaign = useCampaign();
  const progress = useProgress();
  const daily = useDaily();
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
  // Observable twin of terminalAwaitingCascadeRef: true from the moment a
  // move/bonus lands a terminal lifecycle until the client cascade finishes
  // (onCascadeComplete). The board keeps rendering/animating the final cascade
  // while this is true; PlayScreen defers the level-complete overlay on it, so
  // the chain settling in the background never cuts the animation short.
  const [awaitingTerminalCascade, setAwaitingTerminalCascade] = useState(false);
  const [terminalSnapshot, setTerminalSnapshot] =
    useState<TerminalRunSnapshot | null>(null);
  const [outcome, setOutcome] = useState<PlayOutcome>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [settledReceiptSnapshot, setSettledReceiptSnapshot] =
    useState<RunResultView | null>(null);
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
  const finalCampaignMapId = campaign.campaign?.maps.reduce(
    (highest, map) => Math.max(highest, map.mapId),
    0,
  ) ?? 0;
  const mapPlayable = campaign.campaign
    ? selectedMap?.enabled === true && selectedMap.unlocked
    : mapId === 1;
  const startCampaignRun = run.startCampaignRun;

  // A launch whose ER delegation timed out throws into startError, but the run
  // is persisted and the watcher heals it (resolving → delegated). Clear the
  // stale launch error once the run attaches so no dead banner lingers.
  useEffect(() => {
    if (run.phase === "resolving" || run.phase === "delegated") {
      setStartError(null);
    }
  }, [run.phase]);

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
          setAwaitingTerminalCascade(true);
          rememberTerminal(activeRun);
        }
        return projectRunResult(activeRun);
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
          setAwaitingTerminalCascade(true);
          rememberTerminal(activeRun);
        }
        return projectRunResult(activeRun);
      } finally {
        setLocalActionPending(false);
      }
    },
    [applyBonus, rememberTerminal],
  );

  const onCascadeComplete = useCallback(() => {
    terminalAwaitingCascadeRef.current = null;
    setAwaitingTerminalCascade(false);
    setCascadeVersion((value) => value + 1);
  }, []);

  // Defensive: never let the level-complete overlay be stranded if the cascade
  // signal is missed (e.g. a Grid unmount). Once the run has settled or gone
  // away, there is no cascade left to wait for.
  useEffect(() => {
    if (run.phase === "none") {
      setAwaitingTerminalCascade(false);
    }
  }, [run.phase]);

  const settleAndAdvance = run.settleAndAdvance;
  const recoverSettlement = run.recoverSettlement;
  const recoverSession = run.recoverSession;
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
        ? lifecycleRun.mapId === finalCampaignMapId
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
  }, [finalCampaignMapId, lifecycleRun, playSfx]);

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
    // device fee allowance from watcher-driven resubmission loops.
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

    settlingRunRef.current = terminalRun.runId;

    const settle =
      run.phase === "settleable" ? recoverSettlement : settleAndAdvance;
    void (async () => {
      // Refresh before consumption so the displayed delta is based on the
      // same lifetime best that the program will read, including after a
      // cross-device resume. A failed read falls back to the last validated
      // campaign snapshot and never blocks the settlement itself.
      const refreshedCampaign =
        terminalRun.mode === "daily" ? null : await campaignRefresh();
      const levelStars =
        terminalRun.mode === "daily"
          ? []
          : ((refreshedCampaign ?? campaign.campaign)?.maps.find(
              (map) => map.mapId === terminalRun.mapId,
            )?.levelStars ?? []);
      const snapshot = snapshotRun(terminalRun, levelStars);
      const previousBestStars = levelStars[terminalRun.level - 1] ?? 0;
      const pendingCompletion = pendingCompletionFromRun(
        terminalRun,
        previousBestStars,
      );
      setTerminalSnapshot(snapshot);

      await settle();
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
        setPendingLevelCompletion(pendingCompletion);
        navigate("map");
      }
    })().catch(() => {
      // The run hook exposes the failure. Keep the per-run guard set until
      // the user explicitly retries so watcher refreshes cannot hammer the
      // settlement pipeline with repeated session-signed transactions.
    });
  }, [
    campaign.campaign,
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
  const settledReceipt = settledReceiptSnapshot;
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
        xpAwarded: settledReceipt.campaignXpAwarded,
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
    awaitingTerminalCascade,
    retrySettlement,
    retrySessionRenewal,
    sessionRenewalStatus,
    continueSettled,
    settledReceipt,
    settledCleanupStatus,
    finalCampaignMapId,
    recoverBaseRun: recoverOrphanedBaseRun,
    settlingLabel: settleStageLabel(run.settleStage),
  };
}
