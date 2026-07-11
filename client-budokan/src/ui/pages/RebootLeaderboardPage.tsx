import { Crown, Medal, Trophy } from "lucide-react";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";
import { useRebootDaily } from "@/solana/reboot/useRebootDaily";
import GameCard from "@/ui/components/shared/GameCard";
import PageHeader from "@/ui/components/shared/PageHeader";
import ThemeBackground from "@/ui/components/shared/ThemeBackground";

export default function RebootLeaderboardPage() {
  const daily = useRebootDaily();
  const identity = useEmbeddedIdentity();
  const entries = daily.daily?.leaderboard ?? [];
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
              <div
                key={entry.player.toBase58()}
                className={`grid grid-cols-[3rem_1fr_auto] items-center rounded-2xl border px-4 py-3 ${own ? "border-cyan-300/40 bg-cyan-500/15" : index < 3 ? "border-yellow-300/20 bg-yellow-500/[0.08]" : "border-white/10 bg-black/35"}`}
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
              </div>
            );
          })}
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
