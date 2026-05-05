import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, type Variants } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useWallet } from "@solana/wallet-adapter-react";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { useMusicPlayer } from "@/contexts/hooks";
import { getThemeColors, getThemeId, getThemeImages, type ThemeId } from "@/config/themes";
import { ZONE_NAMES } from "@/config/profileData";
import { ZONE_GUARDIANS, getGuardianPortrait } from "@/config/bossCharacters";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTournaments } from "@/hooks/useTournaments";
import type { TournamentWithStatus } from "@/hooks/useTournaments";
import {
  getCurrentTournamentId,
  TOURNAMENT_DURATION_SECONDS,
  useSolanaTournament,
} from "@/solana/useSolanaTournament";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";

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

function formatTournamentCountdown(totalSec: number) {
  const h = Math.floor(totalSec / 3600).toString().padStart(2, "0");
  const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function getTournamentStatus(t: TournamentData): TournamentWithStatus["status"] {
  const now = Math.floor(Date.now() / 1000);
  if (t.settled) return "settled";
  if (now < t.startTime) return "upcoming";
  if (now < t.endTime) return "active";
  return "ended";
}

const HomePage: React.FC = () => {
  // ── Phantom wallet ───────────────────────────────────────────────────────────
  const { connected, publicKey, wallet } = useWallet();

  // ── Navigation ───────────────────────────────────────────────────────────────
  const { themeTemplate } = useTheme();
  const { setMusicPlaylist } = useMusicPlayer();
  const navigate = useNavigationStore((s) => s.navigate);
  const mapZoneId = useNavigationStore((s) => s.mapZoneId);
  const setMapZoneId = useNavigationStore((s) => s.setMapZoneId);
  const setTournamentId = useNavigationStore((s) => s.setTournamentId);
  const colors = getThemeColors(themeTemplate);
  const { createTournament, fetchTournament } = useSolanaTournament();
  const [isCreatingTournament, setIsCreatingTournament] = useState(false);
  const [tournamentStartError, setTournamentStartError] = useState<string | null>(null);
  const startTournamentDurationLabel = useMemo(
    () => formatTournamentCountdown(TOURNAMENT_DURATION_SECONDS),
    [],
  );

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
  // useTournaments lit TOUS les comptes Tournament on-chain via getProgramAccounts.
  // C'est la seule source de vérité — pas besoin de fetch par ID calculé.
  const { activeTournaments, upcomingTournaments, isLoading: tournamentsLoading } = useTournaments();
  const visibleTournaments = useMemo(
    () => [...activeTournaments, ...upcomingTournaments].slice(0, 3),
    [activeTournaments, upcomingTournaments],
  );
  const canStartTournament = connected && !tournamentsLoading && visibleTournaments.length === 0;

  const handleStartTournament = useCallback(async () => {
    if (!connected || isCreatingTournament) return;
    const tournamentId = getCurrentTournamentId();
    setIsCreatingTournament(true);
    setTournamentStartError(null);
    try {
      const existing = await fetchTournament(tournamentId);
      if (existing) {
        setTournamentId(tournamentId);
        navigate("tournament");
        return;
      }

      await createTournament(tournamentId);

      for (let i = 0; i < 8; i++) {
        const created = await fetchTournament(tournamentId);
        if (created) {
          setTournamentId(tournamentId);
          navigate("tournament");
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 800));
      }

      setTournamentStartError("Tournament created. Refresh if it does not appear in a few seconds.");
    } catch (err) {
      const existingAfterError = await fetchTournament(tournamentId).catch(() => null);
      if (existingAfterError) {
        setTournamentId(tournamentId);
        navigate("tournament");
        return;
      }
      console.error("[Tournament] start tournament error:", err);
      setTournamentStartError("Could not start tournament. Check Phantom or try again in a moment.");
    } finally {
      setIsCreatingTournament(false);
    }
  }, [connected, isCreatingTournament, createTournament, fetchTournament, setTournamentId, navigate]);

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
                    style={{ background: "linear-gradient(145deg,#AB9FF2,#7c3aed)", color: "#fff" }}
                  >
                    {wallet?.adapter.icon ? (
                      <img
                        src={wallet.adapter.icon}
                        alt="Phantom"
                        className="h-7 w-7 object-contain"
                        draggable={false}
                      />
                    ) : (
                      <span className="text-sm font-black">P</span>
                    )}
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

              {canStartTournament && (
                <motion.div variants={itemVariants}>
                  <button
                    type="button"
                    onClick={handleStartTournament}
                    disabled={isCreatingTournament}
                    className="relative w-full overflow-hidden rounded-2xl border border-white/[0.14] bg-white/[0.06] px-4 py-3 text-left backdrop-blur-md transition-all hover:bg-white/[0.10] active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-sans text-sm font-bold text-white">
                          {isCreatingTournament ? "Starting tournament..." : "Start 48h Tournament"}
                        </p>
                        <p className="mt-0.5 font-sans text-[11px] text-white/50">
                          Be the first to open the global competition.
                        </p>
                      </div>
                      <span className="rounded-full bg-purple-500/20 px-3 py-1.5 font-sans text-[10px] font-bold tabular-nums tracking-[0.08em] text-purple-300">
                        {startTournamentDurationLabel}
                      </span>
                    </div>
                    {tournamentStartError && (
                      <p className="mt-2 font-sans text-[11px] font-semibold text-red-300">
                        {tournamentStartError}
                      </p>
                    )}
                  </button>
                </motion.div>
              )}
            </>
          ) : (
            /* ── Non connecté : guardian uniquement ──────────────────────── */
            <CtaGuardian />
          )}
        </motion.div>
      </div>

      {/* ── Boutons d'action ─────────────────────────────────────────────────── */}
      <div className="relative z-20 flex flex-col gap-2 px-4 pb-6 pt-2">
        {connected && visibleTournaments.length > 0 }
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
