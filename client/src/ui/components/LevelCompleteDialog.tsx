import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

import { getGuardianStarText, getZoneGuardian } from "@/config/bossCharacters";
import { useGuardianTalk } from "@/ui/components/shared/useGuardianTalk";
import type { ThemeColors } from "@/config/themes";
import { useMusicPlayer } from "@/contexts/hooks";
import { calculateLevelStars } from "@/game/level";
import type { GameLevelData } from "@/hooks/useGameLevel";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";

interface LevelCompleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Blocks Continue while background settlement finishes on-chain. */
  continueDisabled?: boolean;
  level: number;
  levelMoves: number;
  prevTotalScore: number;
  totalScore: number;
  gameLevel: GameLevelData | null;
  zoneId?: number;
  colors?: ThemeColors;
  isIncomplete?: boolean;
}

const LevelCompleteDialog: React.FC<LevelCompleteDialogProps> = ({
  isOpen,
  onClose,
  continueDisabled = false,
  level,
  levelMoves,
  prevTotalScore,
  totalScore,
  gameLevel,
  zoneId = 1,
  colors,
  isIncomplete = false,
}) => {
  const [animationPhase, setAnimationPhase] = useState(0);
  const { playSfx } = useMusicPlayer();
  const guardian = getZoneGuardian(zoneId);
  const isBossLevel = level === 10;

  useEffect(() => {
    if (!isOpen) return;
    setAnimationPhase(0);

    if (isIncomplete) {
      const timer = window.setTimeout(() => setAnimationPhase(3), 300);
      return () => window.clearTimeout(timer);
    }

    const timer1 = window.setTimeout(() => {
      setAnimationPhase(1);
      playSfx("star");
    }, 180);
    const timer2 = window.setTimeout(() => {
      setAnimationPhase(2);
      playSfx("coin");
    }, 700);
    const timer3 = window.setTimeout(() => setAnimationPhase(3), 1100);

    return () => {
      window.clearTimeout(timer1);
      window.clearTimeout(timer2);
      window.clearTimeout(timer3);
    };
  }, [isOpen, playSfx, isIncomplete]);

  const maxMoves = gameLevel?.maxMoves ?? 0;
  const star3UsedCap = gameLevel?.star3Threshold ?? 0;
  const star2UsedCap = gameLevel?.star2Threshold ?? 0;
  const levelFinalScore = Math.max(0, totalScore - prevTotalScore);
  const movesUsed = levelMoves;

  const starsEarned = useMemo(
    () =>
      calculateLevelStars({
        movesUsed,
        star3UsedCap,
        star2UsedCap,
        isIncomplete,
      }),
    [movesUsed, star3UsedCap, star2UsedCap, isIncomplete],
  );

  const guardianLine = isIncomplete
    ? guardian.incomplete
    : isBossLevel
      ? guardian.defeatLine
      : getGuardianStarText(guardian, starsEarned);

  // Ace-Attorney beat: the guardian speaks the verdict, then rests on the
  // frame the result earned — humbled on a fallen trial, celebrating a
  // three-star run, content otherwise, watchful on a failed level.
  const talk = useGuardianTalk(
    zoneId,
    guardianLine,
    isIncomplete
      ? "idle"
      : isBossLevel
        ? "defeated"
        : starsEarned >= 3
          ? "celebrate"
          : "satisfied",
  );

  const title = isIncomplete
    ? "Level Incomplete"
    : isBossLevel
      ? "Trial Passed!"
      : `Level ${level} Complete!`;

  const titleColor = isIncomplete
    ? "text-red-400"
    : isBossLevel
      ? "text-yellow-300"
      : "text-green-400";

  if (!isOpen) return null;

  return (
    <>
      <motion.div
        className="absolute inset-0 z-40 flex flex-col bg-black/70"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={animationPhase >= 3 && !continueDisabled ? onClose : undefined}
      >
        {/* Full-height guardian portrait */}
        <div className="relative flex min-h-0 flex-1 items-end justify-center overflow-hidden">
          <motion.div
            className="relative h-[60%] max-h-[360px]"
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              delay: 0.1,
              type: "spring",
              stiffness: 200,
              damping: 20,
            }}
          >
            <img
              src={talk.src}
              alt={guardian.name}
              className="h-full w-auto object-contain"
              style={{
                maskImage:
                  "linear-gradient(to bottom, transparent 0%, black 15%, black 70%, transparent 95%), linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, transparent 0%, black 15%, black 70%, transparent 95%), linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)",
                maskComposite: "intersect",
                WebkitMaskComposite: "source-in",
              }}
              draggable={false}
            />
          </motion.div>
        </div>

        {/* Dialog panel */}
        <motion.div
          className="shrink-0"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.15,
            type: "spring",
            stiffness: 300,
            damping: 25,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="mx-2 mb-3 rounded-2xl border-2 px-4 pb-4 pt-3"
            style={{
              background: colors
                ? `linear-gradient(180deg, ${colors.backgroundGradientStart ?? "#0a1628"}F5, ${colors.background ?? "#050a12"}FA)`
                : "linear-gradient(180deg, rgba(15,23,42,0.95), rgba(10,15,30,0.98))",
              borderColor: isIncomplete
                ? "rgba(248,113,113,0.3)"
                : isBossLevel
                  ? "rgba(250,204,21,0.3)"
                  : "rgba(74,222,128,0.3)",
              boxShadow: "0 -4px 32px rgba(0,0,0,0.5)",
            }}
          >
            {/* Title */}
            <p className={`font-display text-xl font-black ${titleColor}`}>
              {title}
            </p>

            {/* Guardian quote — typed letter by letter; tap skips ahead */}
            <p
              className="mt-1 min-h-[2.6em] font-sans text-[14px] italic leading-relaxed text-white/85"
              onClick={talk.typing ? talk.skip : undefined}
            >
              &quot;{guardianLine.slice(0, talk.typed)}&quot;
              {talk.typing && (
                <span
                  aria-hidden
                  className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-yellow-400 align-middle"
                />
              )}
            </p>

            {/* Stars + stats — only for complete */}
            {!isIncomplete && (
              <motion.div
                className="mt-3 space-y-2"
                initial={{ opacity: 0, y: 10 }}
                animate={
                  animationPhase >= 1
                    ? { opacity: 1, y: 0 }
                    : { opacity: 0, y: 10 }
                }
                transition={{ duration: 0.3 }}
              >
                {/* Stars */}
                <div className="flex justify-center gap-2">
                  {[1, 2, 3].map((star, index) => {
                    const earned = star <= starsEarned;
                    return (
                      <motion.span
                        key={star}
                        className={`text-2xl ${earned ? "text-yellow-300 drop-shadow-[0_0_8px_rgba(250,204,21,0.4)]" : "text-white/20"}`}
                        initial={{ scale: 0, rotate: -90 }}
                        animate={
                          animationPhase >= 1
                            ? { scale: 1, rotate: 0 }
                            : { scale: 0, rotate: -90 }
                        }
                        transition={{
                          delay: index * 0.12,
                          type: "spring",
                          stiffness: 250,
                          damping: 16,
                        }}
                      >
                        ★
                      </motion.span>
                    );
                  })}
                </div>

                {/* Campaign score and completion only. Arcade progression is
                    deliberately absent from this surface. */}
                <motion.div
                  className="flex gap-2"
                  initial={{ opacity: 0 }}
                  animate={
                    animationPhase >= 2 ? { opacity: 1 } : { opacity: 0 }
                  }
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex-1 rounded-xl bg-white/[0.05] px-3 py-2 text-center">
                    <p className="font-sans text-sm font-bold text-emerald-300">
                      +{levelFinalScore}
                    </p>
                    <p className="font-sans text-[9px] text-white/40">Score</p>
                  </div>
                  <div className="flex-1 rounded-xl bg-white/[0.05] px-3 py-2 text-center">
                    <p className="font-sans text-sm font-bold text-white">
                      {levelMoves}/{maxMoves}
                    </p>
                    <p className="font-sans text-[9px] text-white/40">Moves</p>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* Button */}
            <motion.div
              className="mt-3"
              initial={{ opacity: 0 }}
              animate={animationPhase >= 3 ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <ArcadeButton onClick={onClose} disabled={continueDisabled}>
                {continueDisabled
                  ? "Settling…"
                  : isIncomplete
                    ? "Back to Map"
                    : "Continue"}
              </ArcadeButton>
            </motion.div>
          </div>
        </motion.div>
      </motion.div>
    </>
  );
};

export default LevelCompleteDialog;
