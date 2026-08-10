/**
 * DEV-ONLY in-run header prototype: the Tablet, with the Chase folded in.
 *
 * Reach it with `?dev=1&page=play&board=arena|campaign&hud=tablet`.
 *
 * Three ideas carry the whole thing:
 *
 * 1. TWO POTS, TWO SLOTS. A daily run is ranked twice over the same play and
 *    each board pays half the pot, so the header shows both figures, coloured
 *    apart. `objective_total` is already on the run account; the client used to
 *    compute it and throw it into a 7px sub-line.
 * 2. ONE RAIL, AND IT IS ALWAYS WHAT YOU ARE CHASING. In Arena that is the gap
 *    to the next rank. In Campaign there is no field, so it is the star track —
 *    which is the same fact as the move counter, since stars are derived from
 *    moves used. Two readouts became one meter.
 * 3. THINGS HAVE THICKNESS. A key is pressable and has an under-edge; a slot is
 *    recessed and only ever holds a number; a bezel frames; a gem glows and
 *    escalates. The previous pass used menu plates — flat, 1px border, no
 *    light — which is why it read as a dashboard rather than a game.
 *
 * The rail deliberately does NOT name the player above or quote their score:
 * the gap is the only part of that anyone is playing against.
 */
import { useRef } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Flame } from "lucide-react";

import { CONSTRAINT_ICON_MAP } from "@/config/constraintIcons";
import { ConstraintType } from "@/game/constraint";
import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import type { GameLevelData } from "@/hooks/useGameLevel";
import { useLerpNumber } from "@/hooks/useLerpNumber";
import { buildTierScale, currentTierIndex } from "./tierScale";
import { chaseTarget, type FieldStandings } from "./chase";

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
  maxMoves: number;
  combo: number;
  gameLevel: GameLevelData | null;
  constraintProgress: number;
  constraint2Progress: number;
  objectiveName?: string;
  standings: FieldStandings | null;
  onBack?: () => void;
}

/** Numerals that count are sans-black and tabular: a proportional figure
 *  changes width as it ticks, so a score jitters sideways the whole climb. */
const FIGURE = "font-sans font-black tabular-nums leading-[0.92]";
const EMBOSS = "0 2px 0 rgba(0,0,0,0.9), 0 -1px 0 rgba(255,255,255,0.22)";

/** Gold-stone, the ring already used by the shipped HUD chrome. */
const BEZEL: React.CSSProperties = {
  padding: 3,
  borderRadius: 20,
  background:
    "linear-gradient(135deg, #4E4029 0%, #C9A96E 30%, #DFC088 50%, #A98B55 72%, #43371F 100%)",
  boxShadow: "0 5px 0 #1E1810, 0 14px 26px -12px rgba(0,0,0,0.9)",
};

/** Recessed. Holds a number, never a control — the inverse of a key. */
const SLOT: React.CSSProperties = {
  background: "linear-gradient(180deg, #05080F 0%, #0C1220 100%)",
  borderRadius: 12,
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
        fontSize: size * 0.32,
        background: `radial-gradient(circle at 33% 27%, #fff 0%, ${color} 42%, #2A0F02 130%)`,
        boxShadow: `0 0 ${size * 0.3}px ${color}, inset 0 2px 5px rgba(255,255,255,0.55), 0 3px 0 rgba(0,0,0,0.55)`,
        textShadow: "0 1px 0 rgba(255,255,255,0.35)",
      }}
    >
      {children}
    </span>
  );
}

function RankChip({ rank, of, tone }: { rank: number; of?: number; tone: string }) {
  return (
    <span
      className="rounded-md px-1.5 py-[1px] font-sans text-[11px] font-black tabular-nums"
      style={{
        background: `linear-gradient(160deg, ${tone}, ${tone}99)`,
        color: "#241903",
        boxShadow: "0 2px 0 rgba(0,0,0,0.5)",
      }}
    >
      #{rank}
      {of !== undefined && <span className="opacity-55">/{of}</span>}
    </span>
  );
}

