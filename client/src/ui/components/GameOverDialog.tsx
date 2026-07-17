import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { dailyLeaderboardRank } from "@/chain/dailyClient";
import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import type { ThemeColors } from "@/config/themes";
import { useDaily } from "@/contexts/daily";
import { Game } from "@/game/model";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";

const PORTRAIT_MASK =
  "linear-gradient(to bottom, transparent 0%, black 15%, black 70%, transparent 95%), linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)";

const PRESSURE_TIERS = [
  "Very Easy",
  "Easy",
  "Medium",
  "Medium Hard",
  "Hard",
  "Very Hard",
  "Expert",
  "Master",
] as const;

const pressureTierName = (difficulty: number): string =>
  PRESSURE_TIERS[Math.max(0, Math.min(difficulty, PRESSURE_TIERS.length - 1))];

interface GameOverDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Blocks dismissal while background settlement finishes on-chain. */
  closeDisabled?: boolean;
  settlementFailed?: boolean;
  settlementError?: string | null;
  onRetrySettlement?: () => void;
  game: Game;
  colors?: ThemeColors;
}

/**
 * Daily/arena run-over card in the guardian-trial language (shared with
 * LevelCompleteDialog / VictoryDialog): the zone guardian reacts to the run
 * with one of two lines — a beaten-best salute or the daily rally cry — over
 * the daily score, standing, and pressure-tier breakdown.
 */
