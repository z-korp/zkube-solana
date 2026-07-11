import { Crown, Eye, Medal, Trophy } from "lucide-react";
import { motion } from "motion/react";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";
import { useRebootDaily } from "@/solana/reboot/useRebootDaily";
import { useNavigationStore } from "@/stores/navigationStore";
import GameCard from "@/ui/components/shared/GameCard";
import PageHeader from "@/ui/components/shared/PageHeader";
import ThemeBackground from "@/ui/components/shared/ThemeBackground";

export default function RebootLeaderboardPage() {
  const daily = useRebootDaily();
  const identity = useEmbeddedIdentity();
  const navigate = useNavigationStore((state) => state.navigate);
  const setSpectateTarget = useNavigationStore(
    (state) => state.setSpectateTarget,
  );
  const watch = (player: string, runId: bigint) => {
    setSpectateTarget({ player, runId: runId.toString() });
    navigate("spectate");
  };
  const entries = daily.daily?.leaderboard ?? [];
  const inBoard = entries.some((entry) =>
    entry.player.equals(identity.publicKey),
  );
  const ownBest = daily.daily?.player?.bestScore ?? null;
  return (
    <div className="relative min-h-full overflow-y-auto pb-28 pt-5 text-white">
      <ThemeBackground />
      <PageHeader title="Leaderboard" />
      <main className="relative z-10 mx-auto flex w-full max-w-2xl flex-col gap-4 px-4">
        <GameCard variant="glass" className="text-center">
          <Trophy className="mx-auto text-yellow-300" size={38} />
          <h2 className="mt-2 font-display text-2xl font-black">
            Daily Arena Top 10
          </h2>
          <p className="text-sm text-white/45">
            One best finalized score per embedded identity
          </p>
        </GameCard>
        <div className="flex flex-col gap-2">
          {entries.map((entry, index) => {
            const own = entry.player.equals(identity.publicKey);
            return (
              <motion.div
                key={entry.player.toBase58()}
                initial={{ opacity: 0, y: 14 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  ...(own
                    ? {
                        boxShadow: [
                          "0 0 0px rgba(34,211,238,0)",
                          "0 0 14px rgba(34,211,238,.45)",
                          "0 0 0px rgba(34,211,238,0)",
                        ],
                      }
                    : {}),
                }}
                transition={{
                  delay: index * 0.05,
                  type: "spring",
                  stiffness: 240,
                  damping: 22,
                  ...(own
                    ? { boxShadow: { repeat: Infinity, duration: 2.2 } }
                    : {}),
                }}
                className={`grid grid-cols-[3rem_1fr_auto_auto] items-center gap-2 rounded-2xl border px-4 py-3 ${own ? "border-cyan-300/40 bg-cyan-500/15" : index < 3 ? "border-yellow-300/20 bg-yellow-500/[0.08]" : "border-white/10 bg-black/35"}`}
              >
                <span className="grid place-items-center text-lg font-black">
                  {index === 0 ? (
                    <Crown className="text-yellow-300" />
                  ) : index < 3 ? (
                    <Medal
                      className={
                        index === 1 ? "text-slate-300" : "text-orange-400"
                      }
                    />
                  ) : (
                    `#${index + 1}`
                  )}
                </span>
                <span className="truncate font-mono text-xs text-white/60">
                  {own ? "You · " : ""}
                  {shortKey(entry.player.toBase58())}
                </span>
                <strong className="font-display text-xl text-cyan-200">
                  {entry.score}
                </strong>
                <button
                  onClick={() => watch(entry.player.toBase58(), entry.runId)}
                  aria-label="Watch this run"
                  className="rounded-full border border-white/15 bg-black/30 p-1.5 text-white/55 transition hover:text-white"
                >
                  <Eye size={14} />
                </button>
              </motion.div>
            );
          })}
          {!daily.loading && !inBoard && ownBest !== null && ownBest > 0 && (
            <div className="grid grid-cols-[3rem_1fr_auto] items-center rounded-2xl border border-cyan-300/40 bg-cyan-500/15 px-4 py-3">
              <span className="grid place-items-center text-sm font-black text-white/60">
                —
              </span>
              <span className="truncate font-mono text-xs text-white/60">
                You · outside the top 10
              </span>
              <strong className="font-display text-xl text-cyan-200">
                {ownBest.toString()}
              </strong>
            </div>
          )}
          {!daily.loading &&
            entries.length > 0 &&
            !inBoard &&
            (ownBest === null || ownBest === 0) && (
              <p className="pt-2 text-center text-xs text-white/45">
                You’re not ranked yet — enter today’s Daily to claim a spot.
              </p>
            )}
          {!daily.loading && entries.length === 0 && (
            <GameCard
              variant="glass"
              className="py-10 text-center text-white/45"
            >
              No finalized scores yet.
            </GameCard>
          )}
          {daily.loading && (
            <p className="animate-pulse text-center text-white/45">
              Loading Daily leaderboard…
            </p>
          )}
        </div>
        {daily.error && (
          <p className="text-center text-xs text-red-300">{daily.error}</p>
        )}
      </main>
    </div>
  );
}

function shortKey(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}
