import React, { useState } from "react";
import { Settings } from "lucide-react";
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
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useProgress } from "@/contexts/progress";
import { useNavigationStore } from "@/stores/navigationStore";
import LevelRing from "@/ui/components/shared/LevelRing";
import StatsTab from "@/ui/components/profile/StatsTab";
import ZoneProgressTab from "@/ui/components/profile/ZoneProgressTab";
import PageHeader from "@/ui/components/shared/PageHeader";
import ProgressBar from "@/ui/components/shared/ProgressBar";
import SegmentedTabs from "@/ui/components/shared/SegmentedTabs";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { truncatePublicKey } from "@/utils/solanaDisplay";

const TABS = ["Stats", "Zones"] as const;

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
  const player = useConnectedPlayer();
  const address = player.publicKey?.toBase58() ?? "";
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

  const [tab, setTab] = useState<(typeof TABS)[number]>("Stats");
  const navigate = useNavigationStore((state) => state.navigate);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-12">
      <PageHeader
        title="Profile"
        rightSlot={
          <button
            type="button"
            aria-label="Settings"
            onClick={() => navigate("settings")}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] shadow-lg backdrop-blur-md transition-all hover:bg-white/[0.08] active:scale-95"
          >
            <Settings size={18} className="text-white/80" />
          </button>
        }
      />

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
              <LevelRing
                level={level}
                progress={
                  isMaxLevel
                    ? 1
                    : (xp - levelStartXp) /
                      Math.max(nextLevelXp - levelStartXp, 1)
                }
                colors={colors}
                size={60}
              />

              <div className="min-w-0 flex-1">
                <p
                  className="truncate font-sans text-lg font-extrabold"
                  style={{ color: colors.text }}
                >
                  {title}
                </p>
                <button
                  type="button"
                  onClick={() => navigate("settings")}
                  title={address || undefined}
                  aria-label={
                    address
                      ? `Connected wallet ${address}`
                      : "Wallet disconnected"
                  }
                  className="mt-1 inline-flex max-w-full items-center rounded-full border border-white/[0.12] bg-white/[0.06] px-2 py-0.5"
                >
                  <span className="truncate font-mono text-[11px] font-semibold text-white/60">
                    {address ? truncatePublicKey(address) : "Not connected"}
                  </span>
                </button>
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
          </motion.section>

          <motion.div variants={itemVariants}>
            <SegmentedTabs
              tabs={TABS}
              active={tab}
              onChange={setTab}
              layoutId="profile-tab-indicator"
              accent={colors.accent}
            />
          </motion.div>

          <motion.div variants={itemVariants} className="px-0.5">
            {tab === "Stats" && (
              <StatsTab
                colors={colors}
                totalGames={playerMeta?.totalRuns ?? 0}
                totalLines={playerStats.totalLines}
                maxCombo={playerStats.maxCombo}
                totalBosses={playerStats.totalBosses}
                dailiesPlayed={Number(
                  progress.progress?.lifetime.dailyChallenges ?? 0n,
                )}
                perfectLevels={Number(
                  progress.progress?.lifetime.perfectLevels ?? 0n,
                )}
                starsEarned={Number(
                  progress.progress?.lifetimeStarsEarned ?? 0n,
                )}
                starsSpent={Number(progress.progress?.lifetimeStarsSpent ?? 0n)}
              />
            )}

            {tab === "Zones" && (
              <ZoneProgressTab
                colors={colors}
                zones={zones}
                totalStars={totalStars}
              />
            )}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default ProfilePage;
