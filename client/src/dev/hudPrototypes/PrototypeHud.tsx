/**
 * DEV-ONLY in-run header prototypes, so three layouts can be compared on the
 * real screen instead of argued about in ASCII.
 *
 * Reach them with `?dev=1&page=play&board=arena&hud=slab|towers|hero`.
 *
 * Every element the shipped HUD carries is placed in all three — guardian and
 * its tier/level badge, score, multiplier, moves, combo, stars, both
 * constraints, the objective name — because a layout that quietly drops one is
 * not a layout, it is a mock. What differs is which of them is allowed to be
 * big.
 *
 * Whichever wins gets promoted into `ui/components/hud/` and the losers are
 * deleted; nothing here is meant to survive the decision.
 */
import { motion } from "motion/react";
import { ArrowLeft, Flame } from "lucide-react";

import { CONSTRAINT_ICON_MAP } from "@/config/constraintIcons";
import { ConstraintType } from "@/game/constraint";
import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import type { GameLevelData } from "@/hooks/useGameLevel";
import { useLerpNumber } from "@/hooks/useLerpNumber";
import { buildTierScale, currentTierIndex } from "./tierScale";

export type HudVariant = "slab" | "towers" | "hero";

export interface FieldStanding {
  /** Provisional rank among today's qualified players. */
  rank: number;
  entrants: number;
  /** The score of the place directly above, and who holds it. */
  nextScore: number;
  nextName: string;
}

export interface PrototypeHudProps {
  variant: HudVariant;
  isDaily: boolean;
  zoneId: number;
  level: number;
  /** Daily total, or campaign level score. */
  score: number;
  targetScore: number;
  engineScore: number;
  challengeBonus: number;
  pressureScore: number;
  currentDifficulty: number;
  endlessThresholds: readonly number[];
  endlessScoreMultipliersX100: readonly number[];
  movesRemaining: number;
  maxMoves: number;
  combo: number;
  starsEarned: number;
  gameLevel: GameLevelData | null;
  constraintProgress: number;
  constraint2Progress: number;
  objectiveName?: string;
  field: FieldStanding | null;
  onBack?: () => void;
}

const PANEL: React.CSSProperties = {
  background: "linear-gradient(180deg, #101A2E 0%, #0A1120 100%)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow: "0 3px 0 #04070F, inset 0 1px 0 rgba(255,255,255,0.08)",
};

/**
 * Counting numerals are sans-black with tabular figures, never the display
 * face: a proportional numeral changes width as it ticks, so a score counting
 * up jitters sideways the whole time it climbs.
 */
const NUMERALS = "font-sans font-black tabular-nums leading-none";

function Chip({
  label,
  value,
  tone = "#94A3B8",
}: {
  label?: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <span
      className="flex items-center gap-1 rounded-lg px-1.5 py-1 font-sans text-[10px] font-bold tabular-nums"
      style={{ ...PANEL, color: tone }}
    >
      {label && (
        <span className="text-[8px] uppercase tracking-[0.14em] text-white/40">
          {label}
        </span>
      )}
      {value}
    </span>
  );
}

function ConstraintChip({
  type,
  progress,
  count,
}: {
  type: ConstraintType;
  progress: number;
  count: number;
}) {
  const icon = CONSTRAINT_ICON_MAP[type];
  const done = progress >= count;
  return (
    <span
      className="flex items-center gap-1 rounded-lg px-1.5 py-1 font-sans text-[10px] font-bold tabular-nums"
      style={{ ...PANEL, color: done ? "#4ADE80" : "#E2E8F0" }}
    >
      {icon && <img src={icon} alt="" className="h-3.5 w-3.5 rounded-full" />}
      {Math.min(progress, count)}/{count}
    </span>
  );
}

function Guardian({
  zoneId,
  badge,
  badgeColor,
  size,
}: {
  zoneId: number;
  badge: React.ReactNode;
  badgeColor: string;
  size: number;
}) {
  const guardian = getZoneGuardian(zoneId);
  return (
    <span className="relative flex-none" style={{ width: size, height: size }}>
      <img
        src={getGuardianPortrait(zoneId)}
        alt={guardian.name}
        className="h-full w-full rounded-full object-cover"
        style={{ boxShadow: "0 0 0 2px rgba(255,255,255,0.18)" }}
      />
      <span
        className="absolute -bottom-1 -right-1 grid h-5 min-w-[20px] place-items-center rounded-full px-1 font-sans text-[10px] font-black text-[#0A1120]"
        style={{ background: badgeColor }}
      >
        {badge}
      </span>
    </span>
  );
}

