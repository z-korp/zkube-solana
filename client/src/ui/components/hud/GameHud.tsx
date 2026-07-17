import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import ProgressRing from "@/ui/components/shared/ProgressRing";
import { useLerpNumber } from "@/hooks/useLerpNumber";
import type { GameLevelData } from "@/hooks/useGameLevel";
import { Constraint, ConstraintType } from "@/game/constraint";
import { getThemeImages } from "@/config/themes";
import { CONSTRAINT_ICON_MAP } from "@/config/constraintIcons";
import type { ThemeId } from "@/config/themes";
import {
  HudBarSvg,
  HUD_BAR,
  circleToPercent,
  rectToPercent,
} from "@/ui/components/chrome";
import { getMutatorDef, getMutatorEffects } from "@/config/mutatorConfig";
import { getZoneGuardian, getGuardianPortrait } from "@/config/bossCharacters";
import { isBossLevel } from "@/game/constants";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/elements/tooltip";

interface GameHudProps {
  level: number;
  levelScore: number;
  targetScore: number;
  movesRemaining: number;
  combo: number;
  constraintProgress: number;
  constraint2Progress: number;
  bonusUsedThisLevel: boolean;
  gameLevel: GameLevelData | null;
  activeMutatorId?: number;
  mode?: number;
  totalScore?: number;
  engineScore?: number;
  challengeBonus?: number;
  pressureScore?: number;
  dailyRuleName?: string;
  dailyRuleDescription?: string;
  dailyObjectiveState?: string;
  currentDifficulty?: number;
  endlessThresholds?: readonly number[];
  endlessScoreMultipliersX100?: readonly number[];
  zoneId?: number;
  onBack?: () => void;
}

/** Ring size based on effective container width */
const getRingSize = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const containerW = vw >= 768 ? Math.min(vw * 0.9, vh * 0.55, 680) : vw;
  return Math.round(Math.min(80, Math.max(44, containerW * 0.13)));
};

const TIER_DISPLAY = [
  { name: "Very Easy", color: "#22c55e", emoji: "🟢" },
  { name: "Easy", color: "#84cc16", emoji: "🟡" },
  { name: "Medium", color: "#eab308", emoji: "🟠" },
  { name: "Medium Hard", color: "#f97316", emoji: "🔶" },
  { name: "Hard", color: "#ef4444", emoji: "🔴" },
  { name: "Very Hard", color: "#dc2626", emoji: "💀" },
  { name: "Expert", color: "#9333ea", emoji: "⚡" },
  { name: "Master", color: "#f59e0b", emoji: "👑" },
] as const;

function buildEndlessTiers(
  thresholds: readonly number[],
  multipliers: readonly number[],
) {
  return TIER_DISPLAY.map((display, i) => ({
    ...display,
    threshold: i === 0 ? 0 : (thresholds[i - 1] ?? Number.MAX_SAFE_INTEGER),
    multiplier: `×${(multipliers[i] ?? 100) / 100}`,
  }));
}

const subscribeResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const getConstraintIcon = (type: ConstraintType) => {
  const src = CONSTRAINT_ICON_MAP[type];
  if (!src) return null;
  return (
    <img src={src} alt="" className="w-full h-full rounded-full object-cover" />
  );
};

const getConstraintColor = (
  progress: number,
  count: number,
): "green" | "orange" | "red" | "blue" => {
  if (progress >= count) return "green";
  if (progress > 0) return "orange";
  return "blue";
};

const getConstraintProgress = (progress: number, count: number): number => {
  return count > 0 ? progress / count : 0;
};

const getValueBadge = (
  type: ConstraintType,
  value: number,
): string | undefined => {
  switch (type) {
    case ConstraintType.ComboLines:
      return `${value}+`;
    case ConstraintType.BreakBlocks:
      return `${value}`;
    case ConstraintType.ComboMeter:
      return `${value}`;
    default:
      return undefined;
  }
};

const getProgressBadge = (progress: number, count: number): string => {
  return `${progress}/${count}`;
};

interface ConstraintData {
  type: ConstraintType;
  value: number;
  count: number;
  progress: number;
}

