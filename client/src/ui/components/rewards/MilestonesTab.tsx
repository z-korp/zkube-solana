import React from "react";
import { motion } from "motion/react";

import {
  LEVEL_THRESHOLDS,
  getLevelFromXp,
  getTitleForLevel,
} from "@/config/profileData";
import type { ThemeColors } from "@/config/themes";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { usePlayerMeta } from "@/hooks/usePlayerMeta";
import { useProgress } from "@/contexts/progress";
import Card from "@/ui/components/shared/Card";
import ProgressBar from "@/ui/components/shared/ProgressBar";

const MILESTONE_COUNT = 10;

const milestoneStars = (index: number) => (index + 1) * 10;

const claimedMilestoneEntitlement = (bitmap: number) =>
  Array.from({ length: MILESTONE_COUNT }, (_, index) =>
    bitmap & (1 << index) ? milestoneStars(index) : 0,
  ).reduce((sum, stars) => sum + stars, 0);

/**
 * The level ladder pays the reached level in Stars, and max level unlocks the
 * recurring Weekly Mastery stipend. Shown to everyone — the ladder is the
 * long-term carrot, not a max-level secret.
 */
const MilestonesTab: React.FC<{ colors: ThemeColors }> = ({ colors }) => {
  const player = useConnectedPlayer();
  const address = player.publicKey?.toBase58() ?? "";
  const { playerMeta } = usePlayerMeta(address);
  const progress = useProgress();

  const xp = playerMeta?.lifetimeXp ?? 0;
  const level = getLevelFromXp(xp);
  const levelStartXp = LEVEL_THRESHOLDS[Math.max(level - 1, 0)] ?? 0;
  const nextLevelXp = LEVEL_THRESHOLDS[level] ?? levelStartXp;
  const isMaxLevel = level >= LEVEL_THRESHOLDS.length;
  const title = getTitleForLevel(level);
  const claimedBitmap = progress.progress?.levelMilestones?.claimed ?? 0;
  const claimedStars = Number(
    progress.progress?.levelMilestones?.totalStarsClaimed ?? 0n,
  );
  const adjustment = Math.max(
    0,
    claimedMilestoneEntitlement(claimedBitmap) - claimedStars,
  );
  const adjustmentIndex =
    adjustment > 0
      ? (Array.from({ length: MILESTONE_COUNT }, (_, index) => index).find(
          (index) => Boolean(claimedBitmap & (1 << index)),
        ) ?? -1)
      : -1;
  const stipend = progress.progress?.weeklyStipend ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-3 pb-2"
    >
      <Card tone="raised" className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p
            className="font-sans text-lg font-extrabold"
            style={{ color: colors.text }}
          >
            Level {level} · {title}
          </p>
          <p
            className="font-sans text-xs font-extrabold"
            style={{ color: colors.accent }}
          >
            {isMaxLevel
              ? `${xp.toLocaleString()} XP`
              : `${xp.toLocaleString()} / ${nextLevelXp.toLocaleString()} XP`}
          </p>
        </div>
        <div className="mt-2">
          <ProgressBar
            value={isMaxLevel ? 1 : xp - levelStartXp}
            max={isMaxLevel ? 1 : Math.max(nextLevelXp - levelStartXp, 1)}
            color={colors.accent}
            height={8}
            glow
          />
        </div>
      </Card>

      <Card className="p-3">
        {Array.from({ length: MILESTONE_COUNT }, (_, index) => {
          const milestoneLevel = (index + 1) * 10;
          const rewardStars = milestoneStars(index);
          const claimed = Boolean(claimedBitmap & (1 << index));
          const reached = level >= milestoneLevel;
          const claiming = progress.claiming === `milestone:${index}`;
          return (
            <div
              key={index}
              className="flex items-center justify-between gap-3 border-b border-white/10 py-2.5 last:border-b-0"
            >
              <p
                className="font-sans text-sm font-bold"
                style={{
                  color: reached ? colors.text : colors.textMuted,
                }}
              >
                Level {milestoneLevel}
              </p>
              {claimed && index === adjustmentIndex ? (
                <button
                  type="button"
                  disabled={progress.claiming !== null}
                  onClick={() => void progress.claimLevelMilestone(index)}
                  className="rounded-full border border-yellow-300/40 bg-yellow-300/15 px-3 py-1 font-sans text-[11px] font-black text-yellow-200 disabled:opacity-50"
                >
                  {claiming ? "Claiming…" : `Claim adjustment +${adjustment}★`}
                </button>
              ) : claimed ? (
                <span className="rounded-full bg-emerald-300/15 px-2.5 py-1 font-sans text-[10px] font-black uppercase text-emerald-200">
                  Claimed
                </span>
              ) : reached ? (
                <button
                  type="button"
                  disabled={progress.claiming !== null}
                  onClick={() => void progress.claimLevelMilestone(index)}
                  className="rounded-full border border-yellow-300/40 bg-yellow-300/15 px-3 py-1 font-sans text-[11px] font-black text-yellow-200 disabled:opacity-50"
                >
                  {claiming ? "Claiming…" : `Claim +${rewardStars}★`}
                </button>
              ) : (
                <span className="font-sans text-[11px] font-bold text-white/35">
                  +{rewardStars}★
                </span>
              )}
            </div>
          );
        })}
      </Card>

      <Card tone="subtle" className="p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-sans text-sm font-extrabold text-cyan-100">
              Weekly Mastery
            </p>
            <p className="font-sans text-[11px] font-semibold text-white/55">
              {isMaxLevel
                ? "Earn 2,500 recurring XP for 30 Stars every week"
                : "Reach Level 100 to earn a weekly 30★ stipend"}
            </p>
          </div>
          {isMaxLevel && stipend && (
            <span className="font-sans text-sm font-black text-cyan-200">
              {stipend.starsAwarded
                ? "Claimed"
                : `${Math.min(stipend.recurringXp, 2_500).toLocaleString()} / 2,500 XP`}
            </span>
          )}
        </div>
        {isMaxLevel && stipend && (
          <div className="mt-2">
            <ProgressBar
              value={stipend.recurringXp}
              max={2_500}
              color="#67e8f9"
              height={6}
            />
          </div>
        )}
      </Card>

      {progress.error && (
        <p role="alert" className="text-center font-sans text-xs text-red-300">
          {progress.error}
        </p>
      )}
    </motion.div>
  );
};

export default MilestonesTab;