export default function PrototypeHud(props: PrototypeHudProps) {
  const {
    variant,
    isDaily,
    zoneId,
    level,
    score,
    targetScore,
    engineScore,
    pressureScore,
    currentDifficulty,
    endlessThresholds,
    endlessScoreMultipliersX100,
    movesRemaining,
    maxMoves,
    combo,
    starsEarned,
    gameLevel,
    constraintProgress,
    constraint2Progress,
    objectiveName,
    field,
    onBack,
  } = props;

  const scale = buildTierScale(endlessThresholds, endlessScoreMultipliersX100);
  const tier = scale[currentTierIndex(scale, currentDifficulty, pressureScore)]!;
  const nextTier = scale[scale.indexOf(tier) + 1] ?? null;
  const tierProgress = nextTier
    ? Math.max(
        0,
        Math.min(
          1,
          (pressureScore - tier.threshold) /
            Math.max(1, nextTier.threshold - tier.threshold),
        ),
      )
    : 1;
  const shown = useLerpNumber(score, { duration: 300, integer: true }) ?? 0;
  const scoreText = shown.toLocaleString("en-US");
  const targetProgress =
    targetScore > 0 ? Math.min(1, score / targetScore) : 0;

  const constraints: { type: ConstraintType; progress: number; count: number }[] =
    [];
  if (gameLevel && gameLevel.constraintType !== ConstraintType.None) {
    constraints.push({
      type: gameLevel.constraintType,
      progress:
        gameLevel.constraintType === ConstraintType.ComboMeter
          ? combo
          : constraintProgress,
      count:
        gameLevel.constraintType === ConstraintType.ComboMeter
          ? gameLevel.constraintValue
          : gameLevel.constraintCount,
    });
  }
  if (
    gameLevel?.constraint2Type !== undefined &&
    gameLevel.constraint2Type !== ConstraintType.None
  ) {
    constraints.push({
      type: gameLevel.constraint2Type,
      progress:
        gameLevel.constraint2Type === ConstraintType.ComboMeter
          ? combo
          : constraint2Progress,
      count:
        gameLevel.constraint2Type === ConstraintType.ComboMeter
          ? gameLevel.constraint2Value
          : gameLevel.constraint2Count,
    });
  }

  const back = onBack && (
    <button
      type="button"
      aria-label="Back"
      onClick={onBack}
      className="flex-none rounded-lg p-1 text-white/60"
    >
      <ArrowLeft size={18} />
    </button>
  );

  const comboChip = (
    <motion.span
      key={combo}
      animate={combo > 0 ? { scale: [1, 1.25, 1] } : {}}
      transition={{ duration: 0.25 }}
      className={`flex items-center gap-0.5 rounded-lg px-1.5 py-1 font-sans text-[11px] font-black tabular-nums ${
        combo >= 3
          ? "bg-gradient-to-r from-orange-600 to-yellow-500 text-white"
          : combo > 0
            ? "bg-orange-900/70 text-orange-200"
            : "bg-slate-800/60 text-slate-500"
      }`}
    >
      <Flame size={12} />
      {combo > 0 ? combo : "–"}
    </motion.span>
  );

  const fieldChip = field && (
    <Chip
      value={
        <span className="text-[11px] text-white">
          #{field.rank}
          <span className="text-white/40">/{field.entrants}</span>
        </span>
      }
      tone="#FACC15"
    />
  );

  // ── SLAB ── score left, multiplier right, everything else a rail above.
  if (variant === "slab") {
    return (
      <div className="w-full px-2 pt-2">
        <div className="mb-1 flex items-center gap-1.5">
          {back}
          <span className="min-w-0 flex-1 truncate font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
            {isDaily ? objectiveName : `Level ${level}`}
          </span>
          {!isDaily && (
            <span className="flex-none text-[13px] tracking-[2px] text-amber-300">
              {"★".repeat(starsEarned)}
              <span className="text-white/20">{"★".repeat(3 - starsEarned)}</span>
            </span>
          )}
          {constraints.map((constraint, index) => (
            <ConstraintChip key={index} {...constraint} />
          ))}
          {fieldChip}
          {comboChip}
        </div>
        <div className="flex items-stretch gap-2">
          <span className="flex flex-none items-center">
            <Guardian
              zoneId={zoneId}
              badge={isDaily ? "" : level}
              badgeColor={isDaily ? tier.color : "#FACC15"}
              size={44}
            />
          </span>
          <div
            className="flex min-w-0 flex-1 flex-col justify-center rounded-2xl px-3 py-1.5"
            style={PANEL}
          >
            <span className={`${NUMERALS} text-[34px] text-white`}>
              {isDaily ? scoreText : `${shown}/${targetScore}`}
            </span>
            <span className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/50">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${(isDaily ? tierProgress : targetProgress) * 100}%`,
                  background: isDaily ? tier.color : "#38BDF8",
                }}
              />
            </span>
          </div>
          <div
            className="flex w-[86px] flex-none flex-col items-center justify-center rounded-2xl px-1 py-1.5"
            style={PANEL}
          >
            {isDaily ? (
              <>
                <span
                  className={`${NUMERALS} text-[26px]`}
                  style={{ color: tier.color }}
                >
                  ×{tier.multiplier}
                </span>
                <span className="mt-0.5 font-sans text-[8px] font-bold uppercase tracking-[0.12em] text-white/45">
                  {tier.name}
                </span>
              </>
            ) : (
              <>
                <span className={`${NUMERALS} text-[26px] text-white`}>
                  {movesRemaining}
                </span>
                <span className="mt-0.5 font-sans text-[8px] font-bold uppercase tracking-[0.12em] text-white/45">
                  Moves
                </span>
              </>
            )}
          </div>
        </div>
        {isDaily && (
          <div className="mt-1 flex items-center justify-between px-1 font-sans text-[9px] font-bold uppercase tracking-[0.12em] text-white/35">
            <span>Engine {engineScore.toLocaleString("en-US")}</span>
            <span>
              {movesRemaining}/{maxMoves} moves
            </span>
          </div>
        )}
      </div>
    );
  }

  // ── TOWERS ── the two numbers side by side, read as one equation.
  if (variant === "towers") {
    return (
      <div className="w-full px-2 pt-2">
        <div className="mb-1 flex items-center gap-1.5">
          {back}
          {fieldChip}
          <span className="min-w-0 flex-1 truncate text-right font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
            {isDaily ? objectiveName : `Level ${level}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="flex min-w-0 flex-1 flex-col items-center rounded-2xl py-1.5"
            style={PANEL}
          >
            <span className={`${NUMERALS} text-[24px] text-sky-300`}>
              {isDaily ? engineScore.toLocaleString("en-US") : shown}
            </span>
            <span className="font-sans text-[8px] font-bold uppercase tracking-[0.14em] text-white/40">
              {isDaily ? "Engine" : "Score"}
            </span>
          </div>
          <span className={`${NUMERALS} flex-none text-[18px] text-white/50`}>
            {isDaily ? "×" : "of"}
          </span>
          <div
            className="flex min-w-0 flex-1 flex-col items-center rounded-2xl py-1.5"
            style={PANEL}
          >
            <span
              className={`${NUMERALS} text-[24px]`}
              style={{ color: isDaily ? tier.color : "#FACC15" }}
            >
              {isDaily ? tier.multiplier.toFixed(1) : targetScore}
            </span>
            <span className="font-sans text-[8px] font-bold uppercase tracking-[0.14em] text-white/40">
              {isDaily ? tier.name : "Target"}
            </span>
          </div>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <Guardian
            zoneId={zoneId}
            badge={isDaily ? "" : level}
            badgeColor={isDaily ? tier.color : "#FACC15"}
            size={30}
          />
          <span className={`${NUMERALS} flex-1 text-[20px] text-white`}>
            {isDaily ? `= ${scoreText}` : `${starsEarned}★`}
          </span>
          <Chip label="Moves" value={`${movesRemaining}/${maxMoves}`} />
          {constraints.map((constraint, index) => (
            <ConstraintChip key={index} {...constraint} />
          ))}
          {comboChip}
        </div>
      </div>
    );
  }

  // ── HERO ── the score IS the header; one chip rail carries the rest.
  return (
    <div className="w-full px-2 pt-1">
      <div className="flex items-center gap-1.5">
        {back}
        <span className="min-w-0 flex-1 truncate font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
          {isDaily ? objectiveName : `Level ${level}`}
        </span>
        {!isDaily && (
          <span className="flex-none text-[13px] tracking-[2px] text-amber-300">
            {"★".repeat(starsEarned)}
            <span className="text-white/20">{"★".repeat(3 - starsEarned)}</span>
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-center gap-2">
        <span
          className={`${NUMERALS} text-[52px] text-white`}
          style={{ textShadow: "0 3px 0 rgba(0,0,0,0.55)" }}
        >
          {isDaily ? scoreText : shown}
        </span>
        {!isDaily && (
          <span className={`${NUMERALS} text-[22px] text-white/40`}>
            /{targetScore}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5 overflow-x-auto pb-1">
        <Guardian
          zoneId={zoneId}
          badge={isDaily ? "" : level}
          badgeColor={isDaily ? tier.color : "#FACC15"}
          size={26}
        />
        {isDaily ? (
          <Chip value={`×${tier.multiplier}`} tone={tier.color} />
        ) : (
          <Chip label="Moves" value={movesRemaining} />
        )}
        {isDaily && <Chip label="Moves" value={`${movesRemaining}/${maxMoves}`} />}
        {comboChip}
        {constraints.map((constraint, index) => (
          <ConstraintChip key={index} {...constraint} />
        ))}
        {fieldChip}
      </div>
    </div>
  );
}
