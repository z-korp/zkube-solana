import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, type Variants } from "motion/react";
import { Trophy, Loader2 } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
// import { useClassicLeaderboard } from "@/hooks/useClassicLeaderboard";
import { usePlayerLeaderboard } from "@/hooks/usePlayerLeaderboard";
import { useTournaments } from "@/hooks/useTournaments";
import { getThemeColors } from "@/config/themes";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { useNavigationStore } from "@/stores/navigationStore";
import PageHeader from "@/ui/components/shared/PageHeader";
import { useSolanaTournament } from "@/solana/useSolanaTournament";
import type { TournamentData } from "@/solana/useSolanaTournament";
import type { TournamentWithStatus } from "@/hooks/useTournaments";

//TODO: s'occupe de la partie daily commenter 
const TROPHY_IMAGES: Record<number, string> = {
  1: "/assets/common/trophies/gold.png",
  2: "/assets/common/trophies/silver.png",
  3: "/assets/common/trophies/bronze.png",
};

const rowVariants: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: (i: number) => ({
    opacity: 1, x: 0,
    transition: { delay: i * 0.04, type: "spring", stiffness: 300, damping: 24 }
  })
};

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function lamportsToSol(lamports: bigint): string {
  return (Number(lamports) / 1_000_000_000).toFixed(3);
}

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function getTournamentStatus(t: TournamentData): TournamentWithStatus["status"] {
  const now = Math.floor(Date.now() / 1000);
  if (t.settled) return "settled";
  if (now < t.startTime) return "upcoming";
  if (now < t.endTime) return "active";
  return "ended";
}

function withTournamentStatus(t: TournamentData): TournamentWithStatus {
  return { ...t, status: getTournamentStatus(t) };
}

