import React, { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { motion } from "motion/react";

import type { ThemeColors } from "@/config/themes";
import {
  ACHIEVEMENT_CATEGORIES,
  useAchievements,
} from "@/hooks/useAchievements";
import ProgressBar from "@/ui/components/shared/ProgressBar";

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 24 },
  },
};

interface AchievementsTabProps {
  colors: ThemeColors;
}

const TIER_LABELS = ["I", "II", "III", "IV"] as const;

const RARITY_BY_TIER = {
  1: "Common",
  2: "Rare",
  3: "Epic",
  4: "Legendary",
} as const;

const RARITY_COLORS = {
  Common: "#B0B8C4",
  Rare: "#7FC3FF",
  Epic: "#B89BFF",
  Legendary: "#FFD86E",
} as const;

const AchievementsTab: React.FC<AchievementsTabProps> = ({ colors }) => {
  const { achievements, claiming, error, claimAchievement } = useAchievements();
  const totalUnlocked = achievements.filter(
    (achievement) => achievement.completed,
  ).length;
  const total = achievements.length;
  const completionRatio = total <= 0 ? 0 : totalUnlocked / total;
  const completionPercent = Math.round(completionRatio * 100);

  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - completionRatio);

  const grouped = useMemo(
    () =>
      ACHIEVEMENT_CATEGORIES.map((category) => {
        const tiers = achievements
          .filter((achievement) => achievement.category === category)
          .sort((left, right) => left.tier - right.tier);
        const currentIndex = tiers.findIndex(
          (achievement) => !achievement.claimed,
        );
        const activeTier = currentIndex >= 0 ? currentIndex : tiers.length - 1;
        return { category, tiers, activeTier };
      }),
    [achievements],
  );

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="flex flex-col gap-3.5 pb-2"
    >
      <motion.section
        variants={itemVariants}
        className="rounded-2xl border px-4 py-3.5 backdrop-blur-xl"
        style={{
          background: "rgba(255,255,255,0.1)",
          borderColor: "rgba(255,255,255,0.18)",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="relative h-20 w-20 shrink-0">
            <svg
              className="h-full w-full -rotate-90"
              viewBox="0 0 84 84"
              aria-hidden
            >
              <circle
                cx="42"
                cy="42"
                r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.16)"
                strokeWidth="8"
              />
              <circle
                cx="42"
                cy="42"
                r={radius}
                fill="none"
                stroke={colors.accent}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeOffset}
                style={{ transition: "stroke-dashoffset 0.6s ease" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p
                className="font-sans text-[20px] font-black leading-none"
                style={{ color: colors.text }}
              >
                {completionPercent}%
              </p>
              <p
                className="font-sans text-[10px] font-semibold"
                style={{ color: colors.textMuted }}
              >
                complete
              </p>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p
              className="font-sans text-[12px] font-bold uppercase tracking-[0.12em]"
              style={{ color: colors.textMuted }}
            >
              Achievement Vault
            </p>
            <p
              className="mt-1 font-sans text-[20px] font-extrabold leading-tight"
              style={{ color: colors.text }}
            >
              {totalUnlocked}/{total} unlocked
            </p>
          </div>
        </div>
      </motion.section>

      {grouped.map(({ category, tiers, activeTier }) => {
        const active = tiers[activeTier];
        if (!active) return null;
        const allClaimed = tiers.every((tier) => tier.claimed);
        const isClaiming = claiming === `achievement:${active.index}`;

        return (
          <motion.section
            variants={itemVariants}
            key={category}
            className="rounded-2xl border p-3 backdrop-blur-xl"
            style={{
              background: "rgba(255,255,255,0.08)",
              borderColor: "rgba(255,255,255,0.15)",
            }}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-lg">{active.icon}</span>
              <p
                className="font-sans text-[13px] font-extrabold"
                style={{ color: colors.text }}
              >
                {category}
              </p>
              <div className="ml-auto flex gap-1">
                {tiers.map((tier, index) => {
                  const rarity = RARITY_BY_TIER[tier.tier];
                  const rarityColor = RARITY_COLORS[rarity];
                  const isCurrent = index === activeTier && !allClaimed;
                  return (
                    <span
                      key={tier.tier}
                      className="flex h-[22px] min-w-[26px] items-center justify-center rounded-full px-1.5 font-sans text-[10px] font-extrabold"
                      style={{
                        background: tier.completed
                          ? `${rarityColor}30`
                          : isCurrent
                            ? `${rarityColor}18`
                            : "rgba(255,255,255,0.06)",
                        border: `1.5px solid ${
                          tier.completed
                            ? rarityColor
                            : isCurrent
                              ? `${rarityColor}60`
                              : "rgba(255,255,255,0.12)"
                        }`,
                        color: tier.completed
                          ? rarityColor
                          : isCurrent
                            ? `${rarityColor}BB`
                            : "rgba(255,255,255,0.25)",
                      }}
                      title={tier.claimed ? "Claimed" : undefined}
                    >
                      {TIER_LABELS[index]}
                    </span>
                  );
                })}
              </div>
            </div>

            {allClaimed ? (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="inline-flex rounded-full border border-emerald-300/40 bg-emerald-300/15 px-2 py-0.5 font-sans text-[10px] font-extrabold uppercase tracking-[0.08em] text-emerald-200">
                  All tiers claimed
                </span>
                <span
                  className="font-sans text-[10px] font-semibold"
                  style={{ color: colors.textMuted }}
                >
                  +{tiers.reduce((sum, tier) => sum + tier.xp, 0)} XP earned
                </span>
              </div>
            ) : (
              <div className="mt-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p
                    className="font-sans text-[11px] font-semibold"
                    style={{ color: colors.textMuted }}
                  >
                    {active.description}
                  </p>
                  <p
                    className="shrink-0 font-sans text-[11px] font-bold tabular-nums"
                    style={{ color: colors.textMuted }}
                  >
                    {Math.min(active.progress, active.target)}/{active.target}
                  </p>
                </div>
                <div className="mt-1">
                  <ProgressBar
                    value={Math.min(active.progress, active.target)}
                    max={active.target}
                    color={RARITY_COLORS[RARITY_BY_TIER[active.tier]]}
                    height={5}
                    glow={active.claimable}
                  />
                </div>
                {active.claimable && (
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    type="button"
                    onClick={() =>
                      void claimAchievement(active.index).catch(() => undefined)
                    }
                    disabled={claiming !== null}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-2 font-sans text-[10px] font-extrabold uppercase text-[#0a1628] disabled:opacity-50"
                    style={{
                      background: `linear-gradient(135deg, ${colors.accent}, ${colors.accent2})`,
                      boxShadow: `0 0 12px ${colors.accent}55`,
                    }}
                  >
                    {isClaiming && <Loader2 className="h-3 w-3 animate-spin" />}
                    {isClaiming ? "Claiming…" : `Claim +${active.xp} XP`}
                  </motion.button>
                )}
              </div>
            )}
          </motion.section>
        );
      })}

      {error && (
        <motion.p
          variants={itemVariants}
          role="alert"
          className="text-center font-sans text-xs text-red-300"
        >
          {error}
        </motion.p>
      )}
    </motion.div>
  );
};

export default AchievementsTab;
