import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useMusicPlayer } from "@/contexts/hooks";
import { BonusType } from "@/chain/bonusTypes";
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
import { usePlayController } from "@/play/usePlayController";
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
  const handleQuit = useCallback(() => {
    // Quit is an on-chain abandon (terminal, zero stars, rent reclaimed);
    // navigation is immediate and settlement continues in the background.
    // Fall back to forgetting the local marker if the abandon cannot run
    // (e.g. a deployed program that predates abandonRunV1).
    void (async () => {
      try {
        await abandonRun();
      } catch {
        dismissRun();
      }
    })();
    navigate("home");
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
        `Sign one sponsored Devnet transaction for recovered run ${recoveryRunId} and Vault ${recoveryOwner}? It contains consumeSponsorshipV1, consumeRunReceiptV1 (if still unconsumed), and closeSettledActiveRunV1. The sponsorship allowance is updated, the paymaster pays the fee, ActiveRun rent returns to this Vault, and there is no token-transfer instruction.`,
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

  if (recoveryRunId !== null) {
    const resolving = run.watchStatus?.phase === "resolving";
    const attachedRun = run.phase !== "none";
    return (
      <PlaySurface background={images.background}>
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
                  : `Recovery verifies Vault ${recoveryOwner} and requests one sponsored signature for consumeSponsorshipV1, consumeRunReceiptV1, and closeSettledActiveRunV1.`)}
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
    return (
      <PlaySurface background={images.background}>
        <StatePanel title="Run settled">
          <p className="text-white/75">
            Score {controller.settledReceipt.score} ·{" "}
            {controller.settledReceipt.moves} moves
          </p>
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
    const preparing = run.busy || run.watchStatus?.phase === "resolving";
    return (
      <PlaySurface background={images.background}>
        <StatePanel title={preparing ? "Preparing game" : "Run unavailable"}>
          {preparing ? (
            <img
              src={images.loader}
              alt=""
              className="h-16 w-16 animate-bounce"
            />
          ) : (
            <p className="max-w-sm text-center text-sm text-white/65">
              {controller.startError ??
                run.error ??
                "Choose a campaign level or Daily attempt to begin."}
            </p>
          )}
          {!preparing && (
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => navigate("home")}
                className="rounded-xl border border-white/20 bg-white/10 px-6 py-2 font-sans text-sm font-bold text-white"
              >
                Back to Home
              </button>
              {run.phase === "missing" && (
                <button
                  type="button"
                  onClick={handleForgetLocally}
                  className="rounded-xl border border-red-300/30 bg-red-950/60 px-6 py-2 font-sans text-sm font-bold text-red-100"
                >
                  Forget missing run
                </button>
              )}
            </div>
          )}
        </StatePanel>
      </PlaySurface>
    );
  }

  const terminal =
    activeRun.lifecycle === "levelComplete" ||
    activeRun.lifecycle === "finished" ||
    activeRun.lifecycle === "settled";
  const basePhase = run.phase === "base" || run.phase === "settleable";
  const locked = run.busy || terminal || basePhase || !run.sessionAuthorized;
  const grid = authoritativeGrid.length > 0 ? authoritativeGrid : game.blocks;
  const nextLine = terminal ? [] : game.nextRow;
  const movesDisplay =
    game.mode === 1
      ? game.levelMoves
      : Math.max(0, gameLevel.maxMoves - game.levelMoves);

  return (
    <PlaySurface background={images.background}>
      {controller.outcome === "daily" && (
        <GameOverDialog isOpen onClose={controller.closeOutcome} game={game} />
      )}
      {controller.outcome === "victory" && (
        <VictoryDialog isOpen onClose={controller.closeOutcome} game={game} />
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
        currentDifficulty={game.currentDifficulty}
        endlessThresholds={activeRun.endlessThresholds}
        endlessScoreMultipliersX100={activeRun.endlessScoreMultipliersX100}
        zoneId={game.zoneId}
        onBack={
          terminal || basePhase || run.busy
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
          className={`flex h-full min-h-0 w-full flex-col items-center ${locked ? "pointer-events-none opacity-60" : ""}`}
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

function PlaySurface({
  background,
  children,
}: {
  background: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-[#10172a]"
      style={{
        backgroundImage: `url('${background}')`,
        backgroundPosition: "center",
        backgroundSize: "cover",
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
