import { Crosshair, Layers3, Trophy, Zap } from "lucide-react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { currentWeeklyId } from "@/chain/weeklyClient";
import { useWeekly } from "@/contexts/weekly";
import { playerLabelWithWallet } from "@/ui/components/arena/leaderboardName";
import EmptyState from "@/ui/components/shared/EmptyState";
import { Spinner } from "@/ui/components/shared/LoadingState";
import StatTile from "@/ui/components/shared/StatTile";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { formatSolLamports } from "@/utils/currency";
import { formatDurationCoarse } from "@/utils/time";

const BOARD_CATEGORIES = [
  { label: "Combo", icon: Layers3 },
  { label: "Single action", icon: Zap },
  { label: "Full run", icon: Crosshair },
] as const;

export default function WeeklyTab() {
  const colors = useThemeColors();
  const controller = useWeekly();
  const owner = useConnectedPlayer().publicKey;
  const weekly = controller.weekly;

  if (controller.loading && !weekly) {
    return <div className="flex justify-center py-12"><Spinner /></div>;
  }
  if (!weekly) {
    return (
      <EmptyState
        compact
        icon={<Trophy className="h-8 w-8" />}
        title="Weekly is being prepared"
        hint="The keeper prepares and funds the next Weekly before it opens."
      />
    );
  }

  const now = Math.floor(Date.now() / 1_000);
  const current = weekly.weeklyId === currentWeeklyId(now);
  const timing =
    current && weekly.closesAt > now
      ? `Ends in ${formatDurationCoarse(weekly.closesAt - now)}`
      : weekly.status === "finalized"
        ? "Finalized · payouts pushed"
        : "Finalizing";

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3">
      <section className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-xl font-black text-white">Weekly skill bounties</p>
            <p className="mt-1 text-xs font-semibold text-white/55">{timing} · one metric from each category</p>
          </div>
          <Trophy className="h-7 w-7" style={{ color: colors.accent2 }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <StatTile size="sm" label="Active guaranteed" value={`${formatSolLamports(weekly.activePotLamports)} SOL`} className="border-transparent bg-black/20" />
          <StatTile size="sm" label="Following Weekly" value={weekly.followingWeeklyLamports === null ? "Pending rules" : `${formatSolLamports(weekly.followingWeeklyLamports)} SOL`} className="border-transparent bg-black/20" />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-white/55">
          The active pot is split equally across three boards. Each board pays 60/25/15, rounded down; dust rolls forward. Winners never claim.
        </p>
      </section>

      <div className="grid gap-2">
        {BOARD_CATEGORIES.map(({ label, icon: Icon }, boardIndex) => {
          const metricLabel = weekly.metricLabels[boardIndex];
          const rows = weekly.boards[boardIndex];
          return (
          <section key={label} className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white/[0.06] p-2" style={{ color: colors.accent }}><Icon size={18} /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-white">{label}</p>
                <p className="text-[11px] font-semibold text-white/45">{metricLabel} · fixed at open</p>
              </div>
              <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] font-black text-white/45">TOP 3</span>
            </div>
            {rows.length === 0 ? (
              <p className="mt-3 rounded-xl bg-black/15 px-3 py-2 text-center text-[11px] font-semibold text-white/35">No ranked result for this metric yet</p>
            ) : (
              <div className="mt-3 space-y-1.5">
                {rows.slice(0, 3).map((entry, index) => {
                  const rank = index + 1;
                  const isYou = Boolean(owner?.equals(entry.player));
                  return (
                    <div key={`${entry.player.toBase58()}-${entry.runId}`} className="flex items-center gap-2 rounded-xl bg-black/15 px-3 py-2">
                      <span className="w-5 text-center text-xs font-black" style={{ color: colors.accent2 }}>#{rank}</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-extrabold text-white/80">{isYou ? "You · " : ""}{playerLabelWithWallet(entry.playerName, entry.player.toBase58())}</span>
                      <span className="text-sm font-black tabular-nums text-white">{entry.value.toString()}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          );
        })}
      </div>
      {controller.error && <p className="text-center text-xs text-red-300">{controller.error}</p>}
    </div>
  );
}