const GameHud: React.FC<GameHudProps> = ({
  level,
  levelScore,
  targetScore,
  movesRemaining,
  combo,
  constraintProgress,
  constraint2Progress,
  gameLevel,
  activeMutatorId = 0,
  mode = 0,
  totalScore = 0,
  engineScore = 0,
  challengeBonus = 0,
  pressureScore = 0,
  dailyRuleName,
  dailyRuleDescription,
  dailyObjectiveState,
  currentDifficulty = 0,
  endlessThresholds = [],
  endlessScoreMultipliersX100 = [],
  zoneId = 1,
  onBack,
}) => {
  const ringSize = useSyncExternalStore(subscribeResize, getRingSize, () => 44);
  const isEndless = mode === 1;
  const isBoss = isBossLevel(level);

  const ENDLESS_TIERS = useMemo(
    () => buildEndlessTiers(endlessThresholds, endlessScoreMultipliersX100),
    [endlessScoreMultipliersX100, endlessThresholds],
  );

  const mutator = getMutatorDef(activeMutatorId);

  const guardian = useMemo(() => getZoneGuardian(zoneId), [zoneId]);
  const portraitSrc = useMemo(() => getGuardianPortrait(zoneId), [zoneId]);

  const [prevDifficulty, setPrevDifficulty] = useState<number | undefined>(
    currentDifficulty,
  );
  const [showDifficultyUp, setShowDifficultyUp] = useState(false);

  const animatedScore =
    useLerpNumber(levelScore, { duration: 300, integer: true }) ?? 0;
  const animatedTotalScore =
    useLerpNumber(totalScore, { duration: 300, integer: true }) ?? 0;
  const animatedPressureScore =
    useLerpNumber(pressureScore, { duration: 300, integer: true }) ?? 0;
  const animatedChallengeBonus =
    useLerpNumber(challengeBonus, { duration: 300, integer: true }) ?? 0;
  const previousChallengeBonus = useRef(challengeBonus);
  const [bonusGain, setBonusGain] = useState(0);

  useEffect(() => {
    const gain = challengeBonus - previousChallengeBonus.current;
    previousChallengeBonus.current = challengeBonus;
    if (gain <= 0) {
      if (challengeBonus === 0) setBonusGain(0);
      return;
    }
    setBonusGain(gain);
    const timer = setTimeout(() => setBonusGain(0), 1_500);
    return () => clearTimeout(timer);
  }, [challengeBonus]);

  // Contract thresholds are moves-USED caps; convert to moves-REMAINING floors
  const maxMoves = gameLevel?.maxMoves ?? 0;
  const star3UsedCap = gameLevel?.star3Threshold ?? 0; // moves used <= this → 3 stars
  const star2UsedCap = gameLevel?.star2Threshold ?? 0; // moves used <= this → 2 stars
  const movesUsed = maxMoves - movesRemaining;

  const scoreProgress =
    targetScore > 0 ? Math.min(1, animatedScore / targetScore) : 0;

  const starsEarned =
    movesUsed <= star3UsedCap ? 3 : movesUsed <= star2UsedCap ? 2 : 1;
  const movesBarColor =
    starsEarned === 3 ? "#22c55e" : starsEarned === 2 ? "#eab308" : "#ef4444";

  const tierIndex = Math.max(
    0,
    Math.min(currentDifficulty, ENDLESS_TIERS.length - 1),
  );
  let scoreTierIndex = 0;
  for (let i = ENDLESS_TIERS.length - 1; i >= 0; i--) {
    if (animatedPressureScore >= ENDLESS_TIERS[i].threshold) {
      scoreTierIndex = i;
      break;
    }
  }
  const effectiveTierIndex = Math.max(tierIndex, scoreTierIndex);
  const currentTier = ENDLESS_TIERS[effectiveTierIndex] ?? ENDLESS_TIERS[0];
  const nextTier = ENDLESS_TIERS[effectiveTierIndex + 1] ?? null;
  const endlessTierProgress = nextTier
    ? Math.max(
        0,
        Math.min(
          1,
          (animatedPressureScore - currentTier.threshold) /
            (nextTier.threshold - currentTier.threshold),
        ),
      )
    : 1;

  useEffect(() => {
    if (
      currentDifficulty !== undefined &&
      prevDifficulty !== undefined &&
      currentDifficulty > prevDifficulty
    ) {
      setShowDifficultyUp(true);
      const timer = setTimeout(() => setShowDifficultyUp(false), 2000);
      setPrevDifficulty(currentDifficulty);
      return () => clearTimeout(timer);
    }
    setPrevDifficulty(currentDifficulty);
  }, [currentDifficulty, prevDifficulty]);

  const constraints = useMemo<ConstraintData[]>(() => {
    const result: ConstraintData[] = [];
    if (gameLevel) {
      if (gameLevel.constraintType !== ConstraintType.None) {
        const isComboMeter =
          gameLevel.constraintType === ConstraintType.ComboMeter;
        result.push({
          type: gameLevel.constraintType,
          value: gameLevel.constraintValue,
          count: isComboMeter
            ? gameLevel.constraintValue
            : gameLevel.constraintCount,
          progress: isComboMeter
            ? Math.min(combo, gameLevel.constraintValue)
            : constraintProgress,
        });
      }
      if (
        gameLevel.constraint2Type !== undefined &&
        gameLevel.constraint2Type !== ConstraintType.None
      ) {
        const isComboMeter =
          gameLevel.constraint2Type === ConstraintType.ComboMeter;
        result.push({
          type: gameLevel.constraint2Type,
          value: gameLevel.constraint2Value,
          count: isComboMeter
            ? gameLevel.constraint2Value
            : gameLevel.constraint2Count,
          progress: isComboMeter
            ? Math.min(combo, gameLevel.constraint2Value)
            : constraint2Progress,
        });
      }
    }
    return result;
  }, [combo, gameLevel, constraintProgress, constraint2Progress]);

  // ─── Tooltip content for the guardian avatar ───
  // The flavor line alone leaves players guessing; always follow it with the
  // mutator's concrete numbers on one compact line.
  const mutatorEffectLine = (endlessMode: boolean) => {
    const effects = getMutatorEffects(mutator, endlessMode);
    if (effects.length === 0) return null;
    return (
      <div className="font-sans text-[10px] font-semibold text-yellow-300">
        {effects.join(" · ")}
      </div>
    );
  };

  const avatarTooltipContent = isEndless ? (
    <div className="flex flex-col gap-1.5 max-w-[200px]">
      <div className="font-sans text-xs font-bold">{guardian.name}</div>
      {dailyRuleName && (
        <div className="font-sans text-[11px] font-semibold text-cyan-300">
          {dailyRuleName}
        </div>
      )}
      {dailyObjectiveState && (
        <div className="font-sans text-[10px] font-bold text-amber-300">
          {dailyObjectiveState}
        </div>
      )}
      {dailyRuleDescription && (
        <div className="font-sans text-[10px] text-slate-300">
          {dailyRuleDescription}
        </div>
      )}
      {activeMutatorId > 0 && (
        <>
          <div className="font-sans text-[10px] text-yellow-400/90">
            {mutator.icon} {mutator.name}: {mutator.description}
          </div>
          {mutatorEffectLine(true)}
        </>
      )}
    </div>
  ) : (
    <div className="flex flex-col gap-1.5 max-w-[200px]">
      <div className="font-sans text-xs font-bold">
        {guardian.name} · {guardian.title}
      </div>
      {isBoss ? (
        <div className="font-sans text-[11px] text-red-400">
          {guardian.trialIntro}
        </div>
      ) : (
        <div className="font-sans text-[11px] text-slate-300">
          Lv.{level} · {guardian.encouragement}
        </div>
      )}
      {activeMutatorId > 0 && (
        <>
          <div className="font-sans text-[10px] text-yellow-400/90">
            {mutator.icon} {mutator.name}: {mutator.description}
          </div>
          {mutatorEffectLine(false)}
        </>
      )}
    </div>
  );

  // ─── Shared socket positions (used by both endless and story) ───
  const guardianPos = circleToPercent(
    HUD_BAR.sockets.guardian,
    HUD_BAR.viewBox,
  );
  const scorePos = rectToPercent(HUD_BAR.sockets.scoreBar, HUD_BAR.viewBox);
  const comboPos = rectToPercent(HUD_BAR.sockets.combo, HUD_BAR.viewBox);
  const movesPos = circleToPercent(HUD_BAR.sockets.moves, HUD_BAR.viewBox);

  if (isEndless) {
    return (
      <div className="w-full shrink-0 px-[clamp(0px,1vw,8px)] pt-[clamp(0px,0.5vh,6px)]">
        <div className="relative z-10 mx-auto w-full max-w-full">
          <HudBarSvg endless />

          <AnimatePresence>
            {showDifficultyUp && (
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.8 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="absolute inset-x-0 -top-8 z-50 flex justify-center"
              >
                <div
                  className="rounded-full px-4 py-1.5 font-display text-sm font-bold text-white shadow-lg"
                  style={{
                    background: currentTier.color,
                    boxShadow: `0 0 20px ${currentTier.color}80`,
                  }}
                >
                  DIFFICULTY UP! → {currentTier.name}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="absolute inset-0">
            {/* Back button */}
            {onBack && (
              <button
                onClick={onBack}
                className="absolute z-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-slate-300 hover:text-white transition-colors"
                style={{
                  top: `${((HUD_BAR.sockets.guardian.cy - HUD_BAR.sockets.guardian.r) / HUD_BAR.viewBox.height) * 100}%`,
                  left: "0%",
                  width: "6%",
                  aspectRatio: "1",
                }}
              >
                <ArrowLeft className="w-[50%] h-[50%]" />
              </button>
            )}

            {/* Guardian portrait with difficulty badge overlay */}
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="absolute rounded-full" style={guardianPos}>
                    <img
                      src={portraitSrc}
                      alt={guardian.name}
                      className="absolute inset-0 w-full h-full rounded-full object-cover overflow-hidden"
                    />
                    {/* Difficulty badge — bottom-right, overlaid on portrait */}
                    <div
                      className="absolute -bottom-2 -right-2 rounded-full min-w-[clamp(20px,6vw,32px)] h-[clamp(20px,6vw,32px)] flex items-center justify-center px-0.5 font-sans text-[clamp(10px,3vw,16px)] font-bold z-10 shadow-[0_0_4px_rgba(0,0,0,0.5)]"
                      style={{
                        background: currentTier.color,
                        border: `1px solid ${currentTier.color}80`,
                      }}
                    >
                      {currentTier.emoji}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="bg-slate-900 border border-slate-500 text-white px-3 py-2 shadow-lg"
                >
                  {avatarTooltipContent}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Daily score is engine score plus objective bonus; pressure drives the tier bar. */}
            <div className="absolute" style={scorePos}>
              <div className="relative w-full h-full flex items-center">
                <div className="w-full h-[clamp(8px,2.5vw,16px)] overflow-hidden rounded-full bg-black/50">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: currentTier.color }}
                    initial={false}
                    animate={{ width: `${endlessTierProgress * 100}%` }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  />
                </div>
                <span className="absolute inset-0 flex items-center justify-center font-sans text-[clamp(8px,2.2vw,14px)] font-black tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] text-white">
                  DAILY {animatedTotalScore}
                </span>
                <span className="absolute left-0 right-0 top-[70%] text-center font-sans text-[clamp(6px,1.5vw,9px)] font-semibold tabular-nums text-slate-300">
                  Engine {engineScore} · Bonus +{animatedChallengeBonus} · P{" "}
                  {animatedPressureScore}
                  {nextTier ? `/${nextTier.threshold}` : " MAX"}
                </span>
                <AnimatePresence>
                  {bonusGain > 0 && (
                    <motion.span
                      key={`${challengeBonus}-${bonusGain}`}
                      initial={{ opacity: 0, y: 8, scale: 0.8 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 1.1 }}
                      className="absolute inset-x-0 -top-5 text-center font-display text-[clamp(8px,2vw,12px)] font-black text-amber-300 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]"
                    >
                      {dailyRuleName} +{bonusGain} BONUS
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Combo Meter */}
            <div
              className="absolute flex items-center justify-center"
              style={comboPos}
            >
              <motion.div
                key={combo}
                animate={combo > 0 ? { scale: [1, 1.3, 1] } : {}}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className={`flex items-center gap-[2px] rounded-full px-[clamp(6px,1.8vw,10px)] h-full font-sans text-[clamp(10px,3vw,16px)] font-bold tabular-nums ${
                  combo >= 3
                    ? "bg-gradient-to-r from-orange-600 to-yellow-500 text-white shadow-[0_0_12px_rgba(250,204,21,0.5)]"
                    : combo > 0
                      ? "bg-gradient-to-r from-orange-800/80 to-red-700/80 text-orange-200"
                      : "bg-slate-800/60 text-slate-500"
                }`}
              >
                <span className="text-[clamp(10px,2.8vw,15px)] leading-none">
                  🔥
                </span>
                <span>{combo > 0 ? combo : "–"}</span>
              </motion.div>
            </div>

            {/* Pressure multiplier and 100-move endurance cap. */}
            <div
              className="absolute flex flex-col items-center justify-center"
              style={movesPos}
            >
              <span className="font-sans text-[clamp(6px,1.6vw,10px)] font-semibold uppercase tracking-wider leading-none text-slate-400">
                MULTI
              </span>
              <span
                className="font-sans text-[clamp(13px,4vw,22px)] font-bold leading-none tabular-nums"
                style={{ color: currentTier.color }}
              >
                {currentTier.multiplier}
              </span>
              <span className="font-sans text-[clamp(5px,1.3vw,8px)] font-bold leading-none text-slate-300">
                {movesRemaining}/{maxMoves} MOVES
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── STORY MODE HUD ───
  // Constraints use center-point positioning so ProgressRing can size itself freely
  const c1Pos = {
    left: `${(HUD_BAR.sockets.constraint1.cx / HUD_BAR.viewBox.width) * 100}%`,
    top: `${(HUD_BAR.sockets.constraint1.cy / HUD_BAR.viewBox.height) * 100}%`,
    transform: "translate(-50%, -50%)",
  };
  const c2Pos = {
    left: `${(HUD_BAR.sockets.constraint2.cx / HUD_BAR.viewBox.width) * 100}%`,
    top: `${(HUD_BAR.sockets.constraint2.cy / HUD_BAR.viewBox.height) * 100}%`,
    transform: "translate(-50%, -50%)",
  };

  // Theme image for regular levels, guardian portrait for boss only
  const themeId = `theme-${Math.min(10, Math.max(1, zoneId))}` as ThemeId;
  const leftSocketSrc = isBoss
    ? portraitSrc
    : getThemeImages(themeId).themeIcon;

  const regularTooltip =
    !isBoss && activeMutatorId > 0 ? (
      <div className="flex flex-col gap-1 max-w-[200px]">
        <div className="font-sans text-xs font-bold">
          {mutator.icon} {mutator.name}
        </div>
        <div className="font-sans text-[11px] text-slate-300">
          {mutator.description}
        </div>
        {mutatorEffectLine(isEndless)}
      </div>
    ) : (
      <div className="flex flex-col gap-1 max-w-[200px]">
        <div className="font-sans text-xs font-bold">
          {guardian.name} · {guardian.title}
        </div>
        <div
          className={`font-sans text-[11px] ${isBoss ? "text-red-400" : "text-slate-300"}`}
        >
          {isBoss
            ? guardian.trialIntro
            : `Lv.${level} · ${guardian.encouragement}`}
        </div>
      </div>
    );

  return (
    <div className="w-full shrink-0 px-[clamp(0px,1vw,8px)] pt-[clamp(0px,0.5vh,6px)]">
      <div className="relative z-10 mx-auto w-full max-w-full">
        <HudBarSvg starsEarned={starsEarned} />

        <div className="absolute inset-0">
          {/* Back button */}
          {onBack && (
            <button
              onClick={onBack}
              className="absolute z-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-slate-300 hover:text-white transition-colors"
              style={{
                top: `${((HUD_BAR.sockets.guardian.cy - HUD_BAR.sockets.guardian.r) / HUD_BAR.viewBox.height) * 100}%`,
                left: "0%",
                width: "6%",
                aspectRatio: "1",
              }}
            >
              <ArrowLeft className="w-[50%] h-[50%]" />
            </button>
          )}

          {/* Portrait + level badge */}
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <motion.div
                  className="absolute rounded-full"
                  style={guardianPos}
                  animate={
                    isBoss
                      ? {
                          boxShadow: [
                            "0 0 8px 2px rgba(239,68,68,0.3)",
                            "0 0 16px 4px rgba(239,68,68,0.6)",
                            "0 0 8px 2px rgba(239,68,68,0.3)",
                          ],
                        }
                      : {}
                  }
                  transition={
                    isBoss
                      ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
                      : {}
                  }
                >
                  <img
                    src={leftSocketSrc}
                    alt={isBoss ? guardian.name : "Zone"}
                    className="absolute inset-0 w-full h-full rounded-full object-cover overflow-hidden"
                  />
                  {/* Level badge — bottom-right, outside portrait circle */}
                  <div
                    className={`absolute -bottom-2 -right-2 rounded-full min-w-[clamp(20px,6vw,32px)] h-[clamp(20px,6vw,32px)] flex items-center justify-center px-0.5 font-sans text-[clamp(10px,3vw,16px)] font-bold z-10 shadow-[0_0_4px_rgba(0,0,0,0.5)] ${
                      isBoss
                        ? "bg-red-600 border border-red-400/50 text-white"
                        : "bg-slate-800 border border-yellow-500/70 text-yellow-300"
                    }`}
                  >
                    {level}
                  </div>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="bg-slate-900 border border-slate-500 text-white px-3 py-2 shadow-lg"
              >
                {regularTooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Score bar — text centered inside */}
          <div className="absolute" style={scorePos}>
            <div className="relative w-full h-full flex items-center">
              <div className="w-full h-[clamp(8px,2.5vw,16px)] overflow-hidden rounded-full bg-black/50">
                <motion.div
                  className={`h-full rounded-full ${isBoss ? "" : "bg-gradient-to-r from-cyan-600 to-cyan-400"}`}
                  style={
                    isBoss
                      ? {
                          background:
                            "linear-gradient(90deg, #ef4444, #22c55e)",
                        }
                      : undefined
                  }
                  initial={false}
                  animate={{ width: `${scoreProgress * 100}%` }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                />
              </div>
              {/* Centered score text inside the bar */}
              <span
                className={`absolute inset-0 flex items-center justify-center font-sans text-[clamp(8px,2.2vw,14px)] font-bold tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] ${
                  isBoss ? "text-red-200" : "text-white"
                }`}
              >
                {animatedScore}/{targetScore}
              </span>
            </div>
          </div>

          {/* Combo Meter — fire badge */}
          <div
            className="absolute flex items-center justify-center"
            style={comboPos}
          >
            <motion.div
              key={combo}
              animate={combo > 0 ? { scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className={`flex items-center gap-[2px] rounded-full px-[clamp(6px,1.8vw,10px)] h-full font-sans text-[clamp(10px,3vw,16px)] font-bold tabular-nums ${
                combo >= 3
                  ? "bg-gradient-to-r from-orange-600 to-yellow-500 text-white shadow-[0_0_12px_rgba(250,204,21,0.5)]"
                  : combo > 0
                    ? "bg-gradient-to-r from-orange-800/80 to-red-700/80 text-orange-200"
                    : "bg-slate-800/60 text-slate-500"
              }`}
            >
              <span className="text-[clamp(10px,2.8vw,15px)] leading-none">
                🔥
              </span>
              <span>{combo > 0 ? combo : "–"}</span>
            </motion.div>
          </div>

          {/* Moves counter */}
          <div
            className="absolute flex flex-col items-center justify-center"
            style={movesPos}
          >
            <span className="font-sans text-[clamp(7px,2vw,12px)] font-semibold uppercase tracking-wider leading-none text-slate-400">
              MOVES
            </span>
            <span
              className={`font-sans text-[clamp(18px,5.5vw,32px)] font-bold leading-none tabular-nums`}
              style={{ color: movesBarColor }}
            >
              {movesRemaining}
            </span>
          </div>

          {/* Constraints — below combo, centered */}
          {constraints.length > 0 && (
            <TooltipProvider delayDuration={200}>
              {constraints.map((c, i) => {
                const pos = i === 0 ? c1Pos : c2Pos;
                const description = Constraint.fromContractValues(
                  c.type,
                  c.value,
                  c.count,
                ).getDescription();
                return (
                  <Tooltip key={`constraint-${i}`}>
                    <TooltipTrigger asChild>
                      <div
                        className="absolute flex items-center justify-center"
                        style={pos}
                      >
                        <ProgressRing
                          progress={getConstraintProgress(c.progress, c.count)}
                          size={ringSize}
                          color={getConstraintColor(c.progress, c.count)}
                          icon={getConstraintIcon(c.type)}
                          badgeBottomLeft={getValueBadge(c.type, c.value)}
                          badgeBottomRight={getProgressBadge(
                            c.progress,
                            c.count,
                          )}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className="border border-slate-500 bg-slate-900 px-2 py-1 text-xs text-white"
                    >
                      {description}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </TooltipProvider>
          )}
        </div>
      </div>
    </div>
  );
};

export default GameHud;
