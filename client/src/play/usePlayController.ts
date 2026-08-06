import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCampaign } from "@/contexts/campaign";
import { useDaily } from "@/contexts/daily";
import { useMusicPlayer } from "@/contexts/hooks";
import { useRun } from "@/contexts/run";
import { Game } from "@/game/model";
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

export { describeRunStartError } from "@/chain/runStartError";

export interface TerminalRunSnapshot {
  activeRun: ActiveRunView;
  game: Game;
  gameLevel: GameLevelData;
  isBoss: boolean;
  isDaily: boolean;
  completed: boolean;
}

type PlayOutcome = "victory" | "daily" | null;
export type SettledCleanupStatus = "idle" | "running" | "complete" | "failed";
export type SessionRenewalStatus = "idle" | "renewing" | "failed";

/**
 * End-of-run presentation, sequenced ON TOP of settlement (which starts the
 * moment the chain reports terminal and never waits for animation):
 * cascade (final move still animating) → outcome (board win/lose show) →
 * card (level-complete card / boss victory / daily game-over dialog).
 */
export type TerminalPresentationPhase = "idle" | "cascade" | "outcome" | "card";
export type SettlementStatus = "idle" | "pending" | "complete" | "failed";
export interface ActionReceipt {
  actionCounter: number;
  chargesGained: number;
  linesCleared: number;
  levelLinesCleared: number;
  source: "move" | "bonus";
}
export interface PlayControllerOptions {
  onActionReceipt?: (receipt: ActionReceipt) => void;
}
/** Board outcome show durations; the CSS in grid.css must finish within. */
const WIN_OUTCOME_ANIM_MS = 1500;
const LOSE_OUTCOME_ANIM_MS = 900;

export function canSettleTerminalRun(
  phase: string,
  sessionAuthorized: boolean,
  recoveryRunId: bigint | null = null,
): boolean {
  if (recoveryRunId !== null) return false;
  return phase === "settleable" || (phase === "delegated" && sessionAuthorized);
}

function isTerminalLifecycle(lifecycle: string): boolean {
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
): PendingLevelCompletion {
  const gameLevel = rulesToGameLevelData(
    activeRun.rules,
    activeRun.level,
    activeRun.runId,
  );
  const isIncomplete = activeRun.lifecycle === "finished";
  return {
    level: activeRun.level,
    levelMoves: activeRun.moves,
    prevTotalScore: 0,
    totalScore: activeRun.score,
    gameLevel,
    isIncomplete,
  };
}

