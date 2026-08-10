/**
 * DEV-ONLY in-run header prototype: the Tablet.
 *
 * Reach it with `?dev=1&page=play&board=arena|campaign&hud=tablet`.
 *
 * Atomized: no frame, no panel, no shared plate. Each readout is its own
 * object sitting on the stone with its own recess and shadow, because the
 * framing was only ever drawing a box around things that already read as a
 * group — and a second frame above the grid's own competed with it.
 *
 * What it says:
 *
 * - TWO SLOTS, TWO POTS. A daily run is ranked twice over the same play and
 *   each board pays half. The second slot is labelled with the day's actual
 *   objective rather than the word "Theme", because the objective is what the
 *   player is being asked to do; "Theme" is the name of the ledger it lands in.
 * - ONE RAIL, AND IT IS THE MOVES. Ranks live on the slots where the numbers
 *   they rank are. In Campaign the same rail carries the star thresholds,
 *   because stars are derived from moves used — the counter and the three
 *   stars were always one meter.
 * - The combo rides the score panel's corner: it multiplies that number and
 *   nothing else, so it belongs to it rather than floating on its own.
 */
import { motion } from "motion/react";
import { Flame } from "lucide-react";

import { CONSTRAINT_ICON_MAP } from "@/config/constraintIcons";
import { ConstraintType } from "@/game/constraint";
import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import type { GameLevelData } from "@/hooks/useGameLevel";
import { useLerpNumber } from "@/hooks/useLerpNumber";
import { buildTierScale, currentTierIndex } from "./tierScale";
import type { FieldStandings } from "./chase";

export type { FieldStanding, FieldStandings } from "./chase";

export interface PrototypeHudProps {
  isDaily: boolean;
  zoneId: number;
  level: number;
  score: number;
  themeScore: number;
  targetScore: number;
  pressureScore: number;
  currentDifficulty: number;
  endlessThresholds: readonly number[];
  endlessScoreMultipliersX100: readonly number[];
  movesUsed: number;
  movesRemaining: number;
  combo: number;
  gameLevel: GameLevelData | null;
  constraintProgress: number;
  constraint2Progress: number;
  /** The day's rule, e.g. "2+ line combos" — the second slot's own label. */
  objectiveName?: string;
  standings: FieldStandings | null;
  /** The board's frame width, so the panes line up with the grid. */
  frameWidth: number | null;
}

/** Numerals that count are sans-black and tabular: a proportional figure
 *  changes width as it ticks, so a score jitters sideways the whole climb. */
const FIGURE = "font-sans font-black tabular-nums leading-[0.92]";
const EMBOSS = "0 2px 0 rgba(0,0,0,0.9), 0 -1px 0 rgba(255,255,255,0.2)";

/** Recessed. Holds a number, never a control — the inverse of a key. */
const SLOT: React.CSSProperties = {
  background: "linear-gradient(180deg, #05080F 0%, #0C1220 100%)",
  borderRadius: 11,
  boxShadow:
    "inset 0 4px 10px rgba(0,0,0,0.95), inset 0 -1px 0 rgba(255,255,255,0.07)",
};

function Gem({
  color,
  size,
  children,
}: {
  color: string;
  size: number;
  children: React.ReactNode;
}) {
  return (
    <span
      className="grid place-items-center rounded-full font-sans font-black text-[#2A1400]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.33,
        background: `radial-gradient(circle at 33% 27%, #fff 0%, ${color} 42%, #2A0F02 130%)`,
        boxShadow: `0 0 ${size * 0.28}px ${color}, inset 0 2px 5px rgba(255,255,255,0.55), 0 2px 0 rgba(0,0,0,0.55)`,
        textShadow: "0 1px 0 rgba(255,255,255,0.35)",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Rank rides the slot whose number it ranks, and pops when it improves — the
 * only celebration the standing gets, now that no rail chases it.
 */
function RankChip({
  rank,
  entrants,
  tone,
}: {
  rank: number;
  entrants: number;
  tone: string;
}) {
  return (
    <motion.span
      key={rank}
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.22, 1] }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="rounded-md px-1.5 py-[1px] font-sans text-[11px] font-black tabular-nums"
      style={{
        background: `linear-gradient(160deg, ${tone}, ${tone}99)`,
        color: "#241903",
        boxShadow: "0 2px 0 rgba(0,0,0,0.5)",
      }}
    >
      #{rank}
      <span className="opacity-55">/{entrants}</span>
    </motion.span>
  );
}

