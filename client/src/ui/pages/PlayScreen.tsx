import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useMusicPlayer } from "@/contexts/hooks";
import { BonusType } from "@/core/bonusTypes";
import type { Game } from "@/game/model";
import { dailyThemeDescription } from "@/game/constraint";
import { getGuardianDef } from "@/config/mutatorConfig";
import { getThemeColors, getThemeId, type ThemeId } from "@/config/themes";
import { useGrid } from "@/hooks/useGrid";
import { canSubmitRunMove } from "@/chain/useRunController";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import {
  useNavigationStore,
  type PendingLevelCompletion,
} from "@/stores/navigationStore";
import GameBoard from "@/ui/components/GameBoard";
import GameOverDialog from "@/ui/components/GameOverDialog";
import LevelCompleteDialog from "@/ui/components/LevelCompleteDialog";
import VictoryDialog from "@/ui/components/VictoryDialog";
import {
  buildTriggerDescription,
  triggerFactProgress,
} from "@/ui/components/actionbar/bonusDescription";
import BoardHud from "@/ui/components/hud/BoardHud";
import BoardRail from "@/ui/components/hud/BoardRail";
import ScoreChips, {
  CHIP_FLIGHT_MS,
  CHIP_STAGGER_MS,
  type ScoreChip,
} from "@/ui/components/hud/ScoreChips";
import {
  bonusDisplay,
  REROLL_DISPLAY,
  type BonusSlot,
} from "@/ui/components/hud/bonusSlot";
import { useGuardianMood } from "@/ui/components/hud/useGuardianMood";
import ImageAssets from "@/ui/theme/ImageAssets";
import { BOARD_WELL, stoneSurface } from "@/ui/theme/stoneSurface";
import {
  describeRunStartError,
  usePlayController,
  type ActionReceipt,
} from "@/play/usePlayController";
import "../../grid.css";

// The two recesses the two boards land in. Fixed by BoardHud's layout, and the
// HUD sits at the very top of the play surface, so these are viewport points.
const SCORE_SEAT = { x: 71, y: 85 };
const OBJECTIVE_SEAT = { x: 359, y: 85 };
const COACH_MARKS_KEY = "zkube:settings:coach-marks:v1";

type CoachMarks = { move: boolean; charge: boolean; reroll: boolean };

function loadCoachMarks(): CoachMarks {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(COACH_MARKS_KEY) ?? "{}",
    );
    return {
      move: saved.move === true,
      charge: saved.charge === true,
      reroll: saved.reroll === true,
    };
  } catch {
    return { move: false, charge: false, reroll: false };
  }
}

function playerFacingRunError(error: string | null): string | null {
  if (!error) return null;
  if (
    /\b(?:MagicBlock|ActiveRun|VRF|oracle|PDA|rent|delegat\w*|Solana base layer)\b/i.test(
      error,
    )
  ) {
    return "Something interrupted your run. Retry when you are ready.";
  }
  return error;
}

