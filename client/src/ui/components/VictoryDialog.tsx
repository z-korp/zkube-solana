import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";

import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import type { ThemeColors } from "@/config/themes";
import { Game } from "@/game/model";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";

interface VictoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Blocks dismissal while background settlement finishes on-chain. */
  closeDisabled?: boolean;
  game: Game;
  finalCampaignMapId: number;
  colors?: ThemeColors;
}

const PORTRAIT_MASK =
  "linear-gradient(to bottom, transparent 0%, black 15%, black 70%, transparent 95%), linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)";

/**
 * Guardian-trial victory card — the boss counterpart to LevelCompleteDialog,
 * sharing its full-height portrait + bottom-panel language (no off-theme
 * trophy). Shows the run totals, the guardian's respect line, and the
 * Campaign completion, with a Share action and Continue.
 */
const VictoryDialog: React.FC<VictoryDialogProps> = ({
  isOpen,
  onClose,
  closeDisabled = false,
  game,
  finalCampaignMapId,
  colors,
}) => {
  const [phase, setPhase] = useState(0);
  const guardian = getZoneGuardian(game.zoneId);
  const campaignComplete = game.zoneId === finalCampaignMapId;

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

  const tweetUrl = useMemo(() => {
    const msg = `🏆 ${
      campaignComplete
        ? "I completed the zKube campaign!"
        : `I defeated ${guardian.name}, the ${guardian.title}, in zKube!`
    }
🧱 ${game.totalLinesCleared} lines cleared
💎 ${game.totalScore.toLocaleString()} total points
🔥 ${game.maxComboRun} max combo
Can you clear the guardian trial? 😎
Play now: app.zkube.xyz
@zkorp_ @zkube_game`;
    return `https://x.com/intent/tweet?text=${encodeURIComponent(msg)}&url=app.zkube.xyz`;
  }, [
    campaignComplete,
    guardian.name,
    guardian.title,
    game.maxComboRun,
    game.totalLinesCleared,
    game.totalScore,
  ]);

  if (!isOpen) return null;

  return (
    <motion.div
      className="absolute inset-0 z-40 flex flex-col bg-black/70"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={phase >= 3 && !closeDisabled ? onClose : undefined}
    >
      {/* Full-height guardian portrait */}
      <div className="relative flex min-h-0 flex-1 items-end justify-center overflow-hidden">
        <motion.div
          className="relative h-[60%] max-h-[360px]"
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

      {/* Victory panel */}
      <motion.div
        className="shrink-0"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, type: "spring", stiffness: 300, damping: 25 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="mx-2 mb-3 rounded-2xl border-2 px-4 pb-4 pt-3"
          style={{
            background: colors
              ? `linear-gradient(180deg, ${colors.backgroundGradientStart ?? "#0a1628"}F5, ${colors.background ?? "#050a12"}FA)`
              : "linear-gradient(180deg, rgba(15,23,42,0.95), rgba(10,15,30,0.98))",
            borderColor: "rgba(250,204,21,0.35)",
            boxShadow: "0 -4px 32px rgba(0,0,0,0.5)",
          }}
        >
          {/* Title */}
          <p className="font-display text-xl font-black text-yellow-300 drop-shadow-[0_0_10px_rgba(250,204,21,0.35)]">
            {campaignComplete ? "Campaign Complete!" : "Trial Passed!"}
          </p>

          {/* Guardian respect line */}
          <p className="mt-1 font-sans text-[14px] italic leading-relaxed text-white/85">
            &quot;{guardian.respectLine}&quot;
          </p>

          {/* Run totals */}
          <motion.div
            className="mt-3 flex gap-2"
            initial={{ opacity: 0, y: 10 }}
            animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex-1 rounded-xl bg-white/[0.05] px-3 py-2 text-center">
              <p className="font-sans text-sm font-bold text-yellow-300">
                {game.totalLinesCleared}
              </p>
              <p className="font-sans text-[9px] text-white/40">Lines</p>
            </div>
            <div className="flex-1 rounded-xl bg-white/[0.05] px-3 py-2 text-center">
              <p className="font-sans text-sm font-bold text-cyan-300">
                {game.totalScore.toLocaleString()}
              </p>
              <p className="font-sans text-[9px] text-white/40">Score</p>
            </div>
            <div className="flex-1 rounded-xl bg-white/[0.05] px-3 py-2 text-center">
              <p className="font-sans text-sm font-bold text-orange-300">
                {game.maxComboRun}
              </p>
              <p className="font-sans text-[9px] text-white/40">Best Combo</p>
            </div>
          </motion.div>

          {/* Actions */}
          <motion.div
            className="mt-3 flex flex-col gap-2"
            initial={{ opacity: 0 }}
            animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <a
              href={tweetUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 font-sans text-sm font-bold text-white/80 transition-colors hover:bg-white/[0.1]"
            >
              🏆 Share on X
            </a>
            <ArcadeButton onClick={onClose} disabled={closeDisabled}>
              {closeDisabled ? "Settling…" : "Continue"}
            </ArcadeButton>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default VictoryDialog;