function Label({
  children,
  tone,
  tight,
}: {
  children: React.ReactNode;
  tone: string;
  /** The objective's own name runs long, so it trades tracking for fitting. */
  tight?: boolean;
}) {
  return (
    <span
      className={`truncate font-sans font-bold uppercase ${
        tight ? "text-[8.5px] tracking-[0.06em]" : "text-[9px] tracking-[0.18em]"
      }`}
      style={{ color: tone }}
    >
      {children}
    </span>
  );
}

export default function PrototypeHud(props: PrototypeHudProps) {
  const {
    isDaily,
    zoneId,
    level,
    score,
    themeScore,
    targetScore,
    pressureScore,
    currentDifficulty,
    endlessThresholds,
    endlessScoreMultipliersX100,
    movesUsed,
    movesRemaining,
    combo,
    gameLevel,
    constraintProgress,
    constraint2Progress,
    objectiveName,
    standings,
    frameWidth,
  } = props;

  const scale = buildTierScale(endlessThresholds, endlessScoreMultipliersX100);
  const tier = scale[currentTierIndex(scale, currentDifficulty, pressureScore)]!;
  const shownScore = useLerpNumber(score, { duration: 300, integer: true }) ?? 0;
  const shownTheme = useLerpNumber(themeScore, { duration: 300, integer: true }) ?? 0;

  const constraints: { type: ConstraintType; progress: number; count: number }[] =
    [];
  if (gameLevel && gameLevel.constraintType !== ConstraintType.None) {
    const meter = gameLevel.constraintType === ConstraintType.ComboMeter;
    constraints.push({
      type: gameLevel.constraintType,
      progress: meter ? combo : constraintProgress,
      count: meter ? gameLevel.constraintValue : gameLevel.constraintCount,
    });
  }
  if (
    gameLevel?.constraint2Type !== undefined &&
    gameLevel.constraint2Type !== ConstraintType.None
  ) {
    const meter = gameLevel.constraint2Type === ConstraintType.ComboMeter;
    constraints.push({
      type: gameLevel.constraint2Type,
      progress: meter ? combo : constraint2Progress,
      count: meter ? gameLevel.constraint2Value : gameLevel.constraint2Count,
    });
  }

  // Stars fall out of moves used, so the thresholds are marks on the move rail
  // rather than a second readout.
  const star3 = gameLevel?.star3Threshold ?? 0;
  const star2 = gameLevel?.star2Threshold ?? 0;
  const trackMax = Math.max(1, gameLevel?.maxMoves ?? 1);
  const starsLeft = movesUsed <= star3 ? 3 : movesUsed <= star2 ? 2 : 1;
  const spent = Math.min(1, movesUsed / trackMax);
  const railColor = isDaily
    ? spent > 0.85
      ? "#EF4444"
      : spent > 0.6
        ? "#F97316"
        : "#64748B"
    : starsLeft === 3
      ? "#22C55E"
      : starsLeft === 2
        ? "#EAB308"
        : "#EF4444";

  return (
    // max-width, never a plain width: the header is sized FROM the board, so
    // it must not be able to widen the page and grow the board in turn — that
    // loop runs until the cell size hits its ceiling.
    <div className="w-full px-1 pt-2">
      <div
        className="mx-auto"
        style={{ width: frameWidth ?? undefined, maxWidth: "100%" }}
      >
        <div>
          <div className="flex items-stretch gap-2">
            <span className="relative flex flex-none items-center">
              <span
                className="block rounded-full"
                style={{
                  width: 52,
                  height: 52,
                  padding: 2,
                  background:
                    "linear-gradient(135deg, #5A4A32, #DFC088 45%, #8B7355)",
                  boxShadow: "0 3px 0 #241E12",
                }}
              >
                <img
                  src={getGuardianPortrait(zoneId)}
                  alt={getZoneGuardian(zoneId).name}
                  className="h-full w-full rounded-full object-cover"
                />
              </span>
              <span className="absolute -bottom-1.5 -right-2.5">
                {isDaily ? (
                  <Gem color={tier.color} size={28}>
                    ×{tier.multiplier}
                  </Gem>
                ) : (
                  <Gem color="#FACC15" size={26}>
                    {level}
                  </Gem>
                )}
              </span>
            </span>

            {/* SCORE — the run's total. Combo hangs off its corner. */}
            <span
              className="relative flex min-w-0 flex-[1.3] flex-col justify-center px-2.5 py-1.5"
              style={SLOT}
            >
              <span className="flex items-baseline justify-between gap-1">
                <Label tone="rgba(250,204,21,0.72)">Score</Label>
                {standings && (
                  <RankChip
                    rank={standings.score.rank}
                    entrants={standings.score.entrants}
                    tone="#FDE68A"
                  />
                )}
              </span>
              <span
                className={`${FIGURE} mt-1 truncate text-[29px] text-[#FACC15]`}
                style={{ textShadow: EMBOSS }}
              >
                {isDaily
                  ? shownScore.toLocaleString("en-US")
                  : `${shownScore}/${targetScore}`}
              </span>
              <motion.span
                key={combo}
                animate={combo > 0 ? { scale: [1, 1.3, 1] } : {}}
                transition={{ duration: 0.25 }}
                className="absolute -bottom-2 -right-2 flex items-center gap-0.5 rounded-lg px-1.5 py-[3px] font-sans text-[11px] font-black tabular-nums"
                style={{
                  background:
                    combo >= 3
                      ? "linear-gradient(160deg, #FB923C, #DC2626)"
                      : combo > 0
                        ? "linear-gradient(160deg, #9A3412, #7F1D1D)"
                        : "linear-gradient(160deg, #263145, #161E2E)",
                  boxShadow:
                    "0 2px 0 rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.35)",
                  color: combo > 0 ? "#fff" : "rgba(255,255,255,0.38)",
                }}
              >
                <Flame size={11} />
                {combo > 0 ? combo : "–"}
              </motion.span>
            </span>

            {isDaily ? (
              /* The day's objective, named by what it asks for. */
              <span
                className="flex min-w-0 flex-1 flex-col justify-center px-2.5 py-1.5"
                style={SLOT}
              >
                <span className="flex items-baseline justify-between gap-1">
                  <Label tone="rgba(56,189,248,0.85)" tight>
                    {objectiveName ?? "Objective"}
                  </Label>
                  {standings?.theme && (
                    <RankChip
                      rank={standings.theme.rank}
                      entrants={standings.theme.entrants}
                      tone="#BAE6FD"
                    />
                  )}
                </span>
                <span
                  className={`${FIGURE} mt-1 truncate text-[29px] text-[#38BDF8]`}
                  style={{ textShadow: EMBOSS }}
                >
                  {shownTheme.toLocaleString("en-US")}
                </span>
              </span>
            ) : (
              <span className="flex flex-none items-stretch gap-1.5">
                {constraints.map((constraint, index) => {
                  const icon = CONSTRAINT_ICON_MAP[constraint.type];
                  const done = constraint.progress >= constraint.count;
                  return (
                    <span
                      key={index}
                      className="flex w-[54px] flex-col items-center justify-center gap-1 px-1"
                      style={SLOT}
                    >
                      {icon && (
                        <img src={icon} alt="" className="h-5 w-5 rounded-full" />
                      )}
                      <span
                        className="font-sans text-[11px] font-black tabular-nums"
                        style={{ color: done ? "#4ADE80" : "#E2E8F0" }}
                      >
                        {Math.min(constraint.progress, constraint.count)}/
                        {constraint.count}
                      </span>
                    </span>
                  );
                })}
              </span>
            )}
          </div>

          {/* The move rail. Both modes, same meter — in Campaign it also
              carries the star thresholds it already decides. */}
          <div className="mt-2.5 flex items-center gap-2">
            <span className="relative h-[9px] flex-1">
              <span
                className="block h-full overflow-hidden rounded-full"
                style={{
                  background: "#05080F",
                  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.9)",
                }}
              >
                <motion.span
                  className="block h-full rounded-full"
                  initial={false}
                  animate={{ width: `${spent * 100}%` }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  style={{
                    background: `linear-gradient(90deg, ${railColor}77, ${railColor})`,
                  }}
                />
              </span>
              {!isDaily && (
                <>
                  <StarMark at={star3 / trackMax} lit={starsLeft >= 3} />
                  <StarMark at={star2 / trackMax} lit={starsLeft >= 2} />
                  <StarMark at={1} lit={starsLeft >= 1} />
                </>
              )}
            </span>
            <span className="flex-none font-sans text-[12px] font-black tabular-nums text-white">
              {movesRemaining}
              <span className="ml-1 text-[9px] font-bold uppercase tracking-[0.12em] text-white/40">
                moves
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A star threshold pinned on the move rail. */
function StarMark({ at, lit }: { at: number; lit: boolean }) {
  return (
    <span
      className="absolute top-1/2 text-[13px] leading-none"
      style={{
        // Inset the run so the last star sits inside the rail rather than
        // straddling its end.
        left: `${3 + Math.min(1, at) * 93}%`,
        transform: "translate(-50%, -50%)",
        color: lit ? "#FACC15" : "rgba(255,255,255,0.22)",
        textShadow: lit ? "0 0 8px rgba(250,204,21,0.8)" : "none",
      }}
    >
      ★
    </span>
  );
}
