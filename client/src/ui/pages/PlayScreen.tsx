import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useMusicPlayer } from "@/contexts/hooks";
import { BonusType } from "@/chain/bonusTypes";
import {
  dailyScoringRuleDescription,
  dailyScoringRuleName,
  dailyScoringRuleStatus,
} from "@/chain/dailyRules";
import { getBonusType } from "@/config/mutatorConfig";
import { getThemeId } from "@/config/themes";
import { useGrid } from "@/hooks/useGrid";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { useNavigationStore } from "@/stores/navigationStore";
import GameBoard from "@/ui/components/GameBoard";
import GameOverDialog from "@/ui/components/GameOverDialog";
import VictoryDialog from "@/ui/components/VictoryDialog";
import GameActionBar, {
  type BonusSlot,
} from "@/ui/components/actionbar/GameActionBar";
import { buildTriggerDescription } from "@/ui/components/actionbar/bonusDescription";
import GameHud from "@/ui/components/hud/GameHud";
import ImageAssets from "@/ui/theme/ImageAssets";
import {
  describeRunStartError,
  usePlayController,
} from "@/play/usePlayController";
import "../../grid.css";

export default function PlayScreen() {
  const controller = usePlayController();
  const { run, game, gameLevel, activeRun } = controller;
  const navigate = useNavigationStore((state) => state.navigate);
  const recoveryRunId = useNavigationStore((state) => state.recoveryRunId);
  const { themeTemplate, setThemeTemplate } = useTheme();
  const { setMusicContext, playSfx } = useMusicPlayer();
  const images = ImageAssets(themeTemplate);
  const [activeBonus, setActiveBonus] = useState(BonusType.None);
  const [recoveringRun, setRecoveringRun] = useState(false);
  const activeRunId = activeRun?.runId;
  const activeRunLevel = activeRun?.level;
  const activeRunBossId = activeRun?.rules.bossId;
  const activeRunLifecycle = activeRun?.lifecycle;
  const authoritativeGrid = useGrid({
    gameId: activeRunId,
    shouldLog: false,
  });
  const onRunBonus = controller.onBonus;
  const recoverBaseRun = controller.recoverBaseRun;
  const dismissRun = run.dismissRun;
  const recoveryOwner = run.publicKey.toBase58();

  useEffect(() => {
    if (!activeRun) return;
    const nextTheme = getThemeId(activeRun.mapId);
    if (nextTheme !== themeTemplate) setThemeTemplate(nextTheme);
  }, [activeRun, setThemeTemplate, themeTemplate]);

  useEffect(() => {
    if (
      activeRunId === undefined ||
      activeRunLevel === undefined ||
      activeRunBossId === undefined ||
      activeRunLifecycle === undefined ||
      activeRunLifecycle === "levelComplete" ||
      activeRunLifecycle === "finished" ||
      activeRunLifecycle === "settled" ||
      run.phase !== "delegated"
    ) {
      return;
    }
    const boss = activeRunLevel === 10 || activeRunBossId > 0;
    setMusicContext(boss ? "boss" : "level");
    if (boss) playSfx("boss-intro");
    return () => setMusicContext("main");
  }, [
    activeRunBossId,
    activeRunId,
    activeRunLevel,
    activeRunLifecycle,
    playSfx,
    run.phase,
    setMusicContext,
  ]);

  useEffect(() => {
    setActiveBonus(BonusType.None);
  }, [activeRun?.bonusCharges, activeRun?.bonusType, activeRun?.runId]);

  const bonusSlots = useMemo<BonusSlot[]>(() => {
    if (!activeRun || activeRun.bonusType <= 0) return [];
    const type = activeRun.bonusType as BonusType;
    const info = getBonusType(type);
    return [
      {
        type,
        charges: activeRun.bonusCharges,
        isActive: true,
        icon: info.icon,
        name: info.name,
        description: info.description,
        triggerDescription: buildTriggerDescription(
          activeRun.rules.bonusTriggerType,
          activeRun.rules.bonusThreshold,
          activeRun.rules.startingCharges,
        ),
        startingCharges: activeRun.rules.startingCharges,
        onClick: () => {
          if (activeRun.bonusCharges <= 0) return;
          setActiveBonus((current) =>
            current === type ? BonusType.None : type,
          );
        },
      },
    ];
  }, [activeRun]);

  const bonusDescription =
    activeBonus !== BonusType.None && activeRun
      ? `TAP A BLOCK TO USE ${getBonusType(activeRun.bonusType).name.toUpperCase()}`
      : "";

  const onBonus = useCallback(
    async (row: number, column: number) => {
      const projection = await onRunBonus(row, column);
      setActiveBonus(BonusType.None);
      return projection;
    },
    [onRunBonus],
  );

  const abandonRun = run.abandonRun;
  const [quitting, setQuitting] = useState(false);
  const handleQuit = useCallback(() => {
    // Quit is an on-chain abandon (terminal, zero stars, rent reclaimed).
    // Stay on a "Forfeiting…" screen until the run has really settled
    // on-chain, then return home. Fall back to a local dismiss if the
    // abandon cannot run (e.g. a deployed program that predates abandonRun).
    setQuitting(true);
    void (async () => {
      try {
        await abandonRun();
      } catch {
        dismissRun();
      } finally {
        navigate("home");
      }
    })();
  }, [abandonRun, dismissRun, navigate]);

  /** Local-only escape hatch: forget the marker, never touch the chain. */
  const handleForgetLocally = useCallback(() => {
    dismissRun();
    navigate("home");
  }, [dismissRun, navigate]);

  const handleRecoverBaseRun = useCallback(async () => {
    if (recoveryRunId === null || recoveringRun) return;
    if (
      !window.confirm(
        `Sign one sponsored Devnet transaction for recovered run ${recoveryRunId} and Vault ${recoveryOwner}? It contains consumeRunReceipt (if still unconsumed) and closeSettledActiveRun. The paymaster pays the fee, the run's account rent (ActiveRun, RunShell, RunReceipt) returns to the protocol paymaster that fronted it, and there is no token-transfer instruction.`,
      )
    ) {
      return;
    }
    setRecoveringRun(true);
    try {
      await recoverBaseRun(recoveryRunId);
    } catch {
      // The shared run controller exposes the validation or submission error.
    } finally {
      setRecoveringRun(false);
    }
  }, [recoverBaseRun, recoveringRun, recoveryOwner, recoveryRunId]);

  if (quitting) {
    return (
      <PlaySurface>
        <StatePanel title="Forfeiting run…">
          <img
            src={images.loader}
            alt=""
            className="h-16 w-16 animate-bounce"
          />
          <p className="max-w-sm text-center text-xs text-white/65">
            {controller.settlingLabel} — finishing this run on-chain before
            leaving.
          </p>
        </StatePanel>
      </PlaySurface>
    );
  }

  if (recoveryRunId !== null) {
    const resolving = run.watchStatus?.phase === "resolving";
    const attachedRun = run.phase !== "none";
    return (
      <PlaySurface>
        <StatePanel
          title={
            recoveringRun
              ? "Finalizing recovered run"
              : resolving
                ? "Checking local run state"
                : attachedRun
                  ? "Recovery unavailable"
                  : "Recover settled campaign run"
          }
        >
          {resolving ? (
            <img
              src={images.loader}
              alt=""
              className="h-16 w-16 animate-bounce"
            />
          ) : (
            <p className="max-w-md text-center text-xs text-white/65">
              {run.error ??
                (attachedRun
                  ? "A local run session is already attached. Return Home and resume or forget that run before using public recovery."
                  : `Recovery verifies Vault ${recoveryOwner} and requests one sponsored signature for consumeRunReceipt and closeSettledActiveRun.`)}
            </p>
          )}
          {!resolving && (
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => navigate("home")}
                className="rounded-xl border border-white/20 bg-white/10 px-6 py-2 font-sans text-sm font-bold text-white"
              >
                Back to Home
              </button>
              {!attachedRun && (
                <button
                  type="button"
                  disabled={run.busy || recoveringRun}
                  onClick={() => void handleRecoverBaseRun()}
                  className="rounded-xl bg-emerald-600 px-6 py-2 font-sans text-sm font-bold text-white disabled:opacity-50"
                >
                  {recoveringRun
                    ? "Finalizing…"
                    : `Recover settled run ${recoveryRunId}`}
                </button>
              )}
            </div>
          )}
        </StatePanel>
      </PlaySurface>
    );
  }

  if (controller.settledReceipt) {
    const receipt = controller.settledReceipt;
    const isDailyReceipt = receipt.mode === "daily";
    const dailyBonus = Math.max(0, receipt.dailyScore - receipt.score);
    return (
      <PlaySurface>
        <StatePanel title="Run settled">
          <p className="text-white/75">
            {isDailyReceipt ? "Daily" : "Score"}{" "}
            {isDailyReceipt ? receipt.dailyScore : receipt.score} ·{" "}
            {receipt.moves} moves
          </p>
          {isDailyReceipt && (
            <div className="text-center text-xs text-cyan-100/80">
              <p>
                Engine {receipt.score} · Challenge +{dailyBonus} · Pressure{" "}
                {receipt.pressureScore}
              </p>
              <p>
                Final tier {receipt.finalPressureTier}/7
                {receipt.finalPressureTier === 7
                  ? " · Master pressure reached"
                  : ""}
              </p>
            </div>
          )}
          {controller.settledCleanupStatus === "running" && (
            <p className="text-center text-xs text-cyan-200">
              Recovering ActiveRun rent…
            </p>
          )}
          {controller.settledCleanupStatus === "idle" && (
            <p className="text-center text-xs text-cyan-200">
              Preparing ActiveRun cleanup…
            </p>
          )}
          {run.error && (
            <p className="text-center text-xs text-red-200">{run.error}</p>
          )}
          {controller.settledCleanupStatus === "failed" && (
            <button
              type="button"
              onClick={controller.retrySettlement}
              className="rounded-xl bg-emerald-600 px-5 py-2 font-sans text-xs font-bold text-white"
            >
              Retry settlement
            </button>
          )}
          <button
            type="button"
            disabled={controller.settledCleanupStatus !== "complete"}
            onClick={controller.continueSettled}
            className="rounded-xl bg-cyan-600 px-6 py-3 font-sans font-bold text-white disabled:opacity-50"
          >
            Continue
          </button>
        </StatePanel>
      </PlaySurface>
    );
  }

  if (!game || !activeRun || !gameLevel) {
    // "resolving" = delegate confirmed on base, ER still cloning the account.
    // It self-heals via the watcher; show a spinner + a manual retry, never a
    // dead-end.
    const resolving =
      run.phase === "resolving" || run.watchStatus?.phase === "resolving";
    const preparing = run.busy || resolving;
    const title = resolving
      ? "Resolving MagicBlock run…"
      : preparing
        ? "Preparing game"
        : "Run unavailable";
    return (
      <PlaySurface>
        <StatePanel title={title}>
          {preparing ? (
            <>
              <img
                src={images.loader}
                alt=""
                className="h-16 w-16 animate-bounce"
              />
              {resolving && (
                <p className="max-w-sm text-center text-xs text-white/55">
                  The run is delegated on Solana and the MagicBlock validator is
                  catching up. This usually clears in a few seconds.
                </p>
              )}
            </>
          ) : (
            (() => {
              const rawError = controller.startError ?? run.error;
              const described = rawError
                ? describeRunStartError(rawError)
                : null;
              return (
                <>
                  <p className="max-w-sm text-center text-sm text-white/65">
                    {described?.headline ??
                      "Choose a campaign level or Daily attempt to begin."}
                  </p>
                  {described?.detail && (
                    <p className="max-w-sm break-all text-center text-[10px] text-white/30">
                      {described.detail}
                    </p>
                  )}
                </>
              );
            })()
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {resolving && (
              <button
                type="button"
                onClick={run.retryResolve}
                className="rounded-xl bg-emerald-600 px-6 py-2 font-sans text-sm font-bold text-white"
              >
                Retry now
              </button>
            )}
            {!preparing && (
              <button
                type="button"
                onClick={() => navigate("home")}
                className="rounded-xl border border-white/20 bg-white/10 px-6 py-2 font-sans text-sm font-bold text-white"
              >
                Back to Home
              </button>
            )}
            {(run.phase === "missing" || resolving) && (
              <button
                type="button"
                onClick={handleForgetLocally}
                className="rounded-xl border border-red-300/30 bg-red-950/60 px-6 py-2 font-sans text-sm font-bold text-red-100"
              >
                {run.phase === "missing" ? "Forget missing run" : "Abandon"}
              </button>
            )}
          </div>
        </StatePanel>
      </PlaySurface>
    );
  }

  const chainTerminal =
    activeRun.lifecycle === "levelComplete" ||
    activeRun.lifecycle === "finished" ||
    activeRun.lifecycle === "settled";
  // Hold the level-complete PRESENTATION until the client cascade for the final
  // move has finished. The chain settles in the background, but the overlay,
  // next-line clear and terminal styling wait for onCascadeComplete so the
  // player actually sees the last cascade play out instead of it snapping to
  // the completion screen mid-animation.
  const terminal = chainTerminal && !controller.awaitingTerminalCascade;
  const basePhase = run.phase === "base" || run.phase === "settleable";
  // Lock input across the whole terminal window (including the final cascade),
  // so `chainTerminal` here — not the gated `terminal`.
  const locked =
    run.busy || chainTerminal || basePhase || !run.sessionAuthorized;
  const grid = authoritativeGrid.length > 0 ? authoritativeGrid : game.blocks;
  const firstOccupiedRow = grid.findIndex((row) =>
    row.some((cell) => cell !== 0),
  );
  const occupiedHeight =
    firstOccupiedRow < 0 ? 0 : grid.length - firstOccupiedRow;
  const nextLine = terminal ? [] : game.nextRow;
  const movesDisplay =
    game.mode === 1
      ? game.levelMoves
      : Math.max(0, gameLevel.maxMoves - game.levelMoves);

  return (
    <PlaySurface>
      {controller.outcome === "daily" && (
        <GameOverDialog isOpen onClose={controller.closeOutcome} game={game} />
      )}
      {controller.outcome === "victory" && (
        <VictoryDialog
          isOpen
          onClose={controller.closeOutcome}
          game={game}
          finalCampaignMapId={controller.finalCampaignMapId}
        />
      )}

      <GameHud
        level={game.level}
        levelScore={game.levelScore}
        targetScore={gameLevel.pointsRequired}
        movesRemaining={movesDisplay}
        combo={game.combo}
        constraintProgress={game.constraintProgress}
        constraint2Progress={game.constraint2Progress}
        bonusUsedThisLevel={false}
        gameLevel={gameLevel}
        activeMutatorId={activeRun.rules.activeMutatorId}
        mode={game.mode}
        totalScore={game.totalScore}
        engineScore={game.engineScore}
        challengeBonus={game.challengeBonus}
        pressureScore={game.pressureScore}
        dailyRuleName={
          game.mode === 1
            ? dailyScoringRuleName(activeRun.dailyScoringRule)
            : undefined
        }
        dailyRuleDescription={
          game.mode === 1
            ? dailyScoringRuleDescription(activeRun.dailyScoringRule)
            : undefined
        }
        dailyObjectiveState={
          game.mode === 1
            ? dailyScoringRuleStatus(activeRun.dailyScoringRule, occupiedHeight)
            : undefined
        }
        currentDifficulty={game.currentDifficulty}
        endlessThresholds={activeRun.endlessThresholds}
        endlessScoreMultipliersX100={activeRun.endlessScoreMultipliersX100}
        zoneId={game.zoneId}
        onBack={
          chainTerminal || basePhase || run.busy
            ? undefined
            : () => navigate(game.mode === 1 ? "daily" : "map")
        }
      />

      {run.error && (
        <div className="bg-red-950/85 px-3 py-1 text-center font-sans text-xs text-red-200">
          {run.error}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-end overflow-hidden px-2 py-1">
        <div
          className={`flex h-full min-h-0 w-full flex-col items-center ${locked ? "pointer-events-none" : ""}`}
        >
          <GameBoard
            initialGrid={grid}
            nextLine={nextLine}
            game={game}
            activeBonus={activeBonus}
            bonusDescription={bonusDescription}
            onCascadeComplete={controller.onCascadeComplete}
            forceTxProcessing={locked}
            levelTransitionPending={false}
            onMove={controller.onMove}
            onBonus={onBonus}
          />
        </div>

        {(terminal || basePhase) && (
          <div className="absolute inset-x-4 bottom-4 z-50 rounded-2xl border border-yellow-300/30 bg-black/85 p-4 text-center backdrop-blur-xl">
            <p className="font-display text-xl text-yellow-300">
              {activeRun.lifecycle === "levelComplete"
                ? "Level complete"
                : "Run finished"}
            </p>
            <p className="mt-1 font-sans text-xs font-bold text-cyan-200">
              {!run.sessionAuthorized && run.phase === "delegated"
                ? controller.sessionRenewalStatus === "failed"
                  ? "Session renewal failed."
                  : "Renewing session…"
                : basePhase
                  ? run.phase === "settleable"
                    ? "Finalizing settlement on Solana…"
                    : "Result copied to the Solana base layer…"
                  : controller.settlingLabel}
            </p>
            {!run.sessionAuthorized && run.phase === "delegated" ? (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {controller.sessionRenewalStatus === "failed" && (
                  <button
                    type="button"
                    disabled={run.busy}
                    onClick={controller.retrySessionRenewal}
                    className="rounded-xl bg-purple-600 px-5 py-2 font-sans text-xs font-bold text-white disabled:opacity-50"
                  >
                    Retry session
                  </button>
                )}
                <button
                  type="button"
                  disabled={run.busy}
                  onClick={handleForgetLocally}
                  className="rounded-xl border border-white/20 bg-white/10 px-5 py-2 font-sans text-xs font-bold text-white disabled:opacity-50"
                >
                  Forget run locally
                </button>
              </div>
            ) : run.error && run.phase === "delegated" && terminal ? (
              <button
                type="button"
                onClick={controller.retrySettlement}
                className="mt-3 rounded-xl bg-emerald-600 px-5 py-2 font-sans text-xs font-bold text-white"
              >
                Retry settlement
              </button>
            ) : null}
            {run.phase === "settleable" && run.error && (
              <button
                type="button"
                onClick={controller.retrySettlement}
                className="mt-3 rounded-xl bg-emerald-600 px-5 py-2 font-sans text-xs font-bold text-white"
              >
                Retry settlement
              </button>
            )}
            {(run.phase === "base" ||
              (run.phase === "settleable" && run.error)) && (
              <button
                type="button"
                onClick={handleQuit}
                className="mt-3 rounded-xl border border-white/20 bg-white/10 px-5 py-2 font-sans text-xs font-bold text-white"
              >
                Abandon run
              </button>
            )}
          </div>
        )}

        {!run.sessionAuthorized && run.phase === "delegated" && !terminal && (
          <div className="absolute inset-x-4 bottom-4 z-50 rounded-2xl border border-purple-300/30 bg-black/90 p-4 text-center">
            <p className="font-display text-xl text-purple-300">
              {controller.sessionRenewalStatus === "failed"
                ? "Session renewal failed"
                : "Renewing session…"}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {controller.sessionRenewalStatus === "failed" && (
                <button
                  type="button"
                  disabled={run.busy}
                  onClick={controller.retrySessionRenewal}
                  className="rounded-xl bg-purple-600 px-6 py-2 font-sans text-sm font-bold text-white disabled:opacity-50"
                >
                  Retry session
                </button>
              )}
              <button
                type="button"
                disabled={run.busy}
                onClick={handleForgetLocally}
                className="rounded-xl border border-white/20 bg-white/10 px-6 py-2 font-sans text-sm font-bold text-white disabled:opacity-50"
              >
                Forget run locally
              </button>
            </div>
          </div>
        )}
      </div>

      {!terminal && !basePhase && run.sessionAuthorized && (
        <GameActionBar
          bonusSlots={bonusSlots}
          activeBonus={activeBonus}
          bonusDescription={bonusDescription}
          onSurrender={handleQuit}
          surrenderDisabled={run.busy}
          isGameOver={false}
          zoneId={game.zoneId}
          activeMutatorId={activeRun.rules.activeMutatorId}
        />
      )}
    </PlaySurface>
  );
}

function PlaySurface({ children }: { children: ReactNode }) {
  // In-game background is the themed stone tablet (matching the original), not
  // the scenic zone art — blocks read clearly on it. The scenic background
  // stays on home/map. Both come from the active `data-theme` CSS variables.
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{
        backgroundImage: "var(--theme-grid-bg-image, none)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundColor: "var(--theme-grid-bg, #10172A)",
      }}
    >
      {children}
    </div>
  );
}

function StatePanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-white/15 bg-black/70 p-6 text-white shadow-2xl backdrop-blur-xl">
        <h1 className="font-display text-3xl text-white">{title}</h1>
        {children}
      </div>
    </div>
  );
}