function Medallion({ zoneId, size }: { zoneId: number; size: number }) {
  return (
    <span
      className="block flex-none rounded-full"
      style={{
        width: size,
        height: size,
        padding: 3,
        background: "linear-gradient(135deg, #5A4A32, #DFC088 45%, #8B7355)",
        boxShadow: "0 4px 0 #241E12, 0 8px 18px -6px rgba(0,0,0,0.9)",
      }}
    >
      <img
        src={getGuardianPortrait(zoneId)}
        alt={getZoneGuardian(zoneId).name}
        className="h-full w-full rounded-full object-cover"
      />
    </span>
  );
}

function Label({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span
      className="font-sans text-[9px] font-bold uppercase tracking-[0.2em]"
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
    onBack,
  } = props;

  const scale = buildTierScale(endlessThresholds, endlessScoreMultipliersX100);
  const tier = scale[currentTierIndex(scale, currentDifficulty, pressureScore)]!;
  const shownScore = useLerpNumber(score, { duration: 300, integer: true }) ?? 0;
  const shownTheme = useLerpNumber(themeScore, { duration: 300, integer: true }) ?? 0;

  // Which board the rail is chasing, held across renders so the hysteresis in
  // `chaseTarget` has something to hold against.
  const chasing = useRef<"score" | "theme" | null>(null);
  const chase = chaseTarget(standings, score, themeScore, chasing.current);
  chasing.current = chase?.board ?? null;
  const chaseTone = chase?.board === "theme" ? "#38BDF8" : "#FACC15";

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

  // How far into the gap this run already is, on whichever board is being
  // chased. Without live field data there is nothing to chase, and the rail
  // says so rather than inventing a number to sit next to real SOL.
  const chaseEarned = chase?.board === "theme" ? themeScore : score;
  const chaseProgress = chase
    ? Math.max(
        0,
        Math.min(1, chaseEarned / Math.max(1, chaseEarned + chase.standing.gapToNext)),
      )
    : 0;

  // The star track: stars fall out of moves used, so the move counter and the
  // three stars are one meter with the thresholds marked on it.
  const star3 = gameLevel?.star3Threshold ?? 0;
  const star2 = gameLevel?.star2Threshold ?? 0;
  const trackMax = Math.max(1, gameLevel?.maxMoves ?? 1);
  const starsLeft = movesUsed <= star3 ? 3 : movesUsed <= star2 ? 2 : 1;
  const trackColor =
    starsLeft === 3 ? "#22C55E" : starsLeft === 2 ? "#EAB308" : "#EF4444";

  return (
    <div className="w-full px-2 pt-2">
      <div className="mb-1.5 flex items-center gap-2">
        {onBack && (
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="flex-none rounded-lg p-0.5 text-white/55"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <span className="min-w-0 flex-1 truncate">
          <Label tone="rgba(255,255,255,0.45)">
            {isDaily ? objectiveName : `Level ${level} · ${getZoneGuardian(zoneId).name}`}
          </Label>
        </span>
        <motion.span
          key={combo}
          animate={combo > 0 ? { scale: [1, 1.25, 1] } : {}}
          transition={{ duration: 0.25 }}
          className="flex flex-none items-center gap-1 rounded-lg px-2 py-1 font-sans text-[12px] font-black tabular-nums text-white"
          style={{
            background:
              combo >= 3
                ? "linear-gradient(160deg, #FB923C, #DC2626)"
                : combo > 0
                  ? "linear-gradient(160deg, #9A3412, #7F1D1D)"
                  : "linear-gradient(160deg, #263145, #161E2E)",
            boxShadow:
              "0 3px 0 rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
            color: combo > 0 ? "#fff" : "rgba(255,255,255,0.4)",
          }}
        >
          <Flame size={12} />
          {combo > 0 ? combo : "–"}
        </motion.span>
      </div>

      <div style={BEZEL}>
        <div
          className="rounded-[16px] px-2.5 pb-2 pt-2.5"
          style={{ background: "linear-gradient(180deg, #1A1E2E 0%, #0D1119 100%)" }}
        >
          <div className="flex items-stretch gap-2.5">
            <span className="relative flex flex-none items-center">
              <Medallion zoneId={zoneId} size={54} />
              {/* Hangs off the bezel rather than sitting on the portrait —
                  the guardian is art, not a backdrop for a badge. */}
              <span className="absolute -bottom-2 -right-3">
                {isDaily ? (
                  <Gem color={tier.color} size={30}>
                    ×{tier.multiplier}
                  </Gem>
                ) : (
                  <Gem color="#FACC15" size={26}>
                    {level}
                  </Gem>
                )}
              </span>
            </span>

            <span
              className="flex min-w-0 flex-[1.35] flex-col justify-center px-2.5 py-1.5"
              style={SLOT}
            >
              <span className="flex items-baseline justify-between gap-1">
                <Label tone="rgba(250,204,21,0.75)">Score</Label>
                {standings && (
                  <RankChip
                    rank={standings.score.rank}
                    of={standings.score.entrants}
                    tone="#FDE68A"
                  />
                )}
              </span>
              <span
                className={`${FIGURE} mt-0.5 truncate text-[30px] text-[#FACC15]`}
                style={{ textShadow: EMBOSS }}
              >
                {isDaily
                  ? shownScore.toLocaleString("en-US")
                  : `${shownScore}/${targetScore}`}
              </span>
            </span>

            {isDaily ? (
              <span
                className="flex min-w-0 flex-1 flex-col justify-center px-2.5 py-1.5"
                style={SLOT}
              >
                <span className="flex items-baseline justify-between gap-1">
                  <Label tone="rgba(56,189,248,0.8)">Theme</Label>
                  {standings?.theme && (
                    <RankChip
                      rank={standings.theme.rank}
                      of={standings.theme.entrants}
                      tone="#BAE6FD"
                    />
                  )}
                </span>
                <span
                  className={`${FIGURE} mt-0.5 truncate text-[30px] text-[#38BDF8]`}
                  style={{ textShadow: EMBOSS }}
                >
                  {shownTheme.toLocaleString("en-US")}
                </span>
              </span>
            ) : (
              <span className="flex flex-none items-center gap-1.5">
                {constraints.map((constraint, index) => {
                  const icon = CONSTRAINT_ICON_MAP[constraint.type];
                  const done = constraint.progress >= constraint.count;
                  return (
                    <span
                      key={index}
                      className="flex h-full w-[52px] flex-col items-center justify-center gap-0.5 px-1"
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

          {/* One rail, and it is always what you are chasing. */}
          <div className="mt-2 flex items-center gap-2">
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
                  animate={{
                    width: `${(isDaily ? chaseProgress : Math.min(1, movesUsed / trackMax)) * 100}%`,
                  }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  style={{
                    background: isDaily
                      ? `linear-gradient(90deg, ${chaseTone}55, ${chaseTone})`
                      : `linear-gradient(90deg, ${trackColor}88, ${trackColor})`,
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
            {isDaily ? (
              chase ? (
                // Named by board, because the rail moves between them: the
                // player must never wonder which ladder they are climbing.
                <span
                  className="flex-none font-sans text-[12px] font-black tabular-nums"
                  style={{ color: chaseTone }}
                >
                  +{chase.standing.gapToNext.toLocaleString("en-US")}
                  <span className="ml-1 text-white/45">
                    → {chase.board === "theme" ? "Theme" : "Score"} #
                    {chase.standing.rank - 1}
                  </span>
                </span>
              ) : (
                <span className="flex-none font-sans text-[11px] font-bold tabular-nums text-white/40">
                  {movesRemaining} moves
                </span>
              )
            ) : (
              <span className="flex-none font-sans text-[12px] font-black tabular-nums text-white">
                {movesRemaining}
                <span className="ml-1 text-[9px] font-bold uppercase tracking-[0.12em] text-white/40">
                  left
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A star threshold pinned on the campaign track. */
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
