import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion, type Variants } from "motion/react";

import {
  ZONE_NAMES,
  getLevelFromXp,
  getTitleForLevel,
  type ZoneProgressData,
} from "@/config/profileData";
import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { useMusicPlayer } from "@/contexts/hooks";
import useAccount from "@/hooks/useAccount";
import { useActiveStoryAttempt } from "@/hooks/useActiveStoryAttempt";
import { useCurrentChallenge } from "@/hooks/useCurrentChallenge";
import { useDailyLeaderboard } from "@/hooks/useDailyLeaderboard";
import { usePlayerEntry } from "@/hooks/usePlayerEntry";
import { usePlayerMeta } from "@/hooks/usePlayerMeta";
import { useZoneProgress } from "@/hooks/useZoneProgress";
import { useZStarBalance } from "@/hooks/useZStarBalance";
import { useDevnetRuntimeStatus } from "@/chain/useDevnetRuntimeStatus";
import { useNavigationStore } from "@/stores/navigationStore";
import UnlockModal from "@/ui/components/profile/UnlockModal";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { truncatePublicKey } from "@/utils/solanaDisplay";

const useDailyCountdown = (endTime: number | undefined) => {
  const [remaining, setRemaining] = useState(() =>
    endTime ? Math.max(0, endTime - Math.floor(Date.now() / 1000)) : 0,
  );

  useEffect(() => {
    if (!endTime) return;
    const tick = () =>
      setRemaining(Math.max(0, endTime - Math.floor(Date.now() / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endTime]);

  if (!endTime || remaining <= 0) return null;
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const containerVariants: Variants = {
  hidden: { opacity: 1 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 1, y: 0 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 24 },
  },
};

const HomePage: React.FC = () => {
  const { address } = useAccount();
  const { themeTemplate } = useTheme();
  const { setMusicPlaylist } = useMusicPlayer();
  const runtime = useDevnetRuntimeStatus();
  const navigate = useNavigationStore((state) => state.navigate);
  const mapZoneId = useNavigationStore((state) => state.mapZoneId);
  const setMapZoneId = useNavigationStore((state) => state.setMapZoneId);
  const setIsDailyMap = useNavigationStore((state) => state.setIsDailyMap);
  const [isDailySelected, setIsDailySelected] = useState(false);
  const [unlockZone, setUnlockZone] = useState<ZoneProgressData | null>(null);

  const { playerMeta } = usePlayerMeta(address);
  const playerLevel = getLevelFromXp(playerMeta?.lifetimeXp ?? 0);
  const playerTitle = getTitleForLevel(playerLevel);
  const { balance: zStarBalance } = useZStarBalance(address);
  const { zones: rawZones, isLoading: zonesLoading } = useZoneProgress(
    address,
    zStarBalance,
  );
  const zones = useMemo(
    () =>
      [...rawZones].sort((left, right) => {
        if (left.unlocked !== right.unlocked) return left.unlocked ? -1 : 1;
        return left.zoneId - right.zoneId;
      }),
    [rawZones],
  );
  const activeZone = useMemo(() => {
    const index = zones.findIndex((zone) => zone.zoneId === mapZoneId);
    return index >= 0 ? index : 0;
  }, [zones, mapZoneId]);
  const setActiveZone = useCallback(
    (index: number) => {
      const zone = zones[index];
      if (zone) setMapZoneId(zone.zoneId);
      setIsDailySelected(false);
    },
    [zones, setMapZoneId],
  );

  const { challenge, isLoading: challengeLoading } = useCurrentChallenge();
  const { isRegistered: hasPlayedDaily } = usePlayerEntry(
    challenge?.challenge_id,
    address,
  );
  const { entries: dailyEntries } = useDailyLeaderboard(
    challenge?.challenge_id,
  );
  const dailyCountdown = useDailyCountdown(challenge?.end_time);
  // Daily's map is read directly from the on-chain challenge snapshot.
  const dailyZoneId = challenge?.zone_id ?? 1;
  const dailyZoneName = ZONE_NAMES[dailyZoneId] ?? null;
  const dailyColors = getThemeColors(getThemeId(dailyZoneId));
  const dailyMyRank = useMemo(() => {
    const found = dailyEntries.find(
      (entry) => entry.player === address,
    );
    return found?.rank ?? null;
  }, [address, dailyEntries]);

  useEffect(() => {
    setMusicPlaylist(["main", "level"]);
  }, [setMusicPlaylist]);

  const activeStoryRun = useActiveStoryAttempt();
  const activeStoryAttemptId = activeStoryRun?.gameId ?? null;
  const zone = zones[activeZone] ?? zones[0];
  const colors = getThemeColors(themeTemplate);

  // Arrow pagination through the story zone strip. Each click scrolls the
  // container by its own visible width; past an edge, pagination wraps.
  const zoneScrollRef = useRef<HTMLDivElement | null>(null);

  const pageZones = useCallback((direction: 1 | -1) => {
    const element = zoneScrollRef.current;
    if (!element) return;
    const { scrollLeft, clientWidth, scrollWidth } = element;
    const maxScroll = scrollWidth - clientWidth;
    let next: number;
    if (direction === 1) {
      next =
        scrollLeft >= maxScroll - 2
          ? 0
          : Math.min(scrollLeft + clientWidth, maxScroll);
    } else {
      next =
        scrollLeft <= 2 ? maxScroll : Math.max(scrollLeft - clientWidth, 0);
    }
    element.scrollTo({ left: next, behavior: "smooth" });
  }, []);

  const hasActiveStoryRun = activeStoryAttemptId !== null;
  const selectedZonePlayable = !!zone?.unlocked;

  const handlePrimaryAction = useCallback(() => {
    if (!zone) return;
    setIsDailyMap(false);

    if (activeStoryAttemptId !== null && activeStoryRun) {
      setMapZoneId(activeStoryRun.zoneId);
      navigate("play", activeStoryAttemptId);
      return;
    }

    setMapZoneId(zone.zoneId);
    navigate("map");
  }, [
    activeStoryAttemptId,
    activeStoryRun,
    navigate,
    setIsDailyMap,
    setMapZoneId,
    zone,
  ]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-10">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(5,10,18,0.12)_0%,rgba(5,10,18,0.05)_45%,rgba(5,10,18,0.56)_100%)]" />

      <div className="relative z-10 mb-1 text-center">
        <motion.img
          animate={{ y: [0, -3, 0] }}
          transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
          src={getThemeImages(themeTemplate).logo}
          alt="zKube"
          className="mx-auto h-32 drop-shadow-[0_0_28px_rgba(255,255,255,0.42)] md:h-44"
          draggable={false}
        />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-4">
        <motion.div
          key="home-container"
          variants={containerVariants}
          initial={false}
          animate="show"
          className="flex-1 space-y-3 overflow-y-auto pb-3"
        >
          <motion.div
            variants={itemVariants}
            className="flex items-center justify-between rounded-2xl border border-white/[0.16] bg-white/[0.08] px-3 py-1.5 backdrop-blur-xl"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-sans text-sm font-black"
                style={{
                  background: `linear-gradient(145deg, ${colors.accent}, ${colors.accent2})`,
                  color: "#0a1628",
                }}
              >
                {playerLevel}
              </div>
              <div className="min-w-0">
                <p
                  className="truncate font-sans text-[15px] font-bold text-white"
                  title={address}
                >
                  zKube Vault · {truncatePublicKey(address)}
                </p>
                <p className="font-sans text-[11px] font-semibold text-white/75">
                  {playerTitle}
                </p>
              </div>
            </div>
            <span
              className="rounded-full border px-2.5 py-1 font-sans text-[10px] font-bold uppercase tracking-[0.1em]"
              style={{
                color: colors.accent,
                borderColor: `${colors.accent}66`,
                backgroundColor: `${colors.accent}22`,
              }}
            >
              Connected
            </span>
          </motion.div>

          {runtime.phase !== "ready" && (
            <motion.div
              variants={itemVariants}
              className="rounded-full border border-amber-400/30 bg-amber-500/10 px-4 py-1.5 text-center font-sans text-[11px] font-bold text-amber-200"
            >
              {runtime.message}
            </motion.div>
          )}

          <motion.div
            variants={itemVariants}
            className="my-1 flex items-center gap-2"
          >
            <button
              type="button"
              aria-label="Previous zones"
              onClick={() => pageZones(-1)}
              className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white md:flex"
            >
              <ChevronLeft size={14} />
            </button>
            <div className="flex-1 border-t border-white/[0.06]" />
            <span className="font-sans text-[9px] font-bold uppercase tracking-[0.2em] text-white/30">
              Story
            </span>
            <div className="flex-1 border-t border-white/[0.06]" />
            <button
              type="button"
              aria-label="Next zones"
              onClick={() => pageZones(1)}
              className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white md:flex"
            >
              <ChevronRight size={14} />
            </button>
          </motion.div>

          <motion.div variants={itemVariants} className="space-y-2">
            {zonesLoading || zones.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.14] bg-white/[0.12] p-4 text-center font-sans text-sm font-semibold text-white/80 backdrop-blur-xl">
                Loading zones...
              </div>
            ) : (
              <div
                ref={zoneScrollRef}
                className="hide-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
              >
                {zones.map((candidate, index) => {
                  const isSelectable = candidate.unlocked;
                  const isSelected =
                    !isDailySelected && index === activeZone && isSelectable;
                  const statusText =
                    !candidate.unlocked && !candidate.isFree
                      ? (candidate.starCost ?? 0) > 0
                        ? `${candidate.starCost} ★ to unlock`
                        : "Locked"
                      : `${candidate.stars}/${candidate.maxStars} ★`;

                  return (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      key={candidate.settingsId}
                      type="button"
                      onClick={() => {
                        if (isSelectable) {
                          setActiveZone(index);
                        } else if (!candidate.isFree) {
                          setUnlockZone(candidate);
                        }
                      }}
                      className="relative flex h-[clamp(8rem,22vw,11rem)] w-[clamp(6.5rem,17vw,9rem)] shrink-0 snap-center flex-col items-start justify-end overflow-hidden rounded-2xl p-2 text-left"
                      style={{
                        border: isSelected
                          ? `2px solid ${colors.accent}`
                          : "1px solid rgba(255,255,255,0.18)",
                        opacity: isSelectable ? 1 : 0.58,
                        boxShadow: isSelected
                          ? `0 0 16px ${colors.accent}66, 0 0 4px ${colors.accent}44`
                          : "0 10px 18px -8px rgba(0,0,0,0.6)",
                      }}
                    >
                      <img
                        src={
                          getThemeImages(
                            getThemeId(candidate.themeId ?? candidate.zoneId),
                          ).themeIcon
                        }
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                      <div className="relative z-10 w-full">
                        <span
                          className="mb-1 inline-flex rounded-full px-2 py-0.5 font-sans text-[9px] font-extrabold uppercase tracking-[0.12em]"
                          style={{
                            color: "#0a1628",
                            backgroundColor: colors.accent,
                          }}
                        >
                          Story
                        </span>
                        <p className="font-sans text-base font-extrabold leading-tight text-white drop-shadow-md">
                          {candidate.name}
                        </p>
                        <div className="mt-1 flex items-center justify-between">
                          <p
                            className="font-sans text-[11px] font-bold"
                            style={{ color: "#FACC15" }}
                          >
                            {statusText}
                          </p>
                          {!isSelectable && <span className="text-sm">🔒</span>}
                        </div>
                        {candidate.unlocked && candidate.maxStars > 0 && (
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${(candidate.stars / candidate.maxStars) * 100}%`,
                                backgroundColor: colors.accent,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="my-1 flex items-center gap-2"
          >
            <div className="flex-1 border-t border-white/[0.06]" />
            <span className="font-sans text-[9px] font-bold uppercase tracking-[0.2em] text-white/30">
              Daily Arena
            </span>
            <div className="flex-1 border-t border-white/[0.06]" />
          </motion.div>

          <motion.div variants={itemVariants}>
            <button
              type="button"
              onClick={() => setIsDailySelected((selected) => !selected)}
              className="relative w-full overflow-hidden rounded-2xl text-left transition-all"
              style={{
                border: isDailySelected
                  ? `2px solid ${dailyColors.accent}`
                  : "1px solid rgba(255,255,255,0.16)",
                boxShadow: isDailySelected
                  ? `0 0 16px ${dailyColors.accent}66, 0 0 4px ${dailyColors.accent}44`
                  : "none",
              }}
            >
              <img
                src={getThemeImages(getThemeId(dailyZoneId)).background}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/70 to-black/50" />
              <div className="relative z-10 px-4 py-3">
                <p
                  className="font-sans text-[10px] font-bold uppercase tracking-[0.14em]"
                  style={{ color: dailyColors.accent }}
                >
                  Daily Challenge
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <div>
                    <p className="font-sans text-sm font-bold text-white">
                      {dailyZoneName ?? "Daily Challenge"}
                    </p>
                    <p className="font-sans text-[11px] text-white/60">
                      {challengeLoading
                        ? "Loading..."
                        : !challenge
                          ? "Not published yet — check back soon!"
                          : hasPlayedDaily && dailyMyRank
                            ? `#${dailyMyRank} · Weekly points`
                            : `${challenge.total_attempts.toString()} attempt${challenge.total_attempts === 1n ? "" : "s"}`}
                    </p>
                  </div>
                  {dailyCountdown ? (
                    <span
                      className="rounded-full px-3 py-1.5 font-sans text-xs font-bold tabular-nums text-white"
                      style={{ background: dailyColors.accent }}
                    >
                      {dailyCountdown}
                    </span>
                  ) : challenge ? (
                    <span className="rounded-full bg-red-500 px-3 py-1.5 font-sans text-xs font-bold text-white">
                      ENDED
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          </motion.div>
        </motion.div>
      </div>

      <div className="relative z-20 mt-auto flex flex-col gap-2.5 px-4 pb-3">
        {isDailySelected ? (
          <ArcadeButton
            onClick={() => {
              // Daily runs have their own entry screen and never route through Map.
              setIsDailyMap(false);
              navigate("daily");
            }}
            accentOverride={dailyColors.accent}
          >
            Go to Daily
          </ArcadeButton>
        ) : (
          <ArcadeButton
            disabled={!selectedZonePlayable && !hasActiveStoryRun}
            onClick={handlePrimaryAction}
            accentOverride={
              hasActiveStoryRun && activeStoryRun
                ? getThemeColors(getThemeId(activeStoryRun.zoneId)).accent
                : zone
                  ? getThemeColors(getThemeId(zone.themeId ?? zone.zoneId))
                      .accent
                  : undefined
            }
          >
            {activeStoryRun?.settled
              ? "Finish Story"
              : hasActiveStoryRun
                ? "Resume Story"
                : "Play Story"}
          </ArcadeButton>
        )}
      </div>

      {unlockZone && (
        <UnlockModal
          colors={colors}
          zone={unlockZone}
          onClose={() => setUnlockZone(null)}
        />
      )}
    </div>
  );
};

export default HomePage;
