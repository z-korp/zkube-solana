import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useMusicPlayer } from "@/contexts/hooks";
import { BonusType } from "@/dojo/game/types/bonusTypes";
import { getBonusType } from "@/config/mutatorConfig";
import { getThemeId } from "@/config/themes";
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
  const { themeTemplate, setThemeTemplate } = useTheme();
  const { setMusicContext, playSfx } = useMusicPlayer();
  const images = ImageAssets(themeTemplate);
  const [activeBonus, setActiveBonus] = useState(BonusType.None);
  const activeRunId = activeRun?.runId;
  const activeRunLevel = activeRun?.level;
  const activeRunBossId = activeRun?.rules.bossId;
  const activeRunLifecycle = activeRun?.lifecycle;
  const onRunBonus = controller.onBonus;
  const dismissRun = run.dismissRun;

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

  const handleQuit = useCallback(() => {
    dismissRun();
    navigate("home");
  }, [dismissRun, navigate]);

  if (run.phase === "settled" && run.receipt) {
    return (
      <PlaySurface background={images.background}>
        <StatePanel title="Run settled">
          <p className="text-white/75">
            Score {run.receipt.score} · {run.receipt.moves} moves
          </p>
          <button
            type="button"
            disabled={run.busy}
            onClick={() =>
              void controller.finishSettled().catch(() => undefined)
            }
            className="rounded-xl bg-cyan-600 px-6 py-3 font-sans font-bold text-white disabled:opacity-50"
          >
            {run.busy ? "Recovering rent…" : "Collect rent & continue"}
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
                  onClick={handleQuit}
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
  const grid = game.blocks;
  const nextLine = terminal ? [] : game.next_row;
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
                ? "Renew the run session to seal this result."
                : basePhase
                  ? run.phase === "settleable"
                    ? "Finalizing settlement on Solana…"
                    : "Result copied to the Solana base layer…"
                  : controller.settlingLabel}
            </p>
            {!run.sessionAuthorized && run.phase === "delegated" ? (
              <button
                type="button"
                disabled={run.busy}
                onClick={() => void run.recoverSession().catch(() => undefined)}
                className="mt-3 rounded-xl bg-purple-600 px-5 py-2 font-sans text-xs font-bold text-white disabled:opacity-50"
              >
                {run.busy ? "Renewing…" : "Renew session"}
              </button>
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
                Dismiss stuck run
              </button>
            )}
          </div>
        )}

        {!run.sessionAuthorized && run.phase === "delegated" && !terminal && (
          <div className="absolute inset-x-4 bottom-4 z-50 rounded-2xl border border-purple-300/30 bg-black/90 p-4 text-center">
            <p className="font-display text-xl text-purple-300">
              Session expired
            </p>
            <button
              type="button"
              disabled={run.busy}
              onClick={() => void run.recoverSession().catch(() => undefined)}
              className="mt-3 rounded-xl bg-purple-600 px-6 py-2 font-sans text-sm font-bold text-white disabled:opacity-50"
            >
              Renew session
            </button>
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
