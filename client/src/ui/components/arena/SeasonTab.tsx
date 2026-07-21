import { CalendarRange, Trophy } from "lucide-react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { currentSeasonId } from "@/chain/seasonClient";
import { useSeason } from "@/contexts/season";
import { TROPHY_IMAGES } from "@/ui/components/arena/leaderboardMedals";
import { playerLabelWithWallet } from "@/ui/components/arena/leaderboardName";
import EmptyState from "@/ui/components/shared/EmptyState";
import { Spinner } from "@/ui/components/shared/LoadingState";
import StatTile from "@/ui/components/shared/StatTile";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { formatSolLamports } from "@/utils/currency";
import { formatDurationCoarse } from "@/utils/time";

export default function SeasonTab() {
  const colors = useThemeColors();
  const owner = useConnectedPlayer().publicKey;
  const controller = useSeason();
  const season = controller.season;

  if (controller.loading && !season) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }
  if (!season) {
    return (
      <EmptyState
        compact
        icon={<Trophy className="h-8 w-8" />}
        title="Season is being prepared"
        hint="The keeper prepares and funds the following Season before it opens."
      />
    );
  }

  const now = Math.floor(Date.now() / 1_000);
  const current = season.seasonId === currentSeasonId(now);
  const timing =
    current && season.closesAt > now
      ? `Ends in ${formatDurationCoarse(season.closesAt - now)}`
      : season.status === "finalized"
        ? "Finalized · payouts pushed"
        : "Finalizing";

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3">
      <section className="rounded-2xl border border-violet-300/20 bg-violet-300/[0.08] p-4 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <CalendarRange className="mt-0.5 shrink-0 text-violet-200" />
            <div>
              <p className="font-display text-xl font-black text-white">28-day Season</p>
              <p className="mt-1 text-xs font-semibold text-white/55">{timing} · best 20 Daily bands count</p>
            </div>
          </div>
          <span className="rounded-full border border-violet-200/20 px-2 py-1 text-[9px] font-black text-violet-100">{season.sealedDailies}/28 SEALED</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <StatTile size="sm" label="Active guaranteed" value={`${formatSolLamports(season.activePotLamports)} SOL`} className="border-transparent bg-black/20" />
          <StatTile size="sm" label="Following Season" value={season.followingSeasonLamports === null ? "Being prepared" : `${formatSolLamports(season.followingSeasonLamports)} SOL`} className="border-transparent bg-black/20" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Rule label="Daily band points" value="100 / 60 / 30 / 10 / 2" />
          <Rule label="Payout" value="Top 5 · 45/25/15/10/5" />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-white/50">Payouts are pushed automatically. Empty allocations and 0.001 SOL rounding dust feed the following Season.</p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Your counted Dailies</p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <p className="font-display text-2xl font-black text-white">{season.player?.points ?? 0} pts</p>
            <p className="text-[11px] font-semibold text-white/45">{season.player?.resultCount ?? 0}/20 best results recorded</p>
          </div>
          {season.player?.results[0] && (
            <p className="text-right text-[11px] font-bold text-violet-200">Best band<br />#{season.player.results[0].rank} · {season.player.results[0].points} pts</p>
          )}
        </div>
      </section>

      {season.leaderboard.length === 0 ? (
        <EmptyState compact icon={<Trophy className="h-8 w-8" />} title="No Season points yet" hint="Finalized Daily ranks are rolled into the 28-day board." />
      ) : (
        <section className="space-y-2">
          <p className="px-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Season standings</p>
          {season.leaderboard.map((entry, index) => {
            const rank = index + 1;
            const isYou = Boolean(owner?.equals(entry.player));
            return (
              <div key={entry.player.toBase58()} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3">
                <div className="flex w-7 justify-center font-black" style={{ color: colors.accent2 }}>
                  {rank <= 3 ? <img src={TROPHY_IMAGES[rank]} alt={`Rank ${rank}`} className="h-6 w-6" /> : rank}
                </div>
                <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-white">
                  {isYou ? "You · " : ""}{playerLabelWithWallet(entry.playerName, entry.player.toBase58())}
                </span>
                <span className="font-black tabular-nums text-white">{entry.points} pts</span>
              </div>
            );
          })}
        </section>
      )}
      {controller.error && <p className="text-center text-xs text-red-300">{controller.error}</p>}
    </div>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[9px] font-black uppercase tracking-wider text-white/35">{label}</p><p className="mt-1 text-xs font-black text-white">{value}</p></div>;
}
