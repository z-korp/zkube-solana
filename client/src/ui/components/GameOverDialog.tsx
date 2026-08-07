import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { dailyLeaderboardRank } from "@/chain/dailyClient";
import { getZoneGuardian } from "@/config/bossCharacters";
import { DAILY_WEIGHTS } from "@/ui/components/economy/payout";
import GuardianQuote from "@/ui/components/shared/GuardianQuote";
import { useGuardianTalk } from "@/ui/components/shared/useGuardianTalk";
import type { ThemeColors } from "@/config/themes";
import { useDaily } from "@/contexts/daily";
import { Game } from "@/game/model";
import { TROPHY_IMAGES } from "@/ui/components/arena/leaderboardMedals";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";


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

const rankChipStyle = (
  rank: number,
): { background: string; borderColor: string } => {
  if (rank === 1)
    return {
      background: "rgba(255,215,0,0.16)",
      borderColor: "rgba(255,215,0,0.5)",
    };
  if (rank === 2)
    return {
      background: "rgba(192,192,192,0.14)",
      borderColor: "rgba(192,192,192,0.45)",
    };
  if (rank === 3)
    return {
      background: "rgba(205,127,50,0.14)",
      borderColor: "rgba(205,127,50,0.45)",
    };
  return {
    background: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.18)",
  };
};

/**
 * Daily/arena run-over card in the guardian-trial language (shared with
 * LevelCompleteDialog / VictoryDialog): the guardian salutes the run, then the
 * card leads with what a daily player actually cares about — whether they beat
 * their best and where that stands them — and how it feeds the Weekly race.
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
  const isPractice = game.runMode === "practice";

  useEffect(() => {
    if (!isOpen) return;
    setPhase(0);
    const t1 = window.setTimeout(() => setPhase(1), 180);
    const t2 = window.setTimeout(() => setPhase(2), 700);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [isOpen]);

  // Rank is read from the current standing; it firms up once the just-finished
  // run settles and the board refreshes.
  const rank = useMemo(() => {
    const board = isPractice
      ? (daily.practiceDaily?.leaderboard ?? [])
      : (daily.daily?.leaderboard ?? []);
    if (isPractice) {
      return 1 + board.filter((entry) => entry.dailyScore >= game.totalScore).length;
    }
    if (!owner) return null;
    const index = board.findIndex((entry) => entry.player.equals(owner));
    return index >= 0 ? dailyLeaderboardRank(board, index) : null;
  }, [daily.daily?.leaderboard, daily.practiceDaily?.leaderboard, game.totalScore, isPractice, owner]);

  const previousBest = isPractice
    ? (daily.practiceDaily?.player?.bestDailyScore ?? 0)
    : (daily.daily?.player?.bestDailyScore ?? 0);
  const isNewBest = game.totalScore > previousBest;
  // A personal best genuinely startles the guardian; a ranked run outside the
  // Daily's paid places gets the consolation, anything else the even-handed
  // daily line.
  const guardianLine = isNewBest
    ? guardian.newBestLine
    : !isPractice && rank !== null && rank > DAILY_WEIGHTS.length
      ? guardian.noPrizeLine
      : guardian.dailyGreeting;
  const talk = useGuardianTalk(game.zoneId, guardianLine, {
    mood: isNewBest ? "surprised" : "idle",
  });

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
            src={talk.src}
            alt={guardian.name}
            className="h-full w-auto object-contain"
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
          <GuardianQuote
            talk={talk}
            quoted
            className="min-h-[2.6em] font-sans text-[14px] italic leading-relaxed text-white/70"
          />

          {/* Hero: best + score + rank chip */}
          <motion.div
            className="mt-3 flex flex-col items-center"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={phase >= 1 ? { opacity: 1, scale: 1 } : {}}
            transition={{ type: "spring", stiffness: 220, damping: 16 }}
          >
            <p
              className="font-sans text-[11px] font-black uppercase tracking-[0.18em]"
              style={{
                color: isNewBest ? "#fde047" : "rgba(255,255,255,0.45)",
              }}
            >
              {isPractice
                ? "Practice Score"
                : isNewBest
                  ? "New Daily Best"
                  : "Daily Score"}
            </p>
            <p
              className="font-display text-6xl font-black leading-none"
              style={{
                color: isNewBest ? "#facc15" : "#67e8f9",
                textShadow: isNewBest
                  ? "0 0 26px rgba(250,204,21,0.4)"
                  : "0 0 24px rgba(34,211,238,0.35)",
              }}
            >
              {game.totalScore.toLocaleString()}
            </p>
            {!isNewBest && previousBest > 0 && (
              <p className="mt-1 font-sans text-[11px] text-white/45">
                Your best · {previousBest.toLocaleString()}
              </p>
            )}
            {rank !== null && (
              <div
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1"
                style={rankChipStyle(rank)}
              >
                {rank <= 3 && (
                  <img
                    src={TROPHY_IMAGES[rank]}
                    alt=""
                    className="h-4 w-4"
                    draggable={false}
                  />
                )}
                <span className="font-sans text-sm font-black text-white">
                  {isPractice ? `Would have ranked #${rank}` : `Rank #${rank}`}
                </span>
              </div>
            )}
          </motion.div>

          {/* Weekly stakes — the reason the daily matters */}
          <p className="mt-3 text-center font-sans text-[11px] font-semibold text-white/50">
            {isPractice
              ? "Free Practice · yesterday's rules · no leaderboard or prize changes"
              : "Paid ranked result · SOL payouts are pushed automatically"}
          </p>

          {/* Settlement error */}
          {settlementFailed && (
            <p className="mt-2 text-center font-sans text-xs font-semibold text-red-300">
              {settlementError ?? "Daily settlement failed. Retry to finish."}
            </p>
          )}

          {/* Action */}
          <div className="mt-3">
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
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default GameOverDialog;