export default function PlayScreen() {
  const pendingBonusEarnRef = useRef(false);
  const lastBonusReceiptActionRef = useRef<number | null>(null);
  const handleActionReceipt = useCallback((receipt: ActionReceipt) => {
    if (
      receipt.chargesGained <= 0 ||
      lastBonusReceiptActionRef.current === receipt.actionCounter
    )
      return;
    lastBonusReceiptActionRef.current = receipt.actionCounter;
    pendingBonusEarnRef.current = true;
  }, []);
  const controller = usePlayController({
    onActionReceipt: handleActionReceipt,
  });
  const { run, game, gameLevel, activeRun } = controller;
  const navigate = useNavigationStore((state) => state.navigate);
  const recoveryRunId = useNavigationStore((state) => state.recoveryRunId);
  const pendingLevelCompletion = useNavigationStore(
    (state) => state.pendingLevelCompletion,
  );
  const setPendingLevelCompletion = useNavigationStore(
    (state) => state.setPendingLevelCompletion,
  );
  const mapZoneId = useNavigationStore((state) => state.mapZoneId);
  const { themeTemplate, setThemeTemplate } = useTheme();
  const { setMusicMood, playSfx } = useMusicPlayer();
  const images = ImageAssets(themeTemplate);
  const [activeBonus, setActiveBonus] = useState(BonusType.None);
  const [totemTargetWidth, setTotemTargetWidth] = useState<number | null>(null);
  const [recoveringRun, setRecoveringRun] = useState(false);
  const [nowUnix, setNowUnix] = useState(() => Math.floor(Date.now() / 1_000));
  const [coachMarks, setCoachMarks] = useState<CoachMarks>(loadCoachMarks);
  const markCoach = useCallback((mark: keyof CoachMarks) => {
    setCoachMarks((current) => {
      if (current[mark]) return current;
      const next = { ...current, [mark]: true };
      window.localStorage.setItem(COACH_MARKS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  // HUD hold: the chain confirms a move while its cascade is still animating.
  // Freeze the values the top bar (and the bonus badge) displays at the
  // pre-move snapshot until the cascade lands, so numbers never jump ahead of
  // the board. Board/data flow stays authoritative — this is display-only.
  const [held, setHeld] = useState<{ game: Game; charges: number } | null>(
    null,
  );
  const activeRunId = activeRun?.runId;
  const activeRunLevel = activeRun?.level;
  const activeRunBossId = activeRun?.rules.bossId;
  const authoritativeGrid = useGrid({
    gameId: activeRunId,
    shouldLog: false,
  });
  const onRunBonus = controller.onBonus;
  const onRunReroll = controller.onReroll;
  const recoverBaseRun = controller.recoverBaseRun;
  const dismissRun = run.dismissRun;
  const recoveryOwner = run.publicKey?.toBase58() ?? "disconnected wallet";
  const runErrorCopy = playerFacingRunError(run.error);

  useEffect(() => {
    if (!activeRun) return;
    const nextTheme = getThemeId(activeRun.mapId);
    if (nextTheme !== themeTemplate) setThemeTemplate(nextTheme);
  }, [activeRun, setThemeTemplate, themeTemplate]);

  // Start the in-game track once the run is live, then keep it running through
  // the entire clear presentation (win/lose card + background settlement).
  // Tying the mood to the lifecycle used to flip it to the menu the instant a
  // level cleared; now only leaving PlayScreen restores the menu rotation.
  const setMusicMoodRef = useRef(setMusicMood);
  setMusicMoodRef.current = setMusicMood;
  const inGameMusicStartedRef = useRef(false);
  useEffect(() => {
    if (
      inGameMusicStartedRef.current ||
      activeRunId === undefined ||
      activeRunLevel === undefined ||
      activeRunBossId === undefined ||
      run.phase !== "delegated"
    ) {
      return;
    }
    inGameMusicStartedRef.current = true;
    const boss = activeRunLevel === 10 || activeRunBossId > 0;
    setMusicMood(boss ? "boss" : "level");
    if (boss) playSfx("boss-intro");
  }, [
    activeRunBossId,
    activeRunId,
    activeRunLevel,
    playSfx,
    run.phase,
    setMusicMood,
  ]);

  // Restore the full menu rotation only when leaving the play surface.
  useEffect(() => () => setMusicMoodRef.current("menu"), []);

  useEffect(() => {
    const clock = window.setInterval(
      () => setNowUnix(Math.floor(Date.now() / 1_000)),
      1_000,
    );
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    setActiveBonus(BonusType.None);
    setTotemTargetWidth(null);
  }, [activeRun?.bonusCharges, activeRun?.bonusType, activeRun?.runId]);

  useEffect(() => {
    if (activeBonus !== BonusType.Totem) setTotemTargetWidth(null);
  }, [activeBonus]);

  const bonusDescription =
    activeBonus !== BonusType.None && activeRun
      ? `TAP A BLOCK TO USE ${bonusDisplay(activeRun.bonusType).name.toUpperCase()}`
      : "";

  // Freeze the HUD at the pre-action snapshot; a rejected action never fires
  // onCascadeComplete (Grid recovers straight to WAITING), so failures must
  // release the hold themselves.
  const onRunMove = controller.onMove;
  const handleMove = useCallback(
    async (row: number, start: number, destination: number) => {
      if (game && activeRun) {
        setHeld((prev) => prev ?? { game, charges: activeRun.bonusCharges });
      }
      try {
        const projection = await onRunMove(row, start, destination);
        markCoach("move");
        return projection;
      } catch (error) {
        setHeld(null);
        throw error;
      }
    },
    [activeRun, game, markCoach, onRunMove],
  );

  const onBonus = useCallback(
    async (row: number, column: number) => {
      if (game && activeRun) {
        setHeld((prev) => prev ?? { game, charges: activeRun.bonusCharges });
      }
      try {
        const projection = await onRunBonus(row, column);
        setActiveBonus(BonusType.None);
        return projection;
      } catch (error) {
        setHeld(null);
        throw error;
      }
    },
    [activeRun, game, onRunBonus],
  );

  const bonusSlots = useMemo<BonusSlot[]>(() => {
    if (!activeRun) return [];
    const slots: BonusSlot[] = [];
    if (activeRun.bonusType > 0) {
      const type = activeRun.bonusType as BonusType;
      const info = bonusDisplay(type);
      slots.push({
        type,
        // Displayed count is held until the cascade lands, so it bumps
        // together with the badge-pop; the interaction guard below stays
        // authoritative.
        charges: held?.charges ?? activeRun.bonusCharges,
        isActive: true,
        icon: info.icon,
        name: info.name,
        description: info.description,
        triggerDescription: buildTriggerDescription(
          activeRun.rules.guardian.trigger,
          activeRun.rules.guardian.threshold,
        ),
        triggerProgress:
          triggerFactProgress({
            triggerType: activeRun.rules.guardian.trigger,
            triggerThreshold: activeRun.rules.guardian.threshold,
            levelLinesCleared: activeRun.levelLinesCleared,
            comboCounter: activeRun.comboCounter,
            streak: activeRun.streak,
          }) ?? undefined,
        totemTarget:
          type === BonusType.Totem &&
          activeBonus === BonusType.Totem &&
          totemTargetWidth !== null
            ? {
                width: totemTargetWidth,
                cells:
                  (held?.game ?? game)?.countCellsOfSize(totemTargetWidth) ?? 0,
              }
            : undefined,
        onClick: () => {
          if (activeRun.bonusCharges <= 0) return;
          setActiveBonus((current) =>
            current === type ? BonusType.None : type,
          );
        },
      });
    }
    slots.push({
      type: "reroll",
      charges: activeRun.rerollCharges,
      isActive: true,
      icon: REROLL_DISPLAY.icon,
      name: REROLL_DISPLAY.name,
      description:
        "Replaces the next row · perfect clear awards +1 · hold up to 3",
      triggerDescription: "Held rerolls",
      onClick: () => {
        if (activeRun.rerollCharges <= 0) return;
        void onRunReroll()
          .then(() => markCoach("reroll"))
          .catch(() => undefined);
      },
    });
    return slots;
  }, [
    activeBonus,
    activeRun,
    game,
    held,
    markCoach,
    onRunReroll,
    totemTargetWidth,
  ]);

  // New run/level snapshot changes identity: never carry a hold across runs.
  const gameId = game?.id;
  useEffect(() => {
    setHeld(null);
  }, [gameId]);

  // Bonus-earned feedback: a charge INCREASE within the same run+level means
  // the trigger condition fired. Latch it and celebrate when the cascade that
  // earned it finishes, so the badge pop lands with the line clears. Charge
  // decreases (spending) and run/level rollovers never latch.
  const [bonusEarnSignal, setBonusEarnSignal] = useState(0);
  useEffect(() => {
    lastBonusReceiptActionRef.current = null;
    pendingBonusEarnRef.current = false;
  }, [activeRun?.runId]);

  const onCascadeCompleteFromController = controller.onCascadeComplete;
  const handleCascadeComplete = useCallback(() => {
    // The gain is only knowable now: `held` is the pre-move snapshot, and the
    // live game has the settled cascade.
    const from = clearPointRef.current;
    clearPointRef.current = null;
    if (from && held?.game && game) {
      const isDaily = game.mode === 1;
      const scored =
        (isDaily ? game.totalScore : game.levelScore) -
        (isDaily ? held.game.totalScore : held.game.levelScore);
      const themed = game.challengeBonus - held.game.challengeBonus;
      const launched: ScoreChip[] = [];
      if (scored > 0) {
        launched.push({
          id: (chipIdRef.current += 1),
          from,
          to: SCORE_SEAT,
          amount: scored,
          tone: "score",
        });
      }
      // A move that also satisfies the day's rule feeds the other board, and
      // the second chip is how that becomes visible.
      if (isDaily && themed > 0) {
        launched.push({
          id: (chipIdRef.current += 1),
          from,
          to: OBJECTIVE_SEAT,
          amount: themed,
          tone: "objective",
        });
      }
      if (launched.length > 0) {
        setChips((current) => [...current, ...launched]);
        window.setTimeout(
          () =>
            setChips((current) =>
              current.filter(
                (chip) => !launched.some((one) => one.id === chip.id),
              ),
            ),
          CHIP_FLIGHT_MS + CHIP_STAGGER_MS * launched.length + 60,
        );
      }
    }
    onCascadeCompleteFromController();
    setHeld(null);
    setTotemTargetWidth(null);
    if (pendingBonusEarnRef.current) {
      pendingBonusEarnRef.current = false;
      setBonusEarnSignal((value) => value + 1);
      markCoach("charge");
      playSfx("coin");
    }
  }, [game, held, markCoach, onCascadeCompleteFromController, playSfx]);

  // He answers the board, so the board is what he is given: the ceiling rows,
  // the live chain, and a counter that only moves on a perfect clear.
  const [perfectSignal, setPerfectSignal] = useState(0);
  // Where the last clear happened, held until the cascade lands and the gain
  // is known. The chip leaves from there.
  const clearPointRef = useRef<{ x: number; y: number } | null>(null);
  const [chips, setChips] = useState<ScoreChip[]>([]);
  const chipIdRef = useRef(0);
  const moodGrid =
    authoritativeGrid.length > 0 ? authoritativeGrid : (game?.blocks ?? []);
  const dangerAtCeiling =
    moodGrid.length > 1 &&
    (moodGrid[0]!.some((cell) => cell !== 0) ||
      moodGrid[1]!.some((cell) => cell !== 0));
  const guardianMood = useGuardianMood({
    runId: activeRun?.runId,
    combo: game?.combo ?? 0,
    danger: dangerAtCeiling,
    perfectSignal,
    ended:
      activeRun?.lifecycle === "finished" ||
      activeRun?.lifecycle === "levelComplete"
        ? controller.terminalSnapshot?.completed
          ? "won"
          : "lost"
        : false,
  });

  const abandonRun = run.abandonRun;
  const resumePreparedRun = run.resumePreparedRun;
  const [quitting, setQuitting] = useState(false);
  const handleQuit = useCallback(() => {
    // Quit is an on-chain abandon (terminal, zero stars, rent reclaimed).
    // Stay on a "Forfeiting…" screen until the run has really settled
    // on-chain, then return to Arcade. A failed abandon must keep the durable run
    // attached; forgetting it would hide a still-live active_run_id.
    setQuitting(true);
    void (async () => {
      try {
        await abandonRun();
        navigate("arcade");
      } catch {
        setQuitting(false);
      }
    })();
  }, [abandonRun, navigate]);

  const handleResumePrepared = useCallback(() => {
    void resumePreparedRun().catch(() => {
      // The shared controller keeps the actionable error on the run screen.
    });
  }, [resumePreparedRun]);

  /** Local-only escape hatch: forget the marker, never touch the chain. */
  const handleForgetLocally = useCallback(() => {
    dismissRun();
    navigate("arcade");
  }, [dismissRun, navigate]);

  const handleRecoverBaseRun = useCallback(async () => {
    if (recoveryRunId === null || recoveringRun) return;
    setRecoveringRun(true);
    try {
      await recoverBaseRun(recoveryRunId);
    } catch {
      // The shared run controller exposes the validation or submission error.
    } finally {
      setRecoveringRun(false);
    }
  }, [recoverBaseRun, recoveringRun, recoveryRunId]);

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
              {runErrorCopy ??
                (attachedRun
                  ? "A run is already open. Return to Arcade and resume it before recovering another result."
                  : `This recovery belongs to ${recoveryOwner}. Your enabled device can finish saving it.`)}
            </p>
          )}
          {!resolving && (
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => navigate("arcade")}
                className="rounded-xl border border-white/20 bg-white/10 px-6 py-2 font-sans text-sm font-bold text-white"
              >
                Back to Arcade
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

  if (pendingLevelCompletion) {
    return (
      <PlaySurface>
        <LevelCompletionCard
          completion={pendingLevelCompletion}
          zoneId={mapZoneId}
          colors={getThemeColors(themeTemplate as ThemeId)}
          onClose={() => {
            setPendingLevelCompletion(null);
            navigate("map");
          }}
        />
      </PlaySurface>
    );
  }

  if (controller.settledReceipt) {
    const receipt = controller.settledReceipt;
    const isArcadeReceipt = receipt.mode !== "campaign";
    const dailyBonus = Math.max(0, receipt.dailyScore - receipt.score);
    return (
      <PlaySurface>
        <StatePanel title="Run settled">
          <p className="text-white/75">
            {isArcadeReceipt ? "Daily" : "Score"}{" "}
            {isArcadeReceipt ? receipt.dailyScore : receipt.score} ·{" "}
            {receipt.moves} moves
          </p>
          {isArcadeReceipt && (
            <div className="text-center text-xs text-cyan-100/80">
              <p>
                Score {receipt.score} · Theme +{dailyBonus} · Pressure{" "}
                {receipt.pressureScore}
              </p>
            </div>
          )}
          {controller.settledCleanupStatus === "running" && (
            <p className="text-center text-xs text-cyan-200">
              Your run is being saved…
            </p>
          )}
          {controller.settledCleanupStatus === "idle" && (
            <p className="text-center text-xs text-cyan-200">
              Your run is being saved…
            </p>
          )}
          {runErrorCopy && (
            <p className="text-center text-xs text-red-200">{runErrorCopy}</p>
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
    const resolving =
      run.phase === "resolving" || run.watchStatus?.phase === "resolving";
    const preparing = run.busy || resolving;
    const title = resolving
      ? "Loading your run…"
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
                  Your saved run is catching up. This usually takes only a few
                  seconds.
                </p>
              )}
            </>
          ) : (
            (() => {
              const rawError = run.error;
              const described = rawError
                ? describeRunStartError(rawError)
                : null;
              return (
                <>
                  <p className="max-w-sm text-center text-sm text-white/65">
                    {described?.headline ??
                      "Choose a campaign level or Daily attempt to begin."}
                  </p>
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
                onClick={() => navigate("arcade")}
                className="rounded-xl border border-white/20 bg-white/10 px-6 py-2 font-sans text-sm font-bold text-white"
              >
                Back to Arcade
              </button>
            )}
            {(run.phase === "missing" || resolving) && (
              <button
                type="button"
                onClick={handleForgetLocally}
                className="rounded-xl border border-red-300/30 bg-red-950/60 px-6 py-2 font-sans text-sm font-bold text-red-100"
              >
                {run.phase === "missing" ? "Return to Arcade" : "Abandon"}
              </button>
            )}
          </div>
        </StatePanel>
      </PlaySurface>
    );
  }

  const chainTerminal =
    activeRun.lifecycle === "levelComplete" ||
    activeRun.lifecycle === "finished";
  const deadlineExpired =
    activeRun.mode !== "campaign" &&
    (activeRun.deadlineAt ?? 0) > 0 &&
    nowUnix >= (activeRun.deadlineAt ?? 0) &&
    !chainTerminal;
  if (deadlineExpired) {
    return (
      <PlaySurface>
        <StatePanel title="Daily window closed">
          <p className="max-w-sm text-center text-sm text-white/70">
            Your last accepted score is frozen. The result will finish saving
            automatically.
          </p>
        </StatePanel>
      </PlaySurface>
    );
  }
  // Hold the level-complete PRESENTATION until the client cascade for the final
  // move has finished. The chain settles in the background, but the overlay,
  // next-line clear and terminal styling wait for onCascadeComplete so the
  // player actually sees the last cascade play out instead of it snapping to
  // the completion screen mid-animation.
  const terminal = chainTerminal && !controller.awaitingTerminalCascade;
  const basePhase = run.phase === "base" || run.phase === "settleable";
  // The healthy terminal path is owned by the outcome show + card/dialogs;
  // the status box only surfaces when the player can (or must) act on it.
  const terminalNeedsAttention =
    terminal &&
    ((!run.sessionAuthorized && run.phase === "delegated") ||
      run.error !== null ||
      controller.settlementStatus === "failed");
  // Board outcome show: win detonation, or the loss that matches how the run
  // ended — the stack breaching the top overflows the frame, running out of
  // moves sinks the board.
  const outcomeAnimation =
    (controller.presentationPhase === "outcome" ||
      controller.presentationPhase === "card") &&
    controller.terminalSnapshot
      ? controller.terminalSnapshot.completed
        ? ("win" as const)
        : controller.terminalSnapshot.game.blocks[0]?.some((cell) => cell !== 0)
          ? ("lose-overflow" as const)
          : ("lose-sink" as const)
      : null;
  const preparedBase =
    run.phase === "base" && activeRun.lifecycle === "prepared";
  const waitingForOpening =
    run.phase === "delegated" &&
    activeRun.lifecycle === "awaitingVrf" &&
    activeRun.pendingVrfCounter > 0 &&
    activeRun.moves === 0;
  // Lock input across the whole terminal window (including the final cascade),
  // so `chainTerminal` here — not the gated `terminal`.
  const locked =
    run.busy ||
    !canSubmitRunMove(activeRun, nowUnix) ||
    waitingForOpening ||
    chainTerminal ||
    basePhase ||
    !run.sessionAuthorized;
  const grid = authoritativeGrid.length > 0 ? authoritativeGrid : game.blocks;
  const nextLine = terminal ? [] : game.nextRow;
  // What the top bar displays: pre-move values while a cascade is in flight.
  const hudGame = held?.game ?? game;
  const movesDisplay =
    hudGame.mode === 1
      ? hudGame.levelMoves
      : Math.max(0, gameLevel.maxMoves - hudGame.levelMoves);

  // The chain the day actually pays for. Only the combo family names one; for
  // every other rule two lines is the point a chain starts being a chain.
  const dailyComboThreshold =
    activeRun.dailyTheme?.kind === 3 ? Number(activeRun.dailyTheme.value) : 2;
  const themeSentence = dailyThemeDescription(
    activeRun.dailyTheme,
    getGuardianDef(activeRun.mapId).name,
  );
  const guardianSlot = bonusSlots.find((slot) => slot.type !== "reroll");
  const coachText = !coachMarks.move
    ? "Swipe a block to move it"
    : !coachMarks.charge && guardianSlot
      ? `Earn a charge · ${guardianSlot.triggerDescription}`
      : !coachMarks.reroll
        ? "Reroll replaces the next row"
        : null;

  return (
    <PlaySurface>
      {controller.outcome === "daily" && (
        <GameOverDialog
          isOpen
          onClose={controller.closeOutcome}
          closeDisabled={controller.settlementStatus !== "complete"}
          settlementFailed={controller.settlementStatus === "failed"}
          settlementError={runErrorCopy}
          onRetrySettlement={controller.retrySettlement}
          game={game}
          colors={getThemeColors(themeTemplate as ThemeId)}
        />
      )}
      {controller.outcome === "victory" && (
        <VictoryDialog
          isOpen
          onClose={controller.closeOutcome}
          closeDisabled={controller.settlementStatus !== "complete"}
          game={game}
          finalCampaignMapId={controller.finalCampaignMapId}
          colors={getThemeColors(themeTemplate as ThemeId)}
        />
      )}
      {controller.showLevelCard && controller.terminalSnapshot && (
        <LevelCompletionCard
          onClose={controller.continueFromTerminal}
          continueDisabled={controller.settlementStatus !== "complete"}
          completion={{
            level: controller.terminalSnapshot.activeRun.level,
            levelMoves: controller.terminalSnapshot.activeRun.moves,
            prevTotalScore: 0,
            totalScore: controller.terminalSnapshot.activeRun.score,
            latchedStarSources:
              controller.terminalSnapshot.activeRun.latchedStarSources,
            gameLevel: controller.terminalSnapshot.gameLevel,
            isIncomplete: !controller.terminalSnapshot.completed,
          }}
          zoneId={controller.terminalSnapshot.game.zoneId}
          colors={getThemeColors(themeTemplate as ThemeId)}
        />
      )}

      <ScoreChips chips={chips} />

      <BoardHud
        isDaily={game.mode === 1}
        zoneId={game.zoneId}
        mood={guardianMood}
        score={game.mode === 1 ? hudGame.totalScore : hudGame.levelScore}
        targetScore={gameLevel.pointsRequired}
        themeScore={hudGame.challengeBonus}
        themeDescription={game.mode === 1 ? themeSentence : undefined}
        level={hudGame.level}
        combo={hudGame.combo}
        streak={activeRun.streak ?? 0}
        comboThreshold={dailyComboThreshold}
        pressureScore={hudGame.pressureScore}
        gameLevel={gameLevel}
        constraintProgress={hudGame.constraintProgress}
        constraint2Progress={hudGame.constraint2Progress}
        latchedStarSources={hudGame.latchedStarSources}
      />

      {run.error && (
        <div className="bg-red-950/85 px-3 py-1 text-center font-sans text-xs text-red-200">
          {runErrorCopy}
        </div>
      )}

      {/* No horizontal padding: eight columns on a phone means the cell size is
          decided by width alone, so any inset here is taken straight out of the
          blocks. GameBoard reserves exactly the frame it draws. */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-end overflow-hidden">
        {coachText && (
          <p className="pointer-events-none absolute left-1/2 top-3 z-40 w-max max-w-[82%] -translate-x-1/2 rounded-full border border-cyan-200/25 bg-black/90 px-3 py-1.5 text-center font-sans text-xs font-bold text-cyan-100 shadow-lg">
            {coachText}
          </p>
        )}
        <div
          className={`relative flex h-full min-h-0 w-full flex-col items-center ${locked ? "pointer-events-none" : ""}`}
          style={BOARD_WELL}
        >
          <GameBoard
            initialGrid={grid}
            nextLine={nextLine}
            game={game}
            activeBonus={activeBonus}
            bonusDescription={bonusDescription}
            onCascadeComplete={handleCascadeComplete}
            onPerfectClear={() => setPerfectSignal((n) => n + 1)}
            onClearAt={(point) => {
              clearPointRef.current = point;
            }}
            onBonusTarget={setTotemTargetWidth}
            forceTxProcessing={locked}
            outcomeAnimation={outcomeAnimation}
            onMove={handleMove}
            onBonus={onBonus}
          />
        </div>

        {(terminalNeedsAttention || basePhase) && (
          <div className="absolute inset-x-4 bottom-4 z-50 rounded-2xl border border-yellow-300/30 bg-black/85 p-4 text-center backdrop-blur-xl">
            <p className="font-display text-xl text-yellow-300">
              {preparedBase
                ? "Run ready"
                : activeRun.lifecycle === "levelComplete"
                  ? "Level complete"
                  : "Run finished"}
            </p>
            <p className="mt-1 font-sans text-xs font-bold text-cyan-200">
              {!run.sessionAuthorized && run.phase === "delegated"
                ? controller.sessionRenewalStatus === "failed"
                  ? "Session renewal failed."
                  : "Renewing session…"
                : basePhase
                  ? preparedBase
                    ? run.busy
                      ? "Loading your run…"
                      : "Your run is ready. Continue or abandon it."
                    : run.phase === "settleable"
                      ? "Your run is being saved…"
                      : "Your result is ready to save…"
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
                  Return to Arcade
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
            {preparedBase && (
              <button
                type="button"
                disabled={run.busy || !run.sessionAuthorized}
                onClick={handleResumePrepared}
                className="mt-3 rounded-xl bg-emerald-600 px-5 py-2 font-sans text-xs font-bold text-white disabled:opacity-50"
              >
                {run.busy ? "Resuming…" : "Resume run"}
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

        {waitingForOpening && (
          <div className="absolute inset-x-4 bottom-4 z-50 rounded-2xl border border-cyan-300/30 bg-black/90 p-4 text-center backdrop-blur-xl">
            <p className="font-display text-xl text-cyan-200">
              Waiting for the next row…
            </p>
            <p className="mt-1 font-sans text-xs text-white/65">
              Your run will continue here as soon as the row arrives.
            </p>
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
                Return to Arcade
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Always mounted: unmounting the rail changes the flex space above it,
          which resizes every grid cell via GameBoard's ResizeObserver. During
          the terminal/settlement window it stays as an inert height-holder. */}
      <BoardRail
        themeId={themeTemplate as ThemeId}
        bonusSlots={bonusSlots}
        activeBonus={activeBonus}
        bonusEarnSignal={bonusEarnSignal}
        disabled={chainTerminal || basePhase || !run.sessionAuthorized}
        movesRemaining={movesDisplay}
        maxMoves={gameLevel.maxMoves}
        runId={activeRun.runId}
        deadlineSecondsRemaining={
          game.mode === 1 && activeRun.deadlineAt
            ? Math.max(0, activeRun.deadlineAt - nowUnix)
            : undefined
        }
        onHome={
          chainTerminal || basePhase || run.busy
            ? undefined
            : () => navigate(game.mode === 1 ? "arcade" : "map")
        }
        onSurrender={handleQuit}
        surrenderDisabled={
          run.busy || chainTerminal || basePhase || !run.sessionAuthorized
        }
      />
    </PlaySurface>
  );
}

function LevelCompletionCard({
  completion,
  zoneId,
  colors,
  onClose,
  continueDisabled = false,
}: {
  completion: PendingLevelCompletion;
  zoneId: number;
  colors: ReturnType<typeof getThemeColors>;
  onClose: () => void;
  continueDisabled?: boolean;
}) {
  return (
    <LevelCompleteDialog
      isOpen
      onClose={onClose}
      continueDisabled={continueDisabled}
      level={completion.level}
      levelMoves={completion.levelMoves}
      prevTotalScore={completion.prevTotalScore}
      totalScore={completion.totalScore}
      latchedStarSources={completion.latchedStarSources}
      gameLevel={completion.gameLevel}
      zoneId={zoneId}
      colors={colors}
      isIncomplete={completion.isIncomplete}
    />
  );
}

function PlaySurface({ children }: { children: ReactNode }) {
  // One stone, floor to ceiling, and the board is a well cut into it. The
  // scenic realm art stays on the menus: three painted grounds fighting is a
  // collage, and the one the blocks sit on has to win.
  const { themeTemplate } = useTheme();
  const stone = useMemo(
    () => stoneSurface(getThemeColors(themeTemplate as ThemeId)),
    [themeTemplate],
  );
  return (
    <div className="relative flex h-full min-h-0 flex-col" style={stone}>
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