export function settleStageLabel(stage: SettleStage | null): string {
  switch (stage) {
    case "abandoning":
      return "Abandoning run…";
    case "delegating":
      return "Resuming run on MagicBlock…";
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

export function bonusEarnReceipt(
  before: ActiveRunView,
  after: ActiveRunView,
  source: ActionReceipt["source"],
): ActionReceipt | null {
  const expectedCharges = source === "bonus"
    ? Math.max(0, before.bonusCharges - 1)
    : before.bonusCharges;
  const chargesGained = Math.max(0, after.bonusCharges - expectedCharges);
  if (chargesGained === 0) return null;
  return {
    actionCounter: after.actionCounter,
    chargesGained,
    linesCleared: Math.max(
      0,
      after.totalLinesCleared - before.totalLinesCleared,
    ),
    levelLinesCleared: after.levelLinesCleared,
    source,
  };
}

function snapshotRun(
  activeRun: ActiveRunView,
  levelStars: readonly number[],
): TerminalRunSnapshot {
  void levelStars;
  return {
    activeRun,
    game: new Game(activeRun, levelStars),
    gameLevel: rulesToGameLevelData(
      activeRun.rules,
      activeRun.level,
      activeRun.runId,
    ),
    isBoss: activeRun.level === 10 || activeRun.rules.bossId > 0,
    isDaily: activeRun.mode !== "campaign",
    completed: activeRun.lifecycle === "levelComplete",
  };
}

export function usePlayController(options: PlayControllerOptions = {}) {
  const run = useRun();
  const campaign = useCampaign();
  const daily = useDaily();
  const { playSfx, duck, unduck } = useMusicPlayer();
  const navigate = useNavigationStore((state) => state.navigate);
  const setRecoveryRunId = useNavigationStore(
    (state) => state.setRecoveryRunId,
  );
  const recoveryRunId = useNavigationStore((state) => state.recoveryRunId);
  const setPendingLevelCompletion = useNavigationStore(
    (state) => state.setPendingLevelCompletion,
  );
  const [localActionPending, setLocalActionPending] = useState(false);
  // Observable twin of terminalAwaitingCascadeRef: true from the moment a
  // move/bonus lands a terminal lifecycle until the client cascade finishes
  // (onCascadeComplete). The board keeps rendering/animating the final cascade
  // while this is true; PlayScreen defers the level-complete overlay on it, so
  // the chain settling in the background never cuts the animation short.
  const [awaitingTerminalCascade, setAwaitingTerminalCascade] = useState(false);
  const [terminalSnapshot, setTerminalSnapshot] =
    useState<TerminalRunSnapshot | null>(null);
  const [presentationPhase, setPresentationPhase] =
    useState<TerminalPresentationPhase>("idle");
  const [settlementStatus, setSettlementStatus] =
    useState<SettlementStatus>("idle");
  const [settledReceiptSnapshot, setSettledReceiptSnapshot] =
    useState<RunResultView | null>(null);
  const [settledCleanupStatus, setSettledCleanupStatus] =
    useState<SettledCleanupStatus>("idle");
  const [sessionRenewalStatus, setSessionRenewalStatus] =
    useState<SessionRenewalStatus>("idle");
  const [sessionRenewalVersion, setSessionRenewalVersion] = useState(0);
  const renewingSessionRunRef = useRef<bigint | null>(null);
  const terminalAwaitingCascadeRef = useRef<bigint | null>(null);
  const settlingRunRef = useRef<bigint | null>(null);
  const onActionReceiptRef = useRef(options.onActionReceipt);
  onActionReceiptRef.current = options.onActionReceipt;

  const finalCampaignMapId = campaign.campaign?.maps.reduce(
    (highest, map) => Math.max(highest, map.mapId),
    0,
  ) ?? 0;

  const rememberTerminal = useCallback(
    (activeRun: ActiveRunView) => {
      const levelStars =
        activeRun.mode !== "campaign"
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
        const before = run.activeRun;
        const activeRun = await playMove(row, start, destination);
        if (before) {
          const receipt = bonusEarnReceipt(before, activeRun, "move");
          if (receipt) onActionReceiptRef.current?.(receipt);
        }
        if (isTerminalLifecycle(activeRun.lifecycle)) {
          terminalAwaitingCascadeRef.current = activeRun.runId;
          setAwaitingTerminalCascade(true);
          setPresentationPhase("cascade");
          rememberTerminal(activeRun);
        }
        return projectRunResult(activeRun);
      } finally {
        setLocalActionPending(false);
      }
    },
    [playMove, rememberTerminal, run.activeRun],
  );

  const applyBonus = run.applyBonus;
  const onBonus = useCallback(
    async (row: number, column: number) => {
      setLocalActionPending(true);
      try {
        const before = run.activeRun;
        const activeRun = await applyBonus(row, column);
        if (before) {
          const receipt = bonusEarnReceipt(before, activeRun, "bonus");
          if (receipt) onActionReceiptRef.current?.(receipt);
        }
        if (isTerminalLifecycle(activeRun.lifecycle)) {
          terminalAwaitingCascadeRef.current = activeRun.runId;
          setAwaitingTerminalCascade(true);
          setPresentationPhase("cascade");
          rememberTerminal(activeRun);
        }
        return projectRunResult(activeRun);
      } finally {
        setLocalActionPending(false);
      }
    },
    [applyBonus, rememberTerminal, run.activeRun],
  );

  const onCascadeComplete = useCallback(() => {
    terminalAwaitingCascadeRef.current = null;
    setAwaitingTerminalCascade(false);
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
  const dailyRefresh = daily.refresh;
  const terminalRun =
    run.activeRun && isTerminalLifecycle(run.activeRun.lifecycle)
      ? run.activeRun
      : null;

  // Presentation phase driver. The snapshot is produced either by the action
  // that landed terminal (rememberTerminal → phase already "cascade") or by
  // the settle effect after a remount/recovery (no cascade pending) — both
  // funnel into "outcome" once no cascade is left to wait for. "card" is
  // reached only through the outcome timer below.
  useEffect(() => {
    if (!terminalSnapshot) {
      setPresentationPhase("idle");
      return;
    }
    if (awaitingTerminalCascade) return;
    setPresentationPhase((previous) =>
      previous === "idle" || previous === "cascade" ? "outcome" : previous,
    );
  }, [awaitingTerminalCascade, terminalSnapshot]);

  useEffect(() => {
    if (presentationPhase !== "outcome" || !terminalSnapshot) return;
    const timer = window.setTimeout(
      () => setPresentationPhase("card"),
      terminalSnapshot.completed ? WIN_OUTCOME_ANIM_MS : LOSE_OUTCOME_ANIM_MS,
    );
    return () => window.clearTimeout(timer);
  }, [presentationPhase, terminalSnapshot]);

  // Terminal sfx fires with the board outcome show, not on the raw chain
  // transition — otherwise the sting lands mid-cascade. Star/coin belong to
  // the level-complete card, which sequences them itself.
  const outcomeSfxRunRef = useRef<bigint | null>(null);
  useEffect(() => {
    if (presentationPhase !== "outcome" || !terminalSnapshot) return;
    const runId = terminalSnapshot.activeRun.runId;
    if (outcomeSfxRunRef.current === runId) return;
    outcomeSfxRunRef.current = runId;
    if (terminalSnapshot.isDaily || !terminalSnapshot.completed) {
      playSfx("over");
      return;
    }
    playSfx(
      terminalSnapshot.isBoss
        ? terminalSnapshot.activeRun.mapId === finalCampaignMapId
          ? "victory"
          : "boss-defeat"
        : "levelup",
    );
  }, [finalCampaignMapId, playSfx, presentationPhase, terminalSnapshot]);

  // Duck the music while the outcome show + card own the foreground, so the
  // stings and detonation land clearly. Ref-paired so duck/unduck always
  // balance, including on unmount mid-presentation.
  const duckedRef = useRef(false);
  useEffect(() => {
    const showing =
      presentationPhase === "outcome" || presentationPhase === "card";
    if (showing && !duckedRef.current) {
      duckedRef.current = true;
      duck();
    } else if (!showing && duckedRef.current) {
      duckedRef.current = false;
      unduck();
    }
  }, [duck, presentationPhase, unduck]);

  useEffect(() => {
    return () => {
      if (duckedRef.current) {
        duckedRef.current = false;
        unduck();
      }
    };
  }, [unduck]);

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
    if (settlingRunRef.current === terminalRun.runId) return;

    settlingRunRef.current = terminalRun.runId;
    setSettlementStatus("pending");

    const settle =
      run.phase === "settleable" ? recoverSettlement : settleAndAdvance;
    void (async () => {
      // Start commit/copyback as soon as terminal state is observed. The
      // display-only Campaign-star refresh runs concurrently and never delays
      // the settlement boundary or waits for the local cascade animation.
      const refreshBeforeConsumption = terminalRun.mode !== "campaign"
        ? Promise.resolve(null)
        : campaignRefresh().catch(() => null);
      const settlement = settle().then(
        () => null,
        (cause: unknown) => cause,
      );
      const refreshedCampaign = await refreshBeforeConsumption;
      const levelStars =
        terminalRun.mode !== "campaign"
          ? []
          : ((refreshedCampaign ?? campaign.campaign)?.maps.find(
              (map) => map.mapId === terminalRun.mapId,
            )?.levelStars ?? []);
      // Refresh the already-open presentation in place: same terminal run,
      // now with confirmed Campaign stars for presentation only.
      setTerminalSnapshot(snapshotRun(terminalRun, levelStars));

      const settlementFailure = await settlement;
      if (settlementFailure) throw settlementFailure;
      await Promise.all([campaignRefresh(), dailyRefresh()]);
      // Presentation is user-driven from here: the card/dialog Continue
      // (continueFromTerminal/closeOutcome) unlocks on "complete".
      setSettlementStatus("complete");
    })().catch(() => {
      // The run hook exposes the failure. Keep the per-run guard set until
      // the user explicitly retries so watcher refreshes cannot hammer the
      // settlement pipeline with repeated session-signed transactions.
      setSettlementStatus("failed");
    });
  }, [
    campaign.campaign,
    campaignRefresh,
    dailyRefresh,
    localActionPending,
    recoveryRunId,
    run.phase,
    run.busy,
    run.sessionAuthorized,
    recoverSettlement,
    settleAndAdvance,
    terminalRun,
  ]);

  const retrySettlement = useCallback(() => {
    settlingRunRef.current = null;
    terminalAwaitingCascadeRef.current = null;
    setSettledCleanupStatus("idle");
    setSettlementStatus("idle");
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
      settledReceipt.mode === "campaign" &&
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
    navigate(settledReceipt.mode === "campaign" ? "map" : "arcade");
  }, [
    campaign.campaign?.maps,
    navigate,
    setPendingLevelCompletion,
    settledReceipt,
  ]);

  const closeOutcome = useCallback(() => {
    if (settlementStatus !== "complete") return;
    navigate(terminalSnapshot?.isDaily ? "arcade" : "map");
  }, [navigate, settlementStatus, terminalSnapshot?.isDaily]);

  // Continue from the level-complete card: hand the player back to the plain
  // map — no level pre-selected, they pick the next node themselves.
  const continueFromTerminal = useCallback(() => {
    if (settlementStatus !== "complete" || !terminalSnapshot) return;
    navigate(terminalSnapshot.isDaily ? "arcade" : "map");
  }, [navigate, settlementStatus, terminalSnapshot]);

  const recoverOrphanedBaseRun = useCallback(
    async (runId: bigint) => {
      const signature = await recoverBaseRun(runId);
      await Promise.allSettled([campaignRefresh(), dailyRefresh()]);
      setRecoveryRunId(null);
      navigate("map");
      return signature;
    },
    [
      campaignRefresh,
      dailyRefresh,
      navigate,
      recoverBaseRun,
      setRecoveryRunId,
    ],
  );

  const activeGame = useMemo(() => {
    if (!run.activeRun) return null;
    const stars =
      run.activeRun.mode !== "campaign"
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

  // Which end-of-run surface owns the "card" phase: the boss VictoryDialog,
  // the daily GameOverDialog, or the on-board level-complete card.
  const outcome: PlayOutcome =
    presentationPhase === "card" && terminalSnapshot
      ? terminalSnapshot.isDaily
        ? "daily"
        : terminalSnapshot.isBoss && terminalSnapshot.completed
          ? "victory"
          : null
      : null;
  const showLevelCard =
    presentationPhase === "card" &&
    terminalSnapshot !== null &&
    !terminalSnapshot.isDaily &&
    !(terminalSnapshot.isBoss && terminalSnapshot.completed);

  return {
    run,
    game: activeGame ?? terminalSnapshot?.game ?? null,
    gameLevel: activeGameLevel ?? terminalSnapshot?.gameLevel ?? null,
    activeRun: run.activeRun ?? terminalSnapshot?.activeRun ?? null,
    terminalSnapshot,
    outcome,
    closeOutcome,
    presentationPhase,
    settlementStatus,
    showLevelCard,
    continueFromTerminal,
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
