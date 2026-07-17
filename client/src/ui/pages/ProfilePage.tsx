import React, { useEffect, useState } from "react";
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
import { useIdentityController } from "@/chain/useIdentityController";
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
  const identity = useIdentityController();

  const xp = playerMeta?.lifetimeXp ?? 0;
  const level = getLevelFromXp(xp);
  const levelStartXp = LEVEL_THRESHOLDS[Math.max(level - 1, 0)] ?? 0;
  const nextLevelXp = LEVEL_THRESHOLDS[level] ?? levelStartXp;
  const isMaxLevel = level >= LEVEL_THRESHOLDS.length;
  const title = getTitleForLevel(level);
  const nextTitle = getTitleForLevel(Math.min(level + 1, 100));

  const [tab, setTab] = useState<(typeof TABS)[number]>("Stats");
  const [username, setUsername] = useState("");
  const navigate = useNavigationStore((state) => state.navigate);

  useEffect(() => {
    setUsername(identity.identity?.displayName ?? "");
  }, [identity.identity?.displayName]);

  const renameReadyAt =
    identity.identity && identity.identity.renameCount > 0
      ? identity.identity.lastRenamedAt + 30 * 86_400
      : 0;
  const renameCoolingDown =
    !identity.identity?.moderated &&
    renameReadyAt > Math.floor(Date.now() / 1_000);

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
                  {identity.identity && !identity.identity.moderated
                    ? identity.identity.displayName
                    : title}
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
                    {address
                      ? `${identity.identity && !identity.identity.moderated ? `${title} · ` : ""}${truncatePublicKey(address)}`
                      : "Not connected"}
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

          <motion.section
            variants={itemVariants}
            className="rounded-3xl border border-white/[0.12] bg-white/[0.07] p-4 backdrop-blur-xl"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void identity.save(username).catch(() => undefined);
              }}
              className="flex flex-col gap-3"
            >
              <div>
                <p className="font-sans text-sm font-extrabold text-white">
                  Public username
                </p>
                <p className="mt-1 font-sans text-[11px] font-semibold text-white/50">
                  Displayed on your profile and the Daily and Weekly
                  leaderboards.
                </p>
              </div>
              {identity.identity?.moderated && (
                <p className="rounded-xl border border-red-300/20 bg-red-300/10 px-3 py-2 font-sans text-xs font-semibold text-red-200">
                  This username is hidden by moderation. Choose a free
                  replacement.
                </p>
              )}
              <div className="flex gap-2">
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  minLength={3}
                  maxLength={16}
                  pattern="[A-Za-z][A-Za-z0-9_]{2,15}"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="Public username"
                  placeholder="Wave_Rider"
                  className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/25 px-3 py-2 font-sans text-sm font-bold text-white outline-none placeholder:text-white/25 focus:border-cyan-300/50"
                />
                <button
                  type="submit"
                  disabled={
                    identity.loading ||
                    identity.saving ||
                    renameCoolingDown ||
                    username === identity.identity?.displayName
                  }
                  className="rounded-xl border border-cyan-300/30 bg-cyan-300/15 px-4 py-2 font-sans text-xs font-black text-cyan-100 disabled:opacity-40"
                >
                  {identity.saving
                    ? "Saving…"
                    : identity.identity
                      ? "Rename"
                      : "Register"}
                </button>
              </div>
              <p className="font-sans text-[10px] font-semibold text-white/40">
                {!identity.identity
                  ? "Registration has no Star fee. Your wallet pays refundable on-chain account rent."
                  : identity.identity.moderated
                    ? "Moderated replacements have no Star fee or cooldown."
                    : identity.identity.renameCount === 0
                      ? "Your first rename has no Star fee."
                      : renameCoolingDown
                        ? `Next 100★ rename available ${new Date(renameReadyAt * 1_000).toLocaleDateString()}.`
                        : "This rename costs 100★ and starts a new 30-day cooldown."}
              </p>
              {identity.error && (
                <p
                  role="alert"
                  className="font-sans text-xs font-semibold text-red-300"
                >
                  {identity.error}
                </p>
              )}
            </form>
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
