import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, type Variants } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useWallet } from "@solana/wallet-adapter-react";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { useMusicPlayer } from "@/contexts/hooks";
import { getThemeColors, getThemeId, getThemeImages, type ThemeId } from "@/config/themes";
import { useCurrentChallenge } from "@/hooks/useCurrentChallenge";
import { usePlayerEntry } from "@/hooks/usePlayerEntry";
import { useDailyLeaderboard } from "@/hooks/useDailyLeaderboard";
import { ZONE_NAMES } from "@/config/profileData";
import { ZONE_GUARDIANS, getGuardianPortrait } from "@/config/bossCharacters";
import { useNavigationStore } from "@/stores/navigationStore";
import { computeDailyZoneId, getTodayChallengeId } from "@/solana/dailyConstants";
import { useTournaments } from "@/hooks/useTournaments";
import type { TournamentWithStatus } from "@/hooks/useTournaments";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";

const useDailyCountdown = (endTime: number | undefined) => {
  const [remaining, setRemaining] = useState(() =>
    endTime ? Math.max(0, endTime - Math.floor(Date.now() / 1000)) : 0,
  );

  useEffect(() => {
    if (!endTime) return;
    const tick = () => setRemaining(Math.max(0, endTime - Math.floor(Date.now() / 1000)));
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
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
};

// Block cell size — total grid is 8 cells wide
const CELLS = 8;

// Generate a random line that sums to 8 cells
function generateLine(): number[] {
  const blocks: number[] = [];
  let remaining = CELLS;
  while (remaining > 0) {
    const maxSize = Math.min(4, remaining);
    const size = Math.floor(Math.random() * maxSize) + 1;
    blocks.push(size);
    remaining -= size;
  }
  return blocks;
}


const CtaGuardian: React.FC = () => {
  const guardianIds = Object.keys(ZONE_GUARDIANS).map(Number);
  const randomIdx = Math.floor(Date.now() / 60000) % guardianIds.length;
  const gZoneId = guardianIds[randomIdx];
  const g = ZONE_GUARDIANS[gZoneId];
  const gThemeId = `theme-${gZoneId}` as ThemeId;
  const gImages = getThemeImages(gThemeId);
  const gColors = getThemeColors(gThemeId);

  const blockSrcs: Record<number, string> = {
    1: gImages.block1, 2: gImages.block2, 3: gImages.block3, 4: gImages.block4,
  };

  // Generate lines of blocks — each line sums to 8 cells
  const fallingLines = useMemo(() => {
    const slotCount = 6;   // rhythm slots per cycle
    const lineCount = 5;   // skip the t=0 slot so no block flashes at its start position on first paint
    const lineSpacing = 2.2; // spaced so fastest block clears before slowest of next arrives
    const totalCycle = slotCount * lineSpacing;
    return Array.from({ length: lineCount }).map((_, lineIdx) => {
      const sizes = generateLine();
      let cellOffset = 0;
      // Speed tiers — shuffled per line, bounded range so lines don't collide
      const speedPool = [0.85, 0.95, 1.0, 1.1, 1.2, 1.3, 1.15, 1.05];
      const blocks = sizes.map((size, bi) => {
        const x = cellOffset;
        cellOffset += size;
        return { size, cellX: x, speed: speedPool[(bi + lineIdx * 3) % speedPool.length] };
      });
      return { blocks, delay: (lineIdx + 1) * lineSpacing, totalCycle };
    });
  }, [gZoneId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div
      variants={itemVariants}
      className="relative mx-auto mt-2 flex max-w-[360px] flex-col items-center gap-4"
    >
      {/* Guardian portrait in a circle */}
      <div
        className="relative h-36 w-36 overflow-hidden rounded-full guardian-pulse"
        style={{
          border: `3px solid ${gColors.accent}44`,
          boxShadow: `0 0 30px ${gColors.accent}22`,
        }}
      >
        <img
          src={getGuardianPortrait(gZoneId)}
          alt={g.name}
          className="h-full w-full object-cover"
          draggable={false}
        />
      </div>

      {/* Catchphrase */}
      <p className="text-center font-sans text-[14px] italic text-white/50">
        "{g.greeting}"
      </p>

      {/* Falling lines — full rows that break apart with gravity */}
      <div
        className="relative w-full flex-1 min-h-[140px] overflow-hidden"
        style={{
          maskImage: "linear-gradient(to bottom, black 0%, black 55%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 55%, transparent 100%)",
        }}
      >
        {fallingLines.map((line, li) =>
          line.blocks.map((b, bi) => {
            const cellPct = 100 / CELLS;
            return (
              <img
                key={`${li}-${bi}`}
                src={blockSrcs[b.size]}
                alt=""
                className="absolute top-0"
                style={{
                  left: `${b.cellX * cellPct}%`,
                  width: `${b.size * cellPct}%`,
                  aspectRatio: `${b.size} / 1`,
                  // `backwards` fill-mode keeps the block in its 0% keyframe
                  // state (translateY(-20px); opacity 0) during the delay,
                  // otherwise it flashes at its static top position on first paint.
                  animation: `fallingBlock ${line.totalCycle / b.speed}s ease-in ${line.delay}s infinite backwards`,
                }}
                draggable={false}
              />
            );
          }),
        )}
      </div>
    </motion.div>
  );
};

// ── TournamentCard ─────────────────────────────────────────────────────────────
const TournamentCard: React.FC<{
  tournament: TournamentWithStatus;
  onPress: () => void;
}> = ({ tournament, onPress }) => {
  const zoneId = tournament.zoneId;
  const themeId = getThemeId(zoneId);
  const tColors = getThemeColors(themeId);
  const tImages = getThemeImages(themeId);
  const zoneName = ZONE_NAMES[zoneId] ?? `Zone ${zoneId}`;

  // Countdown live pour les tournois actifs
  const [sec, setSec] = useState(() =>
    Math.max(0, tournament.endTime - Math.floor(Date.now() / 1000)),
  );
  useEffect(() => {
    if (tournament.status !== "active") return;
    const id = window.setInterval(
      () => setSec(Math.max(0, tournament.endTime - Math.floor(Date.now() / 1000))),
      1000,
    );
    return () => window.clearInterval(id);
  }, [tournament.endTime, tournament.status]);

  const timeLabel = (() => {
    if (tournament.status === "active") {
      const h = Math.floor(sec / 3600).toString().padStart(2, "0");
      const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
      const s = (sec % 60).toString().padStart(2, "0");
      return `${h}:${m}:${s}`;
    }
    if (tournament.status === "upcoming") return "Soon";
    if (tournament.status === "settled") return "Settled";
    return "Ended";
  })();

  const badgeColor =
    tournament.status === "active" ? tColors.accent :
    tournament.status === "upcoming" ? "#3b82f6" :
    tournament.status === "settled" ? "#9333ea" : "#ef4444";

  const prizePoolSol = (Number(tournament.prizePool) / 1_000_000_000).toFixed(3);

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      type="button"
      onClick={onPress}
      className="relative w-full overflow-hidden rounded-2xl text-left transition-all"
      style={{
        border: `1px solid ${tColors.accent}30`,
        boxShadow: tournament.status === "active" ? `0 0 12px ${tColors.accent}22` : "none",
      }}
    >
      <img src={tImages.background} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/75 to-black/55" />
      <div className="relative z-10 px-4 py-3">
        <p className="font-sans text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: tColors.accent }}>
          Tournament #{tournament.tournamentId}
        </p>
        <div className="mt-1 flex items-center justify-between">
          <div>
            <p className="font-sans text-sm font-bold text-white">{zoneName}</p>
            <p className="font-sans text-[11px] text-white/55">
              {tournament.totalPlayers} player{tournament.totalPlayers !== 1 ? "s" : ""}
              {tournament.prizePool > 0n ? ` · ${prizePoolSol} SOL` : ""}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full px-3 py-1.5 font-sans text-xs font-bold tabular-nums text-white"
            style={{ background: badgeColor }}
          >
            {timeLabel}
          </span>
        </div>
      </div>
    </motion.button>
  );
};

// Toutes les zones disponibles (statique — pas de progression Starknet)
const ALL_ZONES = Object.entries(ZONE_NAMES)
  .map(([id, name]) => ({ zoneId: Number(id), name }))
  .sort((a, b) => a.zoneId - b.zoneId);

const HomePage: React.FC = () => {
  // ── Phantom wallet ───────────────────────────────────────────────────────────
  const { connected, publicKey } = useWallet();

  // ── Navigation ───────────────────────────────────────────────────────────────
  const { themeTemplate } = useTheme();
  const { setMusicPlaylist } = useMusicPlayer();
  const navigate = useNavigationStore((s) => s.navigate);
  const mapZoneId = useNavigationStore((s) => s.mapZoneId);
  const setMapZoneId = useNavigationStore((s) => s.setMapZoneId);
  const setTournamentId = useNavigationStore((s) => s.setTournamentId);
  const colors = getThemeColors(themeTemplate);

  // ── Zone selection (classique) ────────────────────────────────────────────────
  const zoneScrollRef = useRef<HTMLDivElement | null>(null);
  const activeZoneIdx = useMemo(() => {
    const idx = ALL_ZONES.findIndex((z) => z.zoneId === mapZoneId);
    return idx >= 0 ? idx : 0;
  }, [mapZoneId]);

  const pageZones = useCallback((direction: 1 | -1) => {
    const el = zoneScrollRef.current;
    if (!el) return;
    const { scrollLeft, clientWidth, scrollWidth } = el;
    const maxScroll = scrollWidth - clientWidth;
    const page = clientWidth;
    let next: number;
    if (direction === 1) {
      next = scrollLeft >= maxScroll - 2 ? 0 : Math.min(scrollLeft + page, maxScroll);
    } else {
      next = scrollLeft <= 2 ? maxScroll : Math.max(scrollLeft - page, 0);
    }
    el.scrollTo({ left: next, behavior: "smooth" });
  }, []);

  // ── Tournois (Solana) ─────────────────────────────────────────────────────────
  const { activeTournaments, upcomingTournaments, isLoading: tournamentsLoading } = useTournaments();
  const visibleTournaments = [...activeTournaments, ...upcomingTournaments].slice(0, 3);

  // ── Daily challenge (Solana) ──────────────────────────────────────────────────
  const [isDailySelected, setIsDailySelected] = useState(false);
  const { challenge, isLoading: challengeLoading } = useCurrentChallenge();
  const { isRegistered: hasPlayedDaily } = usePlayerEntry(
    challenge?.challenge_id,
    publicKey?.toBase58(),
  );
  const { entries: dailyEntries } = useDailyLeaderboard(challenge?.challenge_id);
  const dailyCountdown = useDailyCountdown(challenge?.end_time);

  // Zone du daily — depuis la chain si possible, sinon dérivation SHA256 Solana
  const dailyZoneId = useMemo(
    () => challenge?.zone_id ?? computeDailyZoneId(getTodayChallengeId()),
    [challenge?.zone_id],
  );
  const dailyZoneName = ZONE_NAMES[dailyZoneId] ?? null;
  const dailyColors = getThemeColors(getThemeId(dailyZoneId));

  const dailyMyRank = useMemo(() => {
    if (!publicKey || !dailyEntries.length) return null;
    const myKey = publicKey.toBase58().toLowerCase();
    const found = dailyEntries.find((e) => e.player.toLowerCase() === myKey);
    return found?.rank ?? null;
  }, [dailyEntries, publicKey]);

  const dailyMyReward = useMemo(() => {
    if (!dailyMyRank || !dailyEntries.length) return 0;
    const pct = ((dailyMyRank - 1) * 100) / dailyEntries.length;
    if (pct < 2) return 10;
    if (pct < 5) return 7;
    if (pct < 10) return 5;
    if (pct < 25) return 3;
    if (pct < 50) return 1;
    return 0;
  }, [dailyMyRank, dailyEntries.length]);

  const PhantomLogo = () => (
  <svg width="14" height="14" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
						<rect width="128" height="128" rx="64" fill="#AB9FF2" fillOpacity="0.4" />
						<path
							d="M110.584 64.103C110.584 41.703 92.401 23.52 70.001 23.52H57.751C35.351 23.52 17.168 41.703 17.168 64.103C17.168 83.137 29.948 99.203 47.501 104.137V88.87C40.668 85.137 36.001 77.937 36.001 69.687V64.103C36.001 52.103 45.751 42.353 57.751 42.353H70.001C82.001 42.353 91.751 52.103 91.751 64.103V69.687C91.751 77.937 87.084 85.137 80.251 88.87V104.137C97.804 99.203 110.584 83.137 110.584 64.103Z"
							fill="white"
							fillOpacity="0.4"
						/>
						<ellipse cx="53.5" cy="65.5" rx="6.5" ry="6.5" fill="#AB9FF2" fillOpacity="0.4" />
						<ellipse cx="74.5" cy="65.5" rx="6.5" ry="6.5" fill="#AB9FF2" fillOpacity="0.4" />
					
  </svg>
);

  useEffect(() => {
    setMusicPlaylist(["main", "level"]);
  }, [setMusicPlaylist]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-10">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(5,10,18,0.12)_0%,rgba(5,10,18,0.05)_45%,rgba(5,10,18,0.56)_100%)]" />

      {/* Logo */}
      <div className="relative z-10 mb-1 text-center">
        <motion.img
          animate={{ y: [0, -3, 0] }}
          transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
          src={getThemeImages(themeTemplate).logo}
          alt="zKube"
          className="mx-auto h-32 md:h-44 drop-shadow-[0_0_28px_rgba(255,255,255,0.42)]"
          draggable={false}
        />
      </div>

      <div className="relative z-10 flex flex-1 min-h-0 flex-col overflow-y-auto hide-scrollbar px-4">
        <motion.div
          key="home-container"
          variants={containerVariants}
          initial={false}
          animate="show"
          className="space-y-3 pb-4"
        >
          {connected && publicKey ? (
            <>
              {/* ── Profil Phantom ─────────────────────────────────────────── */}
              <motion.div
                variants={itemVariants}
                className="flex items-center justify-between rounded-2xl border border-white/[0.16] bg-white/[0.08] px-3 py-1.5 backdrop-blur-xl"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-sans text-lg font-black"
                    style={{ background: "linear-gradient(145deg,#9333ea,#7c3aed)", color: "#fff" }}
                  >
                    👻
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-sans text-[14px] font-bold text-white">
                      {publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)}
                    </p>
                    <p className="font-sans text-[11px] font-semibold text-white/50">Phantom Wallet</p>
                  </div>
                </div>
                <span
                  className="rounded-full border px-2.5 py-1 font-sans text-[10px] font-bold uppercase tracking-[0.1em]"
                  style={{ color: "#9333ea", borderColor: "#9333ea66", backgroundColor: "#9333ea22" }}
                >
                  Connected
                </span>
              </motion.div>

              {/* ── Zone selection — classique ──────────────────────────────── */}
              <motion.div variants={itemVariants} className="my-1 flex items-center gap-2">
                <button type="button" aria-label="Previous zones" onClick={() => pageZones(-1)}
                  className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white md:flex">
                  <ChevronLeft size={14} />
                </button>
                <div className="flex-1 border-t border-white/[0.06]" />
                <span className="font-sans text-[9px] font-bold uppercase tracking-[0.2em] text-white/30">Classic</span>
                <div className="flex-1 border-t border-white/[0.06]" />
                <button type="button" aria-label="Next zones" onClick={() => pageZones(1)}
                  className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white md:flex">
                  <ChevronRight size={14} />
                </button>
              </motion.div>

              <motion.div variants={itemVariants}>
                <div ref={zoneScrollRef} className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 hide-scrollbar">
                  {ALL_ZONES.map((z, idx) => {
                    const isSelected = idx === activeZoneIdx;
                    const zColors = getThemeColors(getThemeId(z.zoneId));
                    return (
                      <motion.button whileTap={{ scale: 0.98 }} key={z.zoneId} type="button"
                        onClick={() => setMapZoneId(z.zoneId)}
                        className="relative flex h-[clamp(8rem,22vw,11rem)] w-[clamp(6.5rem,17vw,9rem)] shrink-0 snap-center flex-col items-start justify-end overflow-hidden rounded-2xl p-2 text-left"
                        style={{
                          border: isSelected ? `2px solid ${zColors.accent}` : "1px solid rgba(255,255,255,0.18)",
                          boxShadow: isSelected ? `0 0 16px ${zColors.accent}66` : "0 10px 18px -8px rgba(0,0,0,0.6)",
                        }}>
                        <img src={getThemeImages(getThemeId(z.zoneId)).themeIcon} alt="" className="absolute inset-0 h-full w-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                        <div className="relative z-10 w-full">
                          <span className="mb-1 inline-flex rounded-full px-2 py-0.5 font-sans text-[9px] font-extrabold uppercase tracking-[0.12em]"
                            style={{ color: "#0a1628", backgroundColor: zColors.accent }}>Classic</span>
                          <p className="font-sans text-base font-extrabold leading-tight text-white drop-shadow-md">{z.name}</p>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>

              {/* ── Tournois ──────────────────────────────────────────────────── */}
              <motion.div variants={itemVariants} className="my-1 flex items-center gap-2">
                <div className="flex-1 border-t border-white/[0.06]" />
                <span className="font-sans text-[9px] font-bold uppercase tracking-[0.2em] text-white/30">Tournaments</span>
                <div className="flex-1 border-t border-white/[0.06]" />
              </motion.div>

              {(tournamentsLoading || visibleTournaments.length > 0) && (
                <motion.div variants={itemVariants} className="flex flex-col gap-2">
                  {tournamentsLoading && visibleTournaments.length === 0 ? (
                    <div className="h-16 rounded-2xl border border-white/[0.08] bg-white/[0.04] animate-pulse" />
                  ) : (
                    visibleTournaments.map((t) => (
                      <TournamentCard key={t.tournamentId} tournament={t}
                        onPress={() => { setTournamentId(t.tournamentId); navigate("tournament"); }} />
                    ))
                  )}
                </motion.div>
              )}

              {/* ── Daily Challenge ────────────────────────────────────────────── */}
              <motion.div variants={itemVariants}>
                <button type="button" onClick={() => navigate("daily")}
                  className="relative w-full overflow-hidden rounded-2xl text-left transition-all"
                  style={{ border: "1px solid rgba(255,255,255,0.16)" }}>
                  <img src={getThemeImages(getThemeId(dailyZoneId)).background} alt=""
                    className="absolute inset-0 h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/70 to-black/50" />
                  <div className="relative z-10 px-4 py-3">
                    
                    <div className="mt-1 flex items-center justify-between">
                      <div>
                        <p className="font-sans text-sm font-bold text-white">{dailyZoneName ?? "Daily Challenge"}</p>
                        <p className="font-sans text-[11px] text-white/60">
                          {challengeLoading ? "Loading..."
                            : !challenge ? "Be the first to play today!"
                            : hasPlayedDaily && dailyMyRank
                              ? `#${dailyMyRank}/${dailyEntries.length}${dailyMyReward > 0 ? ` · +${dailyMyReward}★` : ""}`
                              : `${challenge.total_entries ?? 0} player${(challenge.total_entries ?? 0) !== 1 ? "s" : ""}`}
                        </p>
                      </div>
                      {dailyCountdown ? (
                        <span className="rounded-full px-3 py-1.5 font-sans text-xs font-bold tabular-nums text-white" style={{ background: dailyColors.accent }}>
                          {dailyCountdown}
                        </span>
                      ) : challenge ? (
                        <span className="rounded-full bg-red-500 px-3 py-1.5 font-sans text-xs font-bold text-white">ENDED</span>
                      ) : null}
                    </div>
                  </div>
                </button>
              </motion.div>
            </>
          ) : (
            /* ── Non connecté : guardian uniquement ──────────────────────── */
            <CtaGuardian />
          )}
        </motion.div>
      </div>

      {/* ── Boutons d'action ─────────────────────────────────────────────────── */}
      <div className="relative z-20 flex flex-col gap-2 px-4 pb-6 pt-2">
        {connected && visibleTournaments.length > 0 && (
          <button type="button"
            onClick={() => { const first = visibleTournaments[0]; if (first) { setTournamentId(first.tournamentId); navigate("tournament"); } }}
            className="w-full rounded-2xl border border-white/[0.18] bg-white/[0.06] py-3 text-center font-sans text-sm font-bold text-white/80 backdrop-blur-md transition-all hover:bg-white/[0.10] active:scale-[0.98]">
            🏆 View Tournaments
          </button>
        )}
        <ArcadeButton
          onClick={() => navigate("solana")}
          accentOverride="#9333ea"
        >
          Play
        </ArcadeButton>
      </div>
    </div>
  );
};

export default HomePage;
