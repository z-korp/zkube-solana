import React, { useState } from "react";
import { motion } from "motion/react";

import {
  LEVEL_THRESHOLDS,
  getLevelFromXp,
  getTitleForLevel,
} from "@/config/profileData";
import { getThemeColors } from "@/config/themes";
import { usePlayerMeta } from "@/hooks/usePlayerMeta";
import { usePlayerStats } from "@/hooks/usePlayerStats";
import { useZoneProgress } from "@/hooks/useZoneProgress";
import { useZStarBalance } from "@/hooks/useZStarBalance";
import { useEmbeddedIdentity } from "@/chain/embeddedIdentityContext";
import { useProgress } from "@/contexts/progress";
import AchievementsTab from "@/ui/components/profile/AchievementsTab";
import OverviewTab from "@/ui/components/profile/OverviewTab";
import ZoneProgressTab from "@/ui/components/profile/ZoneProgressTab";
import PageHeader from "@/ui/components/shared/PageHeader";
import ProgressBar from "@/ui/components/shared/ProgressBar";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { truncatePublicKey } from "@/utils/solanaDisplay";

const TABS = ["Overview", "Zones", "Achievements"] as const;

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
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

const ProfilePage: React.FC = () => {
  const { themeTemplate } = useTheme();
  const colors = getThemeColors(themeTemplate);
  const identity = useEmbeddedIdentity();
  const address = identity.publicKey.toBase58();
  const { playerMeta } = usePlayerMeta(address);
  const { balance: starBalance } = useZStarBalance(address);
  const { zones, totalStars } = useZoneProgress(address, starBalance);
  const playerStats = usePlayerStats(address);
  const progress = useProgress();

  const xp = playerMeta?.lifetimeXp ?? 0;
  const level = getLevelFromXp(xp);
  const levelStartXp = LEVEL_THRESHOLDS[Math.max(level - 1, 0)] ?? 0;
  const nextLevelXp = LEVEL_THRESHOLDS[level] ?? levelStartXp;
  const isMaxLevel = level >= LEVEL_THRESHOLDS.length;
  const title = getTitleForLevel(level);
  const nextTitle = getTitleForLevel(Math.min(level + 1, 100));
  const nextMilestoneIndex = Array.from({ length: 10 }, (_, index) => index).find(
    (index) =>
      level >= (index + 1) * 10 &&
      !((progress.progress?.levelMilestones?.claimed ?? 0) & (1 << index)),
  );

  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-12">
      <PageHeader title="Profile" />

      <div className="mx-4 mb-4 mt-2 min-h-0 flex-1 overflow-y-auto hide-scrollbar">
        <motion.div
          key="profile-container"
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-4"
        >
          <motion.section
            variants={itemVariants}
            className="rounded-3xl border border-white/[0.16] bg-white/[0.12] p-4 shadow-lg shadow-black/20 backdrop-blur-2xl"
          >
            <div className="mb-3 flex items-center gap-3">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl font-sans text-2xl font-black"
                style={{
                  background: `linear-gradient(135deg, ${colors.accent}, ${colors.accent2})`,
                  color: colors.background,
                  boxShadow: colors.glow,
                }}
              >
                {level}
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className="truncate font-mono text-xl font-extrabold"
                  style={{ color: colors.text }}
                  title={address}
                  aria-label={`Embedded identity ${address}`}
                >
                  {truncatePublicKey(address)}
                </p>
                <p
                  className="font-sans text-sm font-semibold"
                  style={{ color: colors.textMuted }}
                >
                  {title}
                </p>
              </div>

              <div className="text-right">
                <p
                  className="font-sans text-3xl font-black leading-none"
                  style={{ color: colors.accent2 }}
                >
                  ★ {starBalance}
                </p>
                <p
                  className="font-sans text-[11px] font-semibold"
                  style={{ color: colors.textMuted }}
                >
                  Stars balance
                </p>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <p
                  className="font-sans text-xs font-semibold"
                  style={{ color: colors.textMuted }}
                >
                  Level {level}
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
              <ProgressBar
                value={isMaxLevel ? 1 : xp - levelStartXp}
                max={isMaxLevel ? 1 : Math.max(nextLevelXp - levelStartXp, 1)}
                color={colors.accent}
                height={8}
                glow
              />
              <p
                className="mt-1 font-sans text-xs"
                style={{ color: colors.textMuted }}
              >
                {isMaxLevel
                  ? `Maximum level · "${title}"`
                  : `${Math.max(0, nextLevelXp - xp).toLocaleString()} XP to Level ${level + 1} · "${nextTitle}"`}
              </p>
            </div>
            {progress.progress && nextMilestoneIndex !== undefined && (
                <button
                  type="button"
                  disabled={progress.claiming !== null}
                  onClick={() => void progress.claimLevelMilestone(nextMilestoneIndex)}
                  className="mt-3 w-full rounded-xl border border-yellow-300/30 bg-yellow-300/10 px-3 py-2 font-sans text-sm font-extrabold text-yellow-200 disabled:opacity-50"
                >
                  {progress.claiming === `milestone:${nextMilestoneIndex}`
                    ? "Claiming..."
                    : `Claim Level ${(nextMilestoneIndex + 1) * 10} reward · +10 Stars`}
                </button>
              )}
            {isMaxLevel && progress.progress?.weeklyStipend && (
              <div className="mt-3 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-sans text-sm font-extrabold text-cyan-100">
                      Weekly Mastery
                    </p>
                    <p className="font-sans text-[11px] font-semibold text-white/55">
                      Earn 2,500 recurring XP for 30 Stars
                    </p>
                  </div>
                  <span className="font-sans text-sm font-black text-cyan-200">
                    {progress.progress.weeklyStipend.starsAwarded
                      ? "Claimed"
                      : `${Math.min(progress.progress.weeklyStipend.recurringXp, 2_500).toLocaleString()} / 2,500 XP`}
                  </span>
                </div>
                <div className="mt-2">
                  <ProgressBar
                    value={progress.progress.weeklyStipend.recurringXp}
                    max={2_500}
                    color="#67e8f9"
                    height={6}
                  />
                </div>
              </div>
            )}
          </motion.section>

          <motion.div
            variants={itemVariants}
            className="flex rounded-full border border-white/[0.12] bg-white/[0.06] p-1 backdrop-blur-xl"
          >
            {TABS.map((tabName) => {
              const active = tab === tabName;
              return (
                <button
                  key={tabName}
                  type="button"
                  onClick={() => setTab(tabName)}
                  className="relative flex-1 rounded-full py-2 text-center font-sans text-[12px] font-bold"
                  style={{
                    color: active ? colors.accent : colors.textMuted,
                  }}
                >
                  <span className="relative z-10">{tabName}</span>
                  {active && (
                    <motion.div
                      layoutId="profile-tab-indicator"
                      className="absolute inset-0 rounded-full border"
                      style={{
                        backgroundColor: `${colors.accent}1F`,
                        borderColor: `${colors.accent}55`,
                      }}
                    />
                  )}
                </button>
              );
            })}
          </motion.div>

          <motion.div variants={itemVariants} className="px-0.5">
            {tab === "Overview" && (
              <OverviewTab
                colors={colors}
                totalGames={playerMeta?.totalRuns ?? 0}
                totalLines={playerStats.totalLines}
                maxCombo={playerStats.maxCombo}
                totalBosses={playerStats.totalBosses}
              />
            )}

            {tab === "Zones" && (
              <ZoneProgressTab
                colors={colors}
                zones={zones}
                totalStars={totalStars}
              />
            )}

            {tab === "Achievements" && <AchievementsTab colors={colors} />}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default ProfilePage;