const LeaderboardPage: React.FC = () => {
  const { themeTemplate } = useTheme();
  const colors = getThemeColors(themeTemplate);
  const { publicKey } = useWallet();
  const navTournamentId = useNavigationStore((s) => s.tournamentId);
  // Fallback : premier tournoi actif on-chain, puis upcoming, puis ended — jamais getCurrentTournamentId()
  const { tournaments, activeTournaments, upcomingTournaments, recentTournaments } = useTournaments();
  const fallbackTournamentId = useMemo(
    () =>
      activeTournaments[0]?.tournamentId ??
      upcomingTournaments[0]?.tournamentId ??
      recentTournaments[0]?.tournamentId ??
      null,
    [activeTournaments, upcomingTournaments, recentTournaments],
  );
  const activeTournamentId = navTournamentId ?? fallbackTournamentId;
  // const { entries: dailyEntries, isLoading: dailyLoading } = useClassicLeaderboard();
  // Daily leaderboard temporarily disabled - TODO: reimplement for Solana migration
  const dailyLoading = false;
  const { entries: playerEntries, isLoading: playerLoading, refetch: refetchPlayerLeaderboard } = usePlayerLeaderboard(activeTournamentId);
  const { claimPrize, settleTournament, fetchTournament } = useSolanaTournament();
  const [localTournament, setLocalTournament] = useState<TournamentWithStatus | null>(null);
  const [isSettling, setIsSettling] = useState(false);
  const [claimingPlayer, setClaimingPlayer] = useState<string | null>(null);
  const [prizeActionError, setPrizeActionError] = useState<string | null>(null);
  // const [activeTab, setActiveTab] = useState<"daily" | "player">(() =>
  //   navTournamentId ? "player" : "daily",
  // );
  // Temporarily default to player tab since daily is disabled
  const [activeTab, setActiveTab] = useState<"daily" | "player">("player");

  const normalizedAccount = publicKey?.toBase58().toLowerCase();
  const selectedTournamentFromList = useMemo(
    () => tournaments.find((t) => t.tournamentId === activeTournamentId) ?? null,
    [activeTournamentId, tournaments],
  );
  const selectedTournament = localTournament ?? selectedTournamentFromList;
  const submittedScoreCount = playerEntries.length;

  useEffect(() => {
    setLocalTournament(null);
    setPrizeActionError(null);
    setClaimingPlayer(null);
    setIsSettling(false);
  }, [activeTournamentId]);

  const refreshSelectedTournament = useCallback(async () => {
    if (activeTournamentId === null) return null;
    const refreshed = await fetchTournament(activeTournamentId);
    if (!refreshed) return null;
    const withStatus = withTournamentStatus(refreshed);
    setLocalTournament(withStatus);
    return withStatus;
  }, [activeTournamentId, fetchTournament]);

  const handleFinalizeResults = useCallback(async () => {
    if (activeTournamentId === null || isSettling || submittedScoreCount === 0) return;
    setIsSettling(true);
    setPrizeActionError(null);
    try {
      await settleTournament(activeTournamentId);
      await Promise.all([refreshSelectedTournament(), refetchPlayerLeaderboard()]);
    } catch (err: unknown) {
      console.error("[Leaderboard] finalize tournament error:", err);
      setPrizeActionError(getErrorMessage(err, "Could not finalize results. Try again in a moment."));
    } finally {
      setIsSettling(false);
    }
  }, [
    activeTournamentId,
    isSettling,
    submittedScoreCount,
    settleTournament,
    refreshSelectedTournament,
    refetchPlayerLeaderboard,
  ]);

  const handleClaimPrize = useCallback(async (playerAddress: string) => {
    if (activeTournamentId === null || claimingPlayer) return;
    setClaimingPlayer(playerAddress);
    setPrizeActionError(null);
    try {
      await claimPrize(activeTournamentId);
      await Promise.all([refreshSelectedTournament(), refetchPlayerLeaderboard()]);
    } catch (err: unknown) {
      console.error("[Leaderboard] claim prize error:", err);
      setPrizeActionError(getErrorMessage(err, "Could not claim prize. Try again in a moment."));
    } finally {
      setClaimingPlayer(null);
    }
  }, [
    activeTournamentId,
    claimingPlayer,
    claimPrize,
    refreshSelectedTournament,
    refetchPlayerLeaderboard,
  ]);

  const winnerInfoByAddress = useMemo(() => {
    const winners = new Map<string, { rank: 1 | 2 | 3; prize: bigint }>();
    if (!selectedTournament || selectedTournament.status !== "settled") return winners;

    const addWinner = (address: string, rank: 1 | 2 | 3, prize: bigint) => {
      if (address === "11111111111111111111111111111111") return;
      winners.set(address.toLowerCase(), { rank, prize });
    };

    addWinner(selectedTournament.winner1.toBase58(), 1, selectedTournament.prize1);
    addWinner(selectedTournament.winner2.toBase58(), 2, selectedTournament.prize2);
    addWinner(selectedTournament.winner3.toBase58(), 3, selectedTournament.prize3);
    return winners;
  }, [selectedTournament]);

  //TODO: decommenter pour la partie profile 
  // const handleRowClick = (playerAddress: string | undefined) => {
  //   if (!playerAddress) return;
  //   setProfileAddress(playerAddress);
    
  //   navigate("profile");
  // };

  const rankRows = useMemo(() => {
    // Daily leaderboard temporarily disabled
    // if (activeTab === "daily") {
    //   return dailyEntries.slice(0, 30).map((entry) => ({
    //     id: `daily-${entry.rank}`,
    //     rank: entry.rank,
    //     name: entry.playerName ?? shortAddress(entry.player),
    //     score: entry.score,
    //     playerAddress: entry.player,
    //     isYou: normalizedAccount === entry.player.toLowerCase(),
    //     subtitle: `Classic best · ${entry.moveCount} moves · ${entry.maxCombo} combo`,
    //   }));
    // }
    return playerEntries.slice(0, 30).map((entry) => ({
      id: `player-${entry.rank}`,
      rank: entry.rank,
      name: entry.playerName ?? shortAddress(entry.player),
      score: entry.bestScore,
      playerAddress: entry.player,
      isYou: normalizedAccount === entry.player.toLowerCase(),
      subtitle: `Tournament #${entry.tournamentId} · ${entry.attempts} attempt${entry.attempts > 1 ? "s" : ""}`,
      winnerInfo: winnerInfoByAddress.get(entry.player.toLowerCase()) ?? null,
    }));
  }, [playerEntries, normalizedAccount, winnerInfoByAddress]);

  const myRank = useMemo(() => {
    if (!normalizedAccount) return null;
    // Daily leaderboard temporarily disabled
    // if (activeTab === "daily") {
    //   const entry = dailyEntries.find((e) => e.player.toLowerCase() === normalizedAccount);
    //   return entry ? { rank: entry.rank, total: dailyEntries.length, score: entry.score, name: entry.playerName ?? "You" } : null;
    // }
    const entry = playerEntries.find((e) => e.player.toLowerCase() === normalizedAccount);
    return entry ? { rank: entry.rank, total: playerEntries.length, score: entry.bestScore, name: entry.playerName ?? "You" } : null;
  }, [playerEntries, normalizedAccount]);

  const isMyRankVisible = myRank ? rankRows.some((r) => r.isYou) : false;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-12">
      <div className="shrink-0 pb-2">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
        >
          <PageHeader title="Leaderboard" />
        </motion.div>
        <div className="mx-6 mt-2 flex rounded-full border border-white/[0.16] bg-white/[0.1] p-1 shadow-[inset_0_2px_8px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          {([
            // { id: "daily", label: "Daily" }, // Temporarily disabled - Daily leaderboard under migration
            { id: "player", label: "Player" },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex-1 py-1.5 px-3 rounded-full text-[12px] font-bold transition-colors duration-200 z-10 font-sans tracking-wide uppercase ${
                activeTab === tab.id
                  ? "text-white"
                  : "text-white/40 hover:text-white/60"
              }`}
            >
              {activeTab === tab.id && (
                <motion.div
                  layoutId="leaderboard-tab-indicator"
                  className="absolute inset-0 bg-white/20 rounded-full shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)] border border-white/[0.08]"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              <span className="relative z-20 drop-shadow-sm">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mx-4 mt-2 mb-4 flex-1 min-h-0 overflow-y-auto hide-scrollbar">
        {/* Daily leaderboard temporarily disabled */}
        {(activeTab === "daily" ? dailyLoading : playerLoading) ? (
          <div className="flex flex-col items-center justify-center py-16" style={{ color: colors.textMuted }}>
            <Loader2 className="h-8 w-8 animate-spin mb-4" style={{ color: colors.accent }} />
            <p className="font-sans text-sm font-medium">Loading rankings...</p>
          </div>
        ) : rankRows.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-16 text-center"
            style={{ color: colors.textMuted }}
          >
            <Trophy className="h-12 w-12 mb-4 opacity-50" />
            <p className="mb-1 font-sans text-xl font-semibold" style={{ color: colors.text }}>No entries yet</p>
            <p className="font-sans text-base">
              {/* Daily leaderboard temporarily disabled */}
              {activeTab === "daily"
                ? "Daily leaderboard temporarily disabled - Solana migration in progress."
                : "Submit a tournament score to claim rank #1."}
            </p>
          </motion.div>
        ) : (
          <motion.div
            key={activeTab}
            initial="hidden"
            animate="visible"
            className="mx-auto max-w-[640px] space-y-2"
          >
            {activeTab === "player" && selectedTournament?.status === "ended" && (
              <motion.div
                variants={rowVariants}
                custom={0}
                className="rounded-2xl border border-purple-400/25 bg-purple-500/10 px-4 py-3 text-center backdrop-blur-xl"
              >
                <p className="font-sans text-sm font-black text-white">Tournament ended</p>
                <p className="mt-1 font-sans text-[11px] font-semibold text-white/55">
                  Finalize results to unlock winner claims.
                </p>
                {prizeActionError && (
                  <p className="mt-2 font-sans text-[11px] font-semibold text-red-300">{prizeActionError}</p>
                )}
                <button
                  type="button"
                  onClick={handleFinalizeResults}
                  disabled={isSettling || submittedScoreCount === 0}
                  className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl bg-purple-600 px-5 font-sans text-sm font-black text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSettling ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Finalizing...
                    </span>
                  ) : submittedScoreCount === 0 ? (
                    "No scores"
                  ) : (
                    "Finalize Results"
                  )}
                </button>
              </motion.div>
            )}

            {activeTab === "player" && selectedTournament?.status === "settled" && prizeActionError && (
              <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-center">
                <p className="font-sans text-xs font-semibold text-red-300">{prizeActionError}</p>
              </div>
            )}

            {rankRows.map((entry, index) => {
              const claimablePrize = entry.isYou ? entry.winnerInfo?.prize ?? 0n : 0n;
              const isClaimingThisRow = claimingPlayer === entry.playerAddress;
              // Background per row: rank colors for top 3, neutral white otherwise.
              const baseBg =
                entry.rank === 1
                  ? "rgba(255,215,0,0.2)"
                  : entry.rank === 2
                    ? "rgba(192,192,192,0.18)"
                    : entry.rank === 3
                      ? "rgba(205,127,50,0.18)"
                      : "rgba(255,255,255,0.1)";
              // Pulse only fires for "you": gently brighten the row's base color.
              const pulseBright =
                entry.rank === 1
                  ? "rgba(255,215,0,0.32)"
                  : entry.rank === 2
                    ? "rgba(192,192,192,0.28)"
                    : entry.rank === 3
                      ? "rgba(205,127,50,0.28)"
                      : `${colors.accent}40`;
              const pulseBase = entry.rank <= 3 ? baseBg : `${colors.accent}20`;

              return (
                <motion.div
                  custom={index}
                  variants={rowVariants}
                  key={entry.id}
                  // TODO: decommenter ceci pour faire la partie profile
                  //onClick={() => handleRowClick(entry.playerAddress)}

                  
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 backdrop-blur-xl transition-all active:scale-[0.98] ${entry.isYou ? "leaderboard-pulse" : ""}`}
                  style={{
                    // For non-"you" rows: static rank-based background.
                    // For "you": CSS keyframe animates background-color between
                    // --pulse-base and --pulse-bright so the rank color itself
                    // shimmers (gold dims/brightens for #1, etc).
                    ...(entry.isYou
                      ? ({ "--pulse-base": pulseBase, "--pulse-bright": pulseBright } as React.CSSProperties)
                      : { backgroundColor: baseBg }),
                    borderColor: entry.isYou
                      ? `${colors.accent}AA`
                      : entry.rank <= 3
                        ? "rgba(255,255,255,0.3)"
                        : "rgba(255,255,255,0.14)",
                  }}
                >
                  <div className="flex w-8 items-center justify-center text-center font-sans text-base font-black" style={{ color: entry.rank <= 3 ? colors.accent2 : colors.textMuted }}>
                    {entry.rank <= 3 ? (
                      <img
                        src={TROPHY_IMAGES[entry.rank]}
                        alt={`Rank ${entry.rank}`}
                        className="h-6 w-6"
                        draggable={false}
                      />
                    ) : (
                      entry.rank
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-sans text-sm font-extrabold" style={{ color: entry.isYou ? colors.accent : colors.text }}>
                      {entry.name}
                    </p>
                    {entry.subtitle && (
                      <p className="truncate font-sans text-[11px] font-semibold" style={{ color: colors.textMuted }}>
                        {entry.subtitle}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <div className="font-sans text-[16px] font-extrabold tracking-wide" style={{ color: colors.text }}>
                      {entry.score.toLocaleString()} pts
                    </div>
                    {claimablePrize > 0n ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleClaimPrize(entry.playerAddress);
                        }}
                        disabled={!!claimingPlayer}
                        className="inline-flex min-h-8 items-center rounded-lg bg-yellow-400 px-3 font-sans text-[11px] font-black text-black transition active:scale-95 disabled:cursor-wait disabled:opacity-60"
                      >
                        {isClaimingThisRow ? (
                          <span className="flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Claiming
                          </span>
                        ) : (
                          `Claim ${lamportsToSol(claimablePrize)} SOL`
                        )}
                      </button>
                    ) : entry.isYou && entry.winnerInfo ? (
                      <span className="rounded-full bg-white/10 px-2 py-1 font-sans text-[10px] font-black text-white/55">
                        Claimed
                      </span>
                    ) : entry.winnerInfo ? (
                      <span className="rounded-full bg-yellow-400/15 px-2 py-1 font-sans text-[10px] font-black text-yellow-200">
                        Winner
                      </span>
                    ) : null}
                  </div>
                </motion.div>
              );
            })}

            {/* Show user's rank if not visible in top 30 */}
            {myRank && !isMyRankVisible && (
              <>
                <div className="py-1 text-center font-sans text-[10px] text-white/30">···</div>
                <motion.div
                  custom={rankRows.length}
                  variants={rowVariants}
                  className="leaderboard-pulse flex items-center gap-3 rounded-2xl border px-4 py-3 backdrop-blur-xl"
                  style={{
                    "--pulse-base": `${colors.accent}20`,
                    "--pulse-bright": `${colors.accent}40`,
                    borderColor: `${colors.accent}AA`,
                  } as React.CSSProperties}
                >
                  <div className="flex w-8 items-center justify-center text-center font-sans text-base font-black" style={{ color: colors.accent }}>
                    {myRank.rank}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-sans text-sm font-extrabold" style={{ color: colors.accent }}>
                      {myRank.name}
                    </p>
                    <p className="truncate font-sans text-[11px] font-semibold" style={{ color: colors.textMuted }}>
                      Your rank in {activeTab === "daily" ? "classic games" : `tournament #${activeTournamentId}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="font-sans text-[16px] font-extrabold tracking-wide" style={{ color: colors.text }}>
                      {myRank.score.toLocaleString()} pts
                    </div>
                  </div>
                </motion.div>
              </>
            )}

            {/* Not ranked message */}
            {!myRank && normalizedAccount && rankRows.length > 0 && (
              <div className="mt-2 rounded-2xl border border-white/[0.10] bg-white/[0.04] px-4 py-3 text-center">
                <p className="font-sans text-xs font-semibold text-white/50">
                  {/* Daily leaderboard temporarily disabled */}
                  {activeTab === "daily"
                    ? "Daily leaderboard temporarily disabled - Solana migration in progress."
                    : "You're not ranked yet. Submit a tournament score to appear here!"}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default LeaderboardPage;