const GameOverDialog: React.FC<GameOverDialogProps> = ({
  isOpen,
  onClose,
  closeDisabled = false,
  settlementFailed = false,
  settlementError = null,
  onRetrySettlement,
  game,
  colors,
}) => {
  const [phase, setPhase] = useState(0);
  const daily = useDaily();
  const owner = useConnectedPlayer().publicKey;
  const guardian = getZoneGuardian(game.zoneId);

  useEffect(() => {
    if (!isOpen) return;
    setPhase(0);
    const t1 = window.setTimeout(() => setPhase(1), 180);
    const t2 = window.setTimeout(() => setPhase(2), 700);
    const t3 = window.setTimeout(() => setPhase(3), 1100);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [isOpen]);

  // Rank is read from the current standing; it firms up once the just-finished
  // run settles and the board refreshes.
  const rank = useMemo(() => {
    const board = daily.daily?.leaderboard ?? [];
    if (!owner) return null;
    const index = board.findIndex((entry) => entry.player.equals(owner));
    return index >= 0 ? dailyLeaderboardRank(board, index) : null;
  }, [daily.daily?.leaderboard, owner]);

  const previousBest = daily.daily?.player?.bestDailyScore ?? 0;
  const isNewBest = game.totalScore > previousBest;
  const guardianLine = isNewBest ? guardian.threeStar : guardian.dailyGreeting;

  const tweetUrl = useMemo(() => {
    const msg = `🏆 ${
      isNewBest
        ? `New Daily best on @zkube_game — ${game.totalScore.toLocaleString()}!`
        : `Ran the @zkube_game Daily for ${game.totalScore.toLocaleString()}!`
    }
⚡ ${game.engineScore.toLocaleString()} engine · +${game.challengeBonus.toLocaleString()} challenge
🔥 ${pressureTierName(game.currentDifficulty)} pressure
Can you beat it? app.zkube.xyz`;
    return `https://x.com/intent/tweet?text=${encodeURIComponent(msg)}`;
  }, [
    isNewBest,
    game.totalScore,
    game.engineScore,
    game.challengeBonus,
    game.currentDifficulty,
  ]);

  if (!isOpen) return null;

  const handlePrimary = () => {
    if (settlementFailed) {
      onRetrySettlement?.();
      return;
    }
    if (closeDisabled) return;
    onClose();
  };

  return (
    <motion.div
      className="absolute inset-0 z-40 flex flex-col bg-black/70"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Full-height guardian portrait */}
      <div className="relative flex min-h-0 flex-1 items-end justify-center overflow-hidden">
        <motion.div
          className="relative h-[55%] max-h-[340px]"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 20 }}
        >
          <img
            src={getGuardianPortrait(game.zoneId)}
            alt={guardian.name}
            className="h-full w-auto object-contain"
            style={{
              maskImage: PORTRAIT_MASK,
              WebkitMaskImage: PORTRAIT_MASK,
              maskComposite: "intersect",
              WebkitMaskComposite: "source-in",
            }}
            draggable={false}
          />
        </motion.div>
      </div>

      {/* Run panel */}
      <motion.div
        className="shrink-0"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, type: "spring", stiffness: 300, damping: 25 }}
      >
        <div
          className="mx-2 mb-3 rounded-2xl border-2 px-4 pb-4 pt-3"
          style={{
            background: colors
              ? `linear-gradient(180deg, ${colors.backgroundGradientStart ?? "#0a1628"}F5, ${colors.background ?? "#050a12"}FA)`
              : "linear-gradient(180deg, rgba(15,23,42,0.95), rgba(10,15,30,0.98))",
            borderColor: isNewBest
              ? "rgba(250,204,21,0.35)"
              : "rgba(103,232,249,0.28)",
            boxShadow: "0 -4px 32px rgba(0,0,0,0.5)",
          }}
        >
          {/* Title + rank */}
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={`font-display text-xl font-black ${isNewBest ? "text-yellow-300 drop-shadow-[0_0_10px_rgba(250,204,21,0.35)]" : "text-cyan-200"}`}
            >
              {isNewBest ? "New Daily Best!" : "Arena Run"}
            </p>
            {rank !== null && (
              <span className="font-sans text-sm font-black text-white/80">
                Rank #{rank}
              </span>
            )}
          </div>

          {/* Guardian line */}
          <p className="mt-1 font-sans text-[14px] leading-relaxed text-white/85">
            &quot;{guardianLine}&quot;
          </p>

          {/* Hero daily score */}
          <motion.div
            className="mt-3 text-center"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={phase >= 1 ? { opacity: 1, scale: 1 } : {}}
            transition={{ type: "spring", stiffness: 220, damping: 16 }}
          >
            <p
              className="font-display text-5xl font-black text-cyan-300"
              style={{ textShadow: "0 0 24px rgba(34,211,238,0.35)" }}
            >
              {game.totalScore.toLocaleString()}
            </p>
            <p className="font-sans text-[11px] font-bold uppercase tracking-[0.15em] text-white/45">
              Daily Score
              {!isNewBest && previousBest > 0
                ? ` · best ${previousBest.toLocaleString()}`
                : ""}
            </p>
          </motion.div>

          {/* Pressure / engine / challenge */}
          <motion.div
            className="mt-3 flex gap-2"
            initial={{ opacity: 0, y: 10 }}
            animate={phase >= 2 ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.3 }}
          >
            <div className="flex-1 rounded-xl bg-white/[0.05] px-2.5 py-2 text-center">
              <p className="font-sans text-sm font-bold text-amber-300">
                {pressureTierName(game.currentDifficulty)}
              </p>
              <p className="font-sans text-[9px] text-white/40">
                {game.moves}/100 moves
              </p>
            </div>
            <div className="flex-1 rounded-xl bg-white/[0.05] px-2.5 py-2 text-center">
              <p className="font-sans text-sm font-bold text-white">
                {game.engineScore.toLocaleString()}
              </p>
              <p className="font-sans text-[9px] text-white/40">Engine</p>
            </div>
            <div className="flex-1 rounded-xl bg-white/[0.05] px-2.5 py-2 text-center">
              <p className="font-sans text-sm font-bold text-cyan-300">
                +{game.challengeBonus.toLocaleString()}
              </p>
              <p className="font-sans text-[9px] text-white/40">Challenge</p>
            </div>
          </motion.div>

          {game.currentDifficulty === 7 && (
            <p className="mt-2 text-center font-sans text-[11px] font-bold text-amber-300">
              First Tier 7 today awards +50 XP
            </p>
          )}

          {/* Settlement error */}
          {settlementFailed && (
            <p className="mt-2 text-center font-sans text-xs font-semibold text-red-300">
              {settlementError ?? "Daily settlement failed. Retry to finish."}
            </p>
          )}

          {/* Actions */}
          <div className="mt-3 flex flex-col gap-2">
            <ArcadeButton
              onClick={handlePrimary}
              disabled={closeDisabled && !settlementFailed}
            >
              {settlementFailed
                ? "Retry settlement"
                : closeDisabled
                  ? "Settling…"
                  : "Back to Daily Arena"}
            </ArcadeButton>
            <a
              href={tweetUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 font-sans text-sm font-bold text-white/80 transition-colors hover:bg-white/[0.1]"
            >
              𝕏 Share your run
            </a>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default GameOverDialog;
