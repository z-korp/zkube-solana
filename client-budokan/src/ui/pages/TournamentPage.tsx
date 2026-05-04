/**
 * TournamentPage — Page de détail d'un tournoi zKube.
 *
 * Flow :
 *  1. Affiche la zone/guardian du tournoi, le prize pool, le countdown
 *  2. Si le joueur n'est pas inscrit → bouton "Join & Play" (join + create_game groupés)
 *  3. Si le joueur est inscrit et n'a pas encore soumis de score → bouton "Play" sans paiement
 *  4. Si le joueur a déjà soumis → bouton "Play Again" (rejoin + create_game groupés)
 *  5. Après settle → leaderboard avec les 3 gagnants + bouton "Claim Prize"
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Loader2, Trophy } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useNavigationStore } from "@/stores/navigationStore";
import { useSolanaTournament } from "@/solana/useSolanaTournament";
import type { TournamentData, TournamentEntryData } from "@/solana/useSolanaTournament";
import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { ZONE_NAMES } from "@/config/profileData";
import { getZoneGuardian, getGuardianPortrait } from "@/config/bossCharacters";
import { motion } from "motion/react";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";

const TOURNAMENT_SUBMIT_RETURN_PREFIX = "zkube_tournament_submit_return_";
const TOURNAMENT_PLAY_REQUEST_PREFIX = "zkube_tournament_play_request_";
const REPLAY_AFTER_SUBMIT_LOCK_MS = 2500;
type TournamentEntryAction = "join" | "rejoin";

// ── Countdown live ───────────────────────────────────────────────────────────
const CountdownText: React.FC<{ endTime: number }> = ({ endTime }) => {
  const [sec, setSec] = useState(() => Math.max(0, endTime - Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const id = window.setInterval(
      () => setSec(Math.max(0, endTime - Math.floor(Date.now() / 1000))),
      1000,
    );
    return () => window.clearInterval(id);
  }, [endTime]);
  const h = Math.floor(sec / 3600).toString().padStart(2, "0");
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return <>{sec > 0 ? `${h}:${m}:${s}` : "ENDED"}</>;
};

// ── Rang trophy icon ──────────────────────────────────────────────────────────
const TROPHY_COLORS: Record<number, string> = {
  1: "#FFD700",
  2: "#C0C0C0",
  3: "#CD7F32",
};

// ── Formatage lamports → SOL ───────────────────────────────────────────────────
function lamportsToSol(lamports: bigint): string {
  return (Number(lamports) / 1_000_000_000).toFixed(3);
}

function getSubmitReturnTime(playerPubkey: string, tournamentId: number): number {
  try {
    const raw = sessionStorage.getItem(`${TOURNAMENT_SUBMIT_RETURN_PREFIX}${playerPubkey}_${tournamentId}`);
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
}

function saveTournamentPlayRequest(
  playerPubkey: string,
  tournamentId: number,
  tournamentEntryAction?: TournamentEntryAction,
): void {
  try {
    sessionStorage.setItem(
      `${TOURNAMENT_PLAY_REQUEST_PREFIX}${playerPubkey}_${tournamentId}`,
      JSON.stringify({
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        tournamentEntryAction,
      }),
    );
  } catch {
    // Best-effort duplicate-start guard only.
  }
}

// ── Composant principal ───────────────────────────────────────────────────────
const TournamentPage: React.FC = () => {
  const { publicKey, connected } = useWallet();
  const goBack = useNavigationStore((s) => s.goBack);
  const navigate = useNavigationStore((s) => s.navigate);
  const setMapZoneId = useNavigationStore((s) => s.setMapZoneId);
  const setIsDailyMap = useNavigationStore((s) => s.setIsDailyMap);
  const setIsTournamentMap = useNavigationStore((s) => s.setIsTournamentMap);
  const setNavTournamentId = useNavigationStore((s) => s.setTournamentId);
  const tournamentId = useNavigationStore((s) => s.tournamentId);

  const {
    fetchTournament,
    fetchMyEntry,
    fetchLeaderboard,
    claimPrize,
    getMyPrizeRank,
    formatCountdown,
    getSecondsRemaining,
  } = useSolanaTournament();

  const [tournament, setTournament] = useState<TournamentData | null>(null);
  const [myEntry, setMyEntry] = useState<TournamentEntryData | null>(null);
  const [leaderboard, setLeaderboard] = useState<TournamentEntryData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [replayLockedUntil, setReplayLockedUntil] = useState(0);
  const playInFlightRef = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // ── Fetch données ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        const [t, entry, board] = await Promise.all([
          fetchTournament(tournamentId),
          fetchMyEntry(tournamentId),
          fetchLeaderboard(tournamentId),
        ]);
        if (!cancelled) {
          setTournament(t);
          setMyEntry(entry);
          setLeaderboard(board);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [tournamentId, fetchTournament, fetchMyEntry, fetchLeaderboard]);

  useEffect(() => {
    if (!publicKey || !tournamentId) {
      setReplayLockedUntil(0);
      return;
    }

    const returnedAt = getSubmitReturnTime(publicKey.toBase58(), tournamentId);
    const lockedUntil = returnedAt + REPLAY_AFTER_SUBMIT_LOCK_MS;
    if (lockedUntil <= Date.now()) {
      setReplayLockedUntil(0);
      return;
    }

    setReplayLockedUntil(lockedUntil);
    const timeout = window.setTimeout(() => setReplayLockedUntil(0), lockedUntil - Date.now());
    return () => window.clearTimeout(timeout);
  }, [publicKey, tournamentId]);

  // ── Infos thème ──────────────────────────────────────────────────────────────
  const zoneId = tournament?.zoneId ?? 1;
  const zoneName = ZONE_NAMES[zoneId] ?? `Zone ${zoneId}`;
  const themeId = getThemeId(zoneId);
  const zoneColors = getThemeColors(themeId);
  const zoneImages = getThemeImages(themeId);
  const guardian = getZoneGuardian(zoneId);

  const isActive = tournament
    ? !tournament.settled && nowSec >= tournament.startTime && nowSec < tournament.endTime
    : false;
  const isSettled = tournament?.settled ?? false;
  const secondsLeft = tournament ? getSecondsRemaining(tournament) : 0;
  const prizePoolSol = tournament ? lamportsToSol(tournament.prizePool) : "0.000";

  const isRegistered = !!myEntry;
  const myPrizeRank = tournament ? getMyPrizeRank(tournament) : null;
  const isReplayLocked = replayLockedUntil > Date.now();

  // ── Actions ──────────────────────────────────────────────────────────────────
  const handlePlay = useCallback(async () => {
    if (!connected || !publicKey || !tournamentId || !tournament) return;
    if (replayLockedUntil > Date.now()) return;
    if (playInFlightRef.current) return;
    playInFlightRef.current = true;
    setIsPlaying(true);
    try {
      const tournamentEntryAction: TournamentEntryAction | undefined = !isRegistered
        ? "join"
        : myEntry?.hasSubmitted
        ? "rejoin"
        : undefined;

      saveTournamentPlayRequest(publicKey.toBase58(), tournamentId, tournamentEntryAction);
      if (!isRegistered) {
        console.log("[Tournament] join will be bundled with create_game");
      } else if (myEntry?.hasSubmitted) {
        console.log("[Tournament] rejoin will be bundled with create_game");
      }
      // Configurer la navigation : zone imposée par le tournoi
      setMapZoneId(tournament.zoneId);
      setIsDailyMap(false);
      setIsTournamentMap(true);
      setNavTournamentId(tournamentId);
      navigate("solana");
    } catch (err: any) {
      console.error("[Tournament] handlePlay error:", err);
    } finally {
      playInFlightRef.current = false;
      setIsPlaying(false);
    }
  }, [
    connected, publicKey, tournamentId, tournament, isRegistered, myEntry?.hasSubmitted, replayLockedUntil,
    setMapZoneId, setIsDailyMap, setIsTournamentMap, setNavTournamentId, navigate,
  ]);

  const handleClaim = useCallback(async () => {
    if (!connected || !publicKey || !tournamentId) return;
    setIsClaiming(true);
    try {
      await claimPrize(tournamentId);
      // Rafraîchir les données après claim
      const t = await fetchTournament(tournamentId);
      if (t) setTournament(t);
    } catch (err: any) {
      console.error("[Tournament] handleClaim error:", err);
    } finally {
      setIsClaiming(false);
    }
  }, [connected, publicKey, tournamentId, claimPrize, fetchTournament]);

  // ── Libellé du bouton play ───────────────────────────────────────────────────
  const playLabel = useMemo(() => {
    if (isReplayLocked) return "Score Saved";
    if (isPlaying) return "Loading...";
    if (!isRegistered) return "Join & Play — 0.1 SOL";
    if (!myEntry?.hasSubmitted) return "Play Now";
    return `Play Again (attempt #${(myEntry.attempts ?? 0) + 1})`;
  }, [isPlaying, isRegistered, isReplayLocked, myEntry]);

  // ── Top 3 pour le leaderboard ─────────────────────────────────────────────────
  const top3 = useMemo(
    () =>
      isSettled && tournament
        ? [
            { wallet: tournament.winner1, prize: tournament.prize1, rank: 1 },
            { wallet: tournament.winner2, prize: tournament.prize2, rank: 2 },
            { wallet: tournament.winner3, prize: tournament.prize3, rank: 3 },
          ].filter((w) => w.prize > 0n)
        : [],
    [isSettled, tournament],
  );

  // ── Rendu ────────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-12">
      {/* Fond dégradé */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(5,10,18,0.12)_0%,rgba(5,10,18,0.05)_45%,rgba(5,10,18,0.56)_100%)]" />

      {/* Header */}
      <div className="relative z-10 flex min-h-10 items-center justify-center px-6 pb-2">
        <div className="absolute left-6 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center">
          <button
            onClick={goBack}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] shadow-lg backdrop-blur-md transition-all hover:bg-white/[0.08] active:scale-95"
          >
            <ChevronLeft size={20} className="text-white/80" />
          </button>
        </div>
        <h1 className="text-center font-display text-2xl font-bold tracking-wide text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]">
          Tournament
        </h1>
      </div>

      {/* Contenu scrollable */}
      <div className="relative z-10 mx-4 mt-4 flex flex-1 min-h-0 flex-col overflow-y-auto hide-scrollbar pb-3">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">

          {/* Loading */}
          {isLoading && (
            <div className="flex flex-1 items-center justify-center py-20">
              <Loader2 size={28} className="animate-spin" style={{ color: zoneColors.accent }} />
            </div>
          )}

          {/* Tournoi introuvable */}
          {!isLoading && !tournament && (
            <div className="rounded-2xl border border-white/[0.12] bg-white/[0.06] p-8 text-center backdrop-blur-xl">
              <p className="font-sans text-sm text-white/60">Tournament not found.</p>
            </div>
          )}

          {/* Carte principale du tournoi */}
          {tournament && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col gap-4"
            >
              {/* Guardian banner */}
              <div
                className="relative overflow-hidden rounded-2xl border-2"
                style={{
                  borderColor: `${zoneColors.accent}35`,
                  boxShadow: `0 4px 32px rgba(0,0,0,0.3), inset 0 1px 0 ${zoneColors.accent}15`,
                }}
              >
                <img
                  src={zoneImages.background}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-black/85" />
                <div className="relative z-10 px-4 pb-4 pt-3">
                  {/* Portrait + infos */}
                  <div className="flex items-center gap-3">
                    <img
                      src={getGuardianPortrait(zoneId)}
                      alt={guardian.name}
                      className="h-14 w-14 shrink-0 rounded-xl object-cover"
                      style={{
                        border: `2px solid ${zoneColors.accent}44`,
                        boxShadow: `0 0 16px ${zoneColors.accent}22`,
                      }}
                      draggable={false}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-lg font-black text-white">
                          {zoneName}
                        </span>
                        <span
                          className="rounded-full px-2 py-0.5 font-sans text-[9px] font-bold uppercase"
                          style={{ color: zoneColors.accent, background: `${zoneColors.accent}18` }}
                        >
                          #{tournament.tournamentId}
                        </span>
                      </div>
                      <p className="mt-0.5 font-sans text-[11px] font-semibold text-white/50">
                        {tournament.totalPlayers} player{tournament.totalPlayers !== 1 ? "s" : ""}{" "}
                        · {prizePoolSol} SOL prize pool
                      </p>
                    </div>
                    {/* Timer / statut */}
                    {isActive ? (
                      <span
                        className="shrink-0 rounded-full px-3 py-1.5 font-sans text-xs font-bold tabular-nums text-white"
                        style={{ background: zoneColors.accent }}
                      >
                        Ongoing
                      </span>
                    ) : isSettled ? (
                      <span className="shrink-0 rounded-full bg-purple-600 px-3 py-1.5 font-sans text-xs font-bold text-white">
                        SETTLED
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-red-500 px-3 py-1.5 font-sans text-xs font-bold text-white">
                        ENDED
                      </span>
                    )}
                  </div>

                  {/* Guardian greeting */}
                  <p className="mt-2.5 font-sans text-[13px] italic text-white/55">
                    "{guardian.trialIntro}"
                  </p>
                  

                  {/* Stats row */}
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[
                      { label: "Entry fee", value: "0.1 SOL" },
                      { label: "Prize pool", value: `${prizePoolSol} SOL` },
                      { label: "Time left", value: isActive ? <CountdownText endTime={tournament.endTime} /> : isSettled ? "Settled" : "Ended" },
                    ].map(({ label, value }) => (
                      <div
                        key={label}
                        className="rounded-xl p-2 text-center"
                        style={{ background: `${zoneColors.accent}10` }}
                      >
                        <p className="font-sans text-[9px] font-bold uppercase tracking-[0.12em] text-white/40">
                          {label}
                        </p>
                        <p className="mt-0.5 font-sans text-sm font-bold text-white">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Score du joueur si inscrit */}
                  {isRegistered && myEntry && (
                    <div
                      className="mt-3 flex items-center justify-between rounded-xl px-3 py-2"
                      style={{ background: `${zoneColors.accent}15`, border: `1px solid ${zoneColors.accent}30` }}
                    >
                      <div>
                        <p className="font-sans text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: zoneColors.accent }}>
                          Your best score
                        </p>
                        <p className="font-sans text-lg font-black text-white">
                          {myEntry.hasSubmitted ? myEntry.bestScore.toLocaleString() : "—"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">
                          Attempts
                        </p>
                        <p className="font-sans text-lg font-black text-white">{myEntry.attempts}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Leaderboard (toujours visible) */}
              {leaderboard.length > 0 && (
                <div className="rounded-2xl border border-white/[0.10] bg-white/[0.04] backdrop-blur-xl">
                  <div className="px-4 py-3">
                    <p className="font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                      {isSettled ? "Final Results" : "Leaderboard"}
                    </p>
                  </div>

                  {/* Top 3 winners si settled */}
                  {isSettled && top3.length > 0 && (
                    <div className="flex flex-col gap-2 px-4 pb-2">
                      {top3.map(({ wallet, prize, rank }) => (
                        <div
                          key={rank}
                          className="flex items-center gap-3 rounded-xl px-3 py-2"
                          style={{
                            background: `${TROPHY_COLORS[rank]}10`,
                            border: `1px solid ${TROPHY_COLORS[rank]}30`,
                          }}
                        >
                          <Trophy size={16} style={{ color: TROPHY_COLORS[rank] }} />
                          <span className="flex-1 font-sans text-sm font-semibold text-white">
                            {wallet.toBase58().slice(0, 8)}…
                          </span>
                          <span className="font-sans text-sm font-bold" style={{ color: TROPHY_COLORS[rank] }}>
                            {lamportsToSol(prize)} SOL
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tous les participants */}
                  <div className="flex flex-col divide-y divide-white/[0.06]">
                    {leaderboard.slice(0, 20).map((entry, i) => {
                      const isMe = publicKey && entry.player.toBase58() === publicKey.toBase58();
                      return (
                        <div
                          key={entry.player.toBase58()}
                          className="flex items-center gap-3 px-4 py-2.5"
                          style={isMe ? { background: `${zoneColors.accent}0a` } : {}}
                        >
                          <span
                            className="w-6 font-sans text-xs font-bold tabular-nums"
                            style={{ color: i < 3 ? TROPHY_COLORS[i + 1] : "rgba(255,255,255,0.30)" }}
                          >
                            #{i + 1}
                          </span>
                          <span className="flex-1 font-sans text-sm text-white/80">
                            {isMe ? (
                              <span style={{ color: zoneColors.accent }} className="font-bold">You</span>
                            ) : (
                              `${entry.player.toBase58().slice(0, 6)}…`
                            )}
                          </span>
                          {entry.hasSubmitted ? (
                            <span className="font-sans text-sm font-bold text-white">
                              {entry.bestScore.toLocaleString()}
                            </span>
                          ) : (
                            <span className="font-sans text-xs text-white/30">no score</span>
                          )}
                        </div>
                      );
                    })}
                    {leaderboard.length > 20 && (
                      <p className="px-4 py-2 text-center font-sans text-xs text-white/30">
                        +{leaderboard.length - 20} more players
                      </p>
                    )}
                  </div>
                </div>
              )}

              {leaderboard.length === 0 && !isLoading }
            </motion.div>
          )}
        </div>
      </div>

      {/* CTA en bas */}
      {connected && tournament && (
        <div className="relative z-20 mt-auto flex flex-col gap-2 px-4 pb-3">
          {/* Bouton claim si gagnant */}
          {isSettled && myPrizeRank && (
            <ArcadeButton
              disabled={isClaiming}
              onClick={handleClaim}
              accentOverride="#9333ea"
            >
              {isClaiming ? "Claiming..." : `Claim Prize 🏆 (${myPrizeRank === 1 ? lamportsToSol(tournament.prize1) : myPrizeRank === 2 ? lamportsToSol(tournament.prize2) : lamportsToSol(tournament.prize3)} SOL)`}
            </ArcadeButton>
          )}

          {/* Bouton play si actif */}
          {isActive && (
            <ArcadeButton
              disabled={isPlaying || isReplayLocked}
              onClick={handlePlay}
              accentOverride={zoneColors.accent}
            >
              {playLabel}
            </ArcadeButton>
          )}
        </div>
      )}
    </div>
  );
};

export default TournamentPage;
