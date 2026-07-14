import { useCallback, useMemo } from "react";
import { Eye, Loader2, Trophy } from "lucide-react";
import { motion } from "motion/react";

import { getThemeColors } from "@/config/themes";
import { useDaily } from "@/contexts/daily";
import useAccount from "@/hooks/useAccount";
import { useCurrentChallenge } from "@/hooks/useCurrentChallenge";
import { useDailyLeaderboard } from "@/hooks/useDailyLeaderboard";
import { usePlayerEntry } from "@/hooks/usePlayerEntry";
import { useNavigationStore } from "@/stores/navigationStore";
import PageHeader from "@/ui/components/shared/PageHeader";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { truncatePublicKey } from "@/utils/solanaDisplay";

const TROPHY_IMAGES: Record<number, string> = {
  1: "/assets/common/trophies/gold.png",
  2: "/assets/common/trophies/silver.png",
  3: "/assets/common/trophies/bronze.png",
};

const rowVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: (index: number) => ({
    opacity: 1,
    x: 0,
    transition: {
      delay: index * 0.04,
      type: "spring" as const,
      stiffness: 300,
      damping: 24,
    },
  }),
};

const LeaderboardPage: React.FC = () => {
  const { themeTemplate } = useTheme();
  const colors = getThemeColors(themeTemplate);
  const { address } = useAccount();
  const daily = useDaily();
  const { challenge } = useCurrentChallenge();
  const { entries: dailyEntries, isLoading } = useDailyLeaderboard(
    challenge?.challenge_id,
  );
  const loading = daily.loading || isLoading;
  const { entry: playerEntry } = usePlayerEntry(
    challenge?.challenge_id,
    address,
  );
  const navigate = useNavigationStore((state) => state.navigate);
  const setSpectateTarget = useNavigationStore(
    (state) => state.setSpectateTarget,
  );

  const rankRows = useMemo(
    () =>
      dailyEntries.slice(0, 30).map((entry) => ({
        id: `daily-${entry.rank}`,
        rank: entry.rank,
        name: truncatePublicKey(entry.player),
        score: entry.featuredScore ?? entry.score,
        engineScore: entry.engineScore ?? entry.score,
        moves: entry.moves ?? 0,
        playerAddress: entry.player,
        runId: entry.runId,
        isYou: address === entry.player,
      })),
    [address, dailyEntries],
  );

  const visiblePlayerRank = useMemo(() => {
    const ranked = dailyEntries.find((entry) => entry.player === address);
    if (ranked) {
      return {
        rank: ranked.rank,
        score: ranked.featuredScore ?? ranked.score,
        name: `You · ${truncatePublicKey(address)}`,
      };
    }
    if (
      playerEntry &&
      playerEntry.rank > 0 &&
      (playerEntry.bestFeaturedScore ?? playerEntry.bestScore) > 0
    ) {
      return {
        rank: playerEntry.rank,
        score: playerEntry.bestFeaturedScore ?? playerEntry.bestScore,
        name: `You · ${truncatePublicKey(address)}`,
      };
    }
    return null;
  }, [address, dailyEntries, playerEntry]);

  const isMyRankVisible = rankRows.some((row) => row.isYou);
  const watch = useCallback(
    (player: string, runId: bigint) => {
      setSpectateTarget({ player, runId: runId.toString() });
      navigate("spectate");
    },
    [navigate, setSpectateTarget],
  );

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
          <div className="relative z-10 flex-1 rounded-full px-3 py-1.5 text-center font-sans text-[12px] font-bold uppercase tracking-wide text-white">
            <motion.div
              layoutId="leaderboard-tab-indicator"
              className="absolute inset-0 rounded-full border border-white/[0.08] bg-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]"
              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
            />
            <span className="relative z-20 drop-shadow-sm">Daily Scores</span>
          </div>
        </div>
      </div>

      <div className="mx-4 mb-4 mt-2 min-h-0 flex-1 overflow-y-auto hide-scrollbar">
        {loading ? (
          <div
            className="flex flex-col items-center justify-center py-16"
            style={{ color: colors.textMuted }}
          >
            <Loader2
              className="mb-4 h-8 w-8 animate-spin"
              style={{ color: colors.accent }}
            />
            <p className="font-sans text-sm font-medium">Loading rankings...</p>
          </div>
        ) : rankRows.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-16 text-center"
            style={{ color: colors.textMuted }}
          >
            <Trophy className="mb-4 h-12 w-12 opacity-50" />
            <p
              className="mb-1 font-sans text-xl font-semibold"
              style={{ color: colors.text }}
            >
              No entries yet
            </p>
            <p className="font-sans text-base">
              Finish a run to claim rank #1.
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            className="mx-auto max-w-[640px] space-y-2"
          >
            {rankRows.map((entry, index) => {
              const baseBg =
                entry.rank === 1
                  ? "rgba(255,215,0,0.2)"
                  : entry.rank === 2
                    ? "rgba(192,192,192,0.18)"
                    : entry.rank === 3
                      ? "rgba(205,127,50,0.18)"
                      : "rgba(255,255,255,0.1)";
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
                  onClick={() => watch(entry.playerAddress, entry.runId)}
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 backdrop-blur-xl transition-all active:scale-[0.98] ${entry.isYou ? "leaderboard-pulse" : ""}`}
                  style={{
                    ...(entry.isYou
                      ? ({
                          "--pulse-base": pulseBase,
                          "--pulse-bright": pulseBright,
                        } as React.CSSProperties)
                      : { backgroundColor: baseBg }),
                    borderColor: entry.isYou
                      ? `${colors.accent}AA`
                      : entry.rank <= 3
                        ? "rgba(255,255,255,0.3)"
                        : "rgba(255,255,255,0.14)",
                  }}
                >
                  <div
                    className="flex w-8 items-center justify-center text-center font-sans text-base font-black"
                    style={{
                      color:
                        entry.rank <= 3 ? colors.accent2 : colors.textMuted,
                    }}
                  >
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
                    <p
                      className="truncate font-sans text-sm font-extrabold"
                      style={{
                        color: entry.isYou ? colors.accent : colors.text,
                      }}
                    >
                      {entry.isYou ? `You · ${entry.name}` : entry.name}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div
                      className="font-sans text-[16px] font-extrabold tracking-wide"
                      style={{ color: colors.text }}
                    >
                      {entry.score.toLocaleString()} featured
                    </div>
                    <span className="font-sans text-[10px] text-white/40">
                      {entry.engineScore.toLocaleString()} engine ·{" "}
                      {entry.moves} moves
                    </span>
                    <Eye size={15} style={{ color: colors.textMuted }} />
                  </div>
                </motion.div>
              );
            })}

            {visiblePlayerRank && !isMyRankVisible && (
              <>
                <div className="py-1 text-center font-sans text-[10px] text-white/30">
                  ···
                </div>
                <motion.div
                  custom={rankRows.length}
                  variants={rowVariants}
                  className="leaderboard-pulse flex items-center gap-3 rounded-2xl border px-4 py-3 backdrop-blur-xl"
                  style={
                    {
                      "--pulse-base": `${colors.accent}20`,
                      "--pulse-bright": `${colors.accent}40`,
                      borderColor: `${colors.accent}AA`,
                    } as React.CSSProperties
                  }
                >
                  <div
                    className="flex w-8 items-center justify-center text-center font-sans text-base font-black"
                    style={{ color: colors.accent }}
                  >
                    {visiblePlayerRank.rank}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate font-sans text-sm font-extrabold"
                      style={{ color: colors.accent }}
                    >
                      {visiblePlayerRank.name}
                    </p>
                  </div>
                  <div
                    className="font-sans text-[16px] font-extrabold tracking-wide"
                    style={{ color: colors.text }}
                  >
                    {visiblePlayerRank.score.toLocaleString()} pts
                  </div>
                </motion.div>
              </>
            )}

            {!visiblePlayerRank && rankRows.length > 0 && (
              <div className="mt-2 rounded-2xl border border-white/[0.10] bg-white/[0.04] px-4 py-3 text-center">
                <p className="font-sans text-xs font-semibold text-white/50">
                  You&apos;re not ranked yet. Finish a run to appear here!
                </p>
              </div>
            )}
          </motion.div>
        )}
        {daily.error && (
          <p className="mt-3 text-center text-xs text-red-300">{daily.error}</p>
        )}
      </div>
    </div>
  );
};

export default LeaderboardPage;
