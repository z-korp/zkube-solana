import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, type Variants } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { useMusicPlayer } from "@/contexts/hooks";
import {
  getThemeColors,
  getThemeId,
  getThemeImages,
  type ThemeId,
} from "@/config/themes";
import {
  ZONE_NAMES,
  getLevelFromXp,
  getTitleForLevel,
} from "@/config/profileData";
import { useDevnetRuntimeStatus } from "@/solana/reboot/useDevnetRuntimeStatus";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";
import { useRebootCampaign } from "@/solana/reboot/useRebootCampaign";
import { useRebootDaily } from "@/solana/reboot/useRebootDaily";
import { useRebootProgress } from "@/solana/reboot/useRebootProgress";
import { loadRunSession } from "@/solana/reboot/runSessionStore";
import { useNavigationStore } from "@/stores/navigationStore";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";

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
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

interface ZoneCardData {
  zoneId: number;
  name: string;
  unlocked: boolean;
  isFree: boolean;
  starCost: number;
  stars: number;
  maxStars: number;
}

export default function RebootHomePage() {
  const identity = useEmbeddedIdentity();
  const { themeTemplate } = useTheme();
  const themeId = themeTemplate as ThemeId;
  const { setMusicPlaylist } = useMusicPlayer();
  const runtime = useDevnetRuntimeStatus();
  const navigate = useNavigationStore((s) => s.navigate);
  const mapZoneId = useNavigationStore((s) => s.mapZoneId);
  const setMapZoneId = useNavigationStore((s) => s.setMapZoneId);
  const setDaily = useNavigationStore((s) => s.setIsDailyMap);
  const [isDailySelected, setIsDailySelected] = useState(false);

  const campaign = useRebootCampaign();
  const progress = useRebootProgress();
  const daily = useRebootDaily();

  const playerLevel = getLevelFromXp(
    Number(progress.progress?.achievementXp ?? 0n),
  );
  const playerTitle = getTitleForLevel(playerLevel);
  const shortAddress = useMemo(() => {
    const value = identity.publicKey.toBase58();
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
  }, [identity.publicKey]);
  const persistedRun = useMemo(
    () => loadRunSession(identity.publicKey),
    [identity.publicKey],
  );

  const zones = useMemo<ZoneCardData[]>(() => {
    const source =
      campaign.campaign?.maps.map((map) => ({
        zoneId: map.mapId,
        name: ZONE_NAMES[map.mapId] ?? `Zone ${map.mapId}`,
        unlocked: map.unlocked,
        isFree: map.mapId === 1,
        starCost: Number(map.starCost),
        stars: map.levelStars.reduce((sum, value) => sum + value, 0),
        maxStars: 30,
      })) ??
      Array.from({ length: 10 }, (_, index) => ({
        zoneId: index + 1,
        name: ZONE_NAMES[index + 1] ?? `Zone ${index + 1}`,
        unlocked: index === 0,
        isFree: index === 0,
        starCost: 0,
        stars: 0,
        maxStars: 30,
      }));
    return [...source].sort((a, b) => {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      return a.zoneId - b.zoneId; // stable tiebreaker
    });
  }, [campaign.campaign]);

  const activeZone = useMemo(() => {
    const idx = zones.findIndex((z) => z.zoneId === mapZoneId);
    return idx >= 0 ? idx : 0;
  }, [zones, mapZoneId]);
  const setActiveZone = useCallback(
    (idx: number) => {
      const z = zones[idx];
      if (z) setMapZoneId(z.zoneId);
      setIsDailySelected(false);
    },
    [zones, setMapZoneId],
  );

  const challenge = daily.daily;
  const challengeLoading = daily.loading;
  const dailyZoneId = challenge?.mapId ?? 1;
  const dailyZoneName = ZONE_NAMES[dailyZoneId] ?? null;
  const dailyColors = getThemeColors(getThemeId(dailyZoneId));
  const dailyCountdown = useDailyCountdown(challenge?.entriesCloseAt);
  const dailyMyRank = useMemo(() => {
    if (!challenge?.leaderboard.length) return null;
    const index = challenge.leaderboard.findIndex((entry) =>
      entry.player.equals(identity.publicKey),
    );
    return index < 0 ? null : index + 1;
  }, [challenge?.leaderboard, identity.publicKey]);
  const dailyPlayers = Number(challenge?.runsStarted ?? 0n);

  useEffect(() => {
    setMusicPlaylist(["main", "level"]);
  }, [setMusicPlaylist]);

  const zone = zones[activeZone] ?? zones[0];
  const colors = getThemeColors(themeId);
  const images = getThemeImages(themeId);

  // Arrow pagination through the story zone strip. Each click scrolls the
  // container by its own visible width; past the end it wraps back to 0.
  const zoneScrollRef = useRef<HTMLDivElement | null>(null);

  const pageZones = useCallback((direction: 1 | -1) => {
    const el = zoneScrollRef.current;
    if (!el) return;
    const { scrollLeft, clientWidth, scrollWidth } = el;
    const maxScroll = scrollWidth - clientWidth;
    const page = clientWidth; // one viewport-worth of cards
    let next: number;
    if (direction === 1) {
      next =
        scrollLeft >= maxScroll - 2 ? 0 : Math.min(scrollLeft + page, maxScroll);
    } else {
      next = scrollLeft <= 2 ? maxScroll : Math.max(scrollLeft - page, 0);
    }
    el.scrollTo({ left: next, behavior: "smooth" });
  }, []);

  const hasActiveRun = persistedRun !== null;
  const selectedZonePlayable = !!zone?.unlocked;

  const handlePrimaryAction = useCallback(() => {
    if (!zone) return;
    setDaily(false);
    if (hasActiveRun) {
      navigate("solana");
    } else {
      setMapZoneId(zone.zoneId);
      navigate("map");
    }
  }, [hasActiveRun, navigate, setDaily, setMapZoneId, zone]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-10">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{ backgroundColor: colors.background }}
      >
        <img
          src={images.background}
          alt=""
          className="h-full w-full object-cover opacity-70"
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(5,10,18,0.12)_0%,rgba(5,10,18,0.05)_45%,rgba(5,10,18,0.56)_100%)]" />

      <div className="relative z-10 mb-1 text-center">
        <motion.img
          animate={{ y: [0, -3, 0] }}
          transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
          src={images.logo}
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
                <p className="truncate font-sans text-[15px] font-bold text-white">
                  zKube Vault · {shortAddress}
                </p>
                <p className="font-sans text-[11px] font-semibold text-white/75">
                  {playerTitle}
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate("profile")}
              className="rounded-full border px-2.5 py-1 font-sans text-[10px] font-bold uppercase tracking-[0.1em]"
              style={{
                color: colors.accent,
                borderColor: `${colors.accent}66`,
                backgroundColor: `${colors.accent}22`,
              }}
            >
              Connected
            </button>
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
            {campaign.loading && zones.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.14] bg-white/[0.12] p-4 text-center font-sans text-sm font-semibold text-white/80 backdrop-blur-xl">
                Loading zones...
              </div>
            ) : (
              <div
                ref={zoneScrollRef}
                className="hide-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
              >
                {zones.map((z, idx) => {
                  const isSelectable = z.unlocked;
                  const isSelected =
                    !isDailySelected && idx === activeZone && isSelectable;

                  const statusText =
                    !z.unlocked && !z.isFree
                      ? z.starCost > 0
                        ? `${z.starCost} ★ to unlock`
                        : "Locked"
                      : `${z.stars}/${z.maxStars} ★`;

                  return (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      key={z.zoneId}
                      type="button"
                      onClick={() => {
                        if (isSelectable) {
                          setActiveZone(idx);
                        } else {
                          // Unlock lives on the map page in the Solana port.
                          setMapZoneId(z.zoneId);
                          setDaily(false);
                          navigate("map");
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
                        src={getThemeImages(getThemeId(z.zoneId)).themeIcon}
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
                          {z.name}
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
                        {z.unlocked && z.maxStars > 0 && (
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${(z.stars / z.maxStars) * 100}%`,
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
              Tournaments
            </span>
            <div className="flex-1 border-t border-white/[0.06]" />
          </motion.div>

          <motion.div variants={itemVariants}>
            <button
              type="button"
              onClick={() => setIsDailySelected((prev) => !prev)}
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
                          : dailyMyRank
                            ? `#${dailyMyRank}/${challenge.leaderboard.length} · USDC prizes`
                            : `${dailyPlayers} player${dailyPlayers !== 1 ? "s" : ""}`}
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
              setDaily(true);
              navigate("daily");
            }}
            accentOverride={dailyColors.accent}
          >
            Go to Daily
          </ArcadeButton>
        ) : (
          <ArcadeButton
            disabled={!selectedZonePlayable && !hasActiveRun}
            onClick={handlePrimaryAction}
            accentOverride={
              zone
                ? getThemeColors(getThemeId(zone.zoneId)).accent
                : undefined
            }
          >
            {hasActiveRun ? "Resume Story" : "Play Story"}
          </ArcadeButton>
        )}
      </div>
    </div>
  );
}
