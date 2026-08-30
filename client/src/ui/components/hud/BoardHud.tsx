/**
 * The top of the in-run screen.
 *
 * Three places, and they mean the same thing in both modes:
 *
 *   LEFT is yours     — the score, and the chain that is building it
 *   RIGHT is the day's — what you are being asked for
 *   THE CHIN is your tier — the pressure multiplier, or the campaign level
 *
 * Nothing moves when the mode changes, so a player who learns the screen in
 * Campaign already knows it in Arcade.
 *
 * Two material rules do most of the work. Every figure is SEATED in a shallow
 * recess, because the stone behind it carries carving and an unseated numeral
 * loses its edge against it. Anything with a denominator is a RING rather than
 * a number: a constraint, or the chain measured against the threshold that
 * makes a move count. A rectangle showing "2/10" cannot show itself filling.
 */
import { useMemo } from "react";

import { ConstraintType } from "@/game/constraint";
import type { GameLevelData } from "@/hooks/useGameLevel";
import { useLerpNumber } from "@/hooks/useLerpNumber";
import ProgressRing from "@/ui/components/shared/ProgressRing";
import { constraintProgressOf, constraintStatus } from "./constraintDisplay";
import { boardTier } from "./boardTier";
import { guardianFrame, type GuardianMood } from "./useGuardianMood";

const FIGURE = "font-sans font-black tabular-nums leading-[0.92]";
const STAMP = "0 2px 0 rgba(0,0,0,0.92), 0 -1px 0 rgba(255,255,255,0.15)";
/** A recess cut into the stone. Holds a number, never a control. */
const SEAT: React.CSSProperties = {
  borderRadius: 9,
  background: "linear-gradient(180deg,#070907,#141810)",
  boxShadow:
    "inset 0 4px 10px rgba(0,0,0,0.95), inset 0 -1px 0 rgba(201,169,110,0.18)",
};

export interface BoardHudProps {
  isDaily: boolean;
  zoneId: number;
  mood: GuardianMood;
  /** Arcade: the running daily score. Campaign: this level's score. */
  score: number;
  /** Campaign only — the level's target. */
  targetScore: number;
  /** Arcade only — the theme board's metric, and the day's rule. */
  themeScore: number;
  objectiveName?: string;
  level: number;
  combo: number;
  /** The chain length at which a move starts counting for the day. */
  comboThreshold: number;
  pressureScore: number;
  currentDifficulty: number;
  pressureThresholds: readonly number[];
  pressureScoreMultipliersX100: readonly number[];
  gameLevel: GameLevelData | null;
  constraintProgress: number;
  constraint2Progress: number;
  latchedStarSources: number;
}

export default function BoardHud({
  isDaily,
  zoneId,
  mood,
  score,
  targetScore,
  themeScore,
  objectiveName,
  level,
  combo,
  comboThreshold,
  pressureScore,
  currentDifficulty,
  pressureThresholds,
  pressureScoreMultipliersX100,
  gameLevel,
  constraintProgress,
  constraint2Progress,
  latchedStarSources,
}: BoardHudProps) {
  const tier = boardTier(
    pressureThresholds,
    pressureScoreMultipliersX100,
    currentDifficulty,
    pressureScore,
  );
  const shownScore =
    useLerpNumber(score, { duration: 300, integer: true }) ?? 0;
  const shownTheme =
    useLerpNumber(themeScore, { duration: 300, integer: true }) ?? 0;

  const constraints = useMemo(() => {
    if (!gameLevel) return [];
    const out: {
      slot: "Shape" | "Blow";
      type: ConstraintType;
      value: number;
      count: number;
      progress: number;
    }[] = [];
    if (gameLevel.constraintType !== ConstraintType.None) {
      out.push({
        slot: "Shape",
        type: gameLevel.constraintType,
        value: gameLevel.constraintValue,
        count: gameLevel.constraintCount,
        progress: constraintProgress,
      });
    }
    if (
      gameLevel.constraint2Type !== undefined &&
      gameLevel.constraint2Type !== ConstraintType.None
    ) {
      out.push({
        slot: "Blow",
        type: gameLevel.constraint2Type,
        value: gameLevel.constraint2Value,
        count: gameLevel.constraint2Count,
        progress: constraint2Progress,
      });
    }
    return out;
  }, [constraint2Progress, constraintProgress, gameLevel]);

  const chainTarget = Math.max(2, comboThreshold);
  const chainFill = Math.min(1, combo / chainTarget);

  return (
    <div className="relative w-full" style={{ height: 194 }}>
      {/* The guardian. He stops at the rail's edge and never overlaps the
          board: the top row is the row that ends the run, and nothing
          decorative may sit in front of it. */}
      <img
        src={guardianFrame(zoneId, mood)}
        alt=""
        aria-hidden
        className="pointer-events-none absolute select-none"
        style={{
          left: "50%",
          transform: "translateX(-50%)",
          top: 26,
          width: 150,
          height: 150,
          objectFit: "contain",
          filter: "brightness(0.92) drop-shadow(0 8px 16px rgba(0,0,0,0.8))",
        }}
      />

      {/* LEFT — the score, seated, and the chain that feeds it */}
      <div
        className="absolute flex flex-col justify-center px-2.5"
        style={{ ...SEAT, left: 8, top: 52, width: 126, height: 66 }}
      >
        <span className="text-[8.5px] font-bold uppercase tracking-[0.16em] text-[#FACC15]/70">
          Score
        </span>
        <span
          className={`${FIGURE} mt-1 truncate text-[30px] text-[#FACC15]`}
          style={{ textShadow: STAMP }}
        >
          {isDaily ? (
            shownScore.toLocaleString("en-US")
          ) : (
            <>
              {shownScore}
              <span className="text-[17px] text-white/50">/{targetScore}</span>
            </>
          )}
        </span>
      </div>

      <div className="absolute" style={{ left: 12, top: 126 }}>
        <ProgressRing
          progress={chainFill}
          size={54}
          color={combo >= chainTarget ? "green" : combo > 0 ? "orange" : "blue"}
          icon={
            <span className="font-sans text-[19px] font-black text-white">
              {combo}
            </span>
          }
          badgeBottomRight={`${chainTarget}+`}
        />
      </div>
      <div
        className="absolute text-[8.5px] font-bold uppercase leading-[1.5] tracking-[0.16em]"
        style={{ left: 74, top: 140 }}
      >
        <span className="block text-[#4ADE80]/85">Chain</span>
        <span className="block text-white/35">
          {isDaily ? `${chainTarget}+ counts` : "feeds both"}
        </span>
      </div>

      {/* RIGHT — what the day asks for */}
      {isDaily ? (
        <div
          className="absolute flex flex-col justify-center px-2.5"
          style={{ ...SEAT, left: 296, top: 52, width: 126, height: 66 }}
        >
          <span className="truncate text-[8.5px] font-bold uppercase tracking-[0.06em] text-[#38BDF8]/85">
            {objectiveName ?? "Objective"}
          </span>
          <span
            className={`${FIGURE} mt-1 truncate text-[30px] text-[#38BDF8]`}
            style={{ textShadow: STAMP }}
          >
            {shownTheme.toLocaleString("en-US")}
          </span>
        </div>
      ) : (
        constraints.map((constraint, index) => {
          const measured = constraintStatus(
            constraint.type,
            constraint.value,
            constraint.count,
            constraint.progress,
          );
          const status = {
            ...measured,
            complete: (latchedStarSources & (1 << (index + 1))) !== 0,
          };
          return (
            <div
              key={constraint.slot}
              className="absolute flex flex-col justify-center rounded-lg px-2"
              style={{
                ...SEAT,
                left: 296,
                top: index === 0 ? 45 : 116,
                width: 126,
                height: 65,
              }}
              aria-label={`${constraint.slot}: ${status.description}`}
            >
              <span className="text-[7.5px] font-black uppercase tracking-[0.16em] text-cyan-300/70">
                {constraint.slot}
              </span>
              <span className="mt-0.5 line-clamp-2 text-[9px] font-bold leading-[1.15] text-white/80">
                {status.description}
              </span>
              {status.class === "cumulative" ? (
                <div className="mt-1 flex items-center gap-1.5">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/70"
                    role="progressbar"
                    aria-label={`${constraint.slot} progress`}
                    aria-valuemin={0}
                    aria-valuemax={status.required}
                    aria-valuenow={status.progress}
                  >
                    <div
                      className={`h-full rounded-full ${status.complete ? "bg-emerald-400" : "bg-cyan-400"}`}
                      style={{
                        width: `${constraintProgressOf(status.progress, status.required) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-[8px] font-black tabular-nums text-white/65">
                    {status.progress}/{status.required}
                  </span>
                </div>
              ) : (
                <span
                  className={`mt-1 text-[8px] font-black uppercase tracking-[0.08em] ${status.complete ? "text-emerald-300" : "text-amber-300"}`}
                >
                  {status.complete ? "✓ Landed" : "◇ Waiting for one move"}
                </span>
              )}
            </div>
          );
        })
      )}

      {/* THE CHIN — the only self-lit thing on the screen, because it is the
          only value here that moves on its own. */}
      <div
        className="absolute grid place-items-center rounded-full font-sans font-black text-[#20140A]"
        style={{
          left: "50%",
          marginLeft: -24,
          top: 140,
          width: 48,
          height: 48,
          fontSize: isDaily ? 15 : 20,
          letterSpacing: "-0.02em",
          background: `radial-gradient(circle at 34% 28%, #fff, ${isDaily ? tier.color : "#FACC15"} 44%, rgba(0,0,0,0.85) 130%)`,
          boxShadow:
            "0 0 0 3px rgba(107,83,32,0.9), 0 0 0 4.5px rgba(0,0,0,0.7), 0 0 24px rgba(250,204,21,0.4), inset 0 3px 7px rgba(255,255,255,0.55), 0 3px 0 rgba(0,0,0,0.6)",
        }}
      >
        {isDaily ? `×${tier.multiplier}` : level}
      </div>
    </div>
  );
}
