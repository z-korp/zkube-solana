import { useMemo } from "react";
import { Crosshair, Layers3, Trophy, Zap } from "lucide-react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { currentWeeklyId } from "@/chain/weeklyClient";
import { useWeekly } from "@/contexts/weekly";
import BoardPotHeader from "@/ui/components/arena/BoardPotHeader";
import { Countdown } from "@/ui/components/arena/Countdown";
import LeaderboardRow from "@/ui/components/arena/LeaderboardRow";
import { playerLabelWithWallet } from "@/ui/components/arena/leaderboardName";
import { useLeaderboardEmblems } from "@/ui/components/arena/useLeaderboardEmblems";
import { WEEKLY_WEIGHTS, computePayouts } from "@/ui/components/economy";
import EmptyState from "@/ui/components/shared/EmptyState";
import { Spinner } from "@/ui/components/shared/LoadingState";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";

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

  // Batch every visible owner's emblem in one read (hooks stay unconditional).
  const visibleOwners = useMemo(() => {
    const owners: string[] = [];
    for (const board of weekly?.boards ?? []) {
      for (const entry of board.slice(0, 3)) owners.push(entry.player.toBase58());
    }
    return owners;
  }, [weekly]);
  const emblems = useLeaderboardEmblems(visibleOwners);

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
    current && weekly.closesAt > now ? (
      <Countdown endTime={weekly.closesAt} colors={colors} />
    ) : (
      <span className="rounded-full bg-white/60 px-3 py-1.5 font-sans text-xs font-bold text-black">
        {weekly.status === "finalized" ? "PAYOUTS PUSHED" : "FINALIZING"}
      </span>
    );

  // Each board competes for an equal third of the guaranteed pot.
  const perBoardPot = weekly.activePotLamports / 3n;

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3">
      <BoardPotHeader
        label="This week's skill pot"
        potLamports={weekly.activePotLamports}
        followingLamports={weekly.followingWeeklyLamports}
        followingLabel="Building next Weekly"
        timing={timing}
      >
        <p className="text-xs leading-relaxed text-white/55">
          Split equally across three skill boards — each pays 60 / 25 / 15,
          floored to 0.001 SOL. Dust rolls forward; winners never claim.
        </p>
      </BoardPotHeader>

      <div className="grid gap-2">
        {BOARD_CATEGORIES.map(({ label, icon: Icon }, boardIndex) => {
          const metricLabel = weekly.metricLabels[boardIndex];
          const rows = weekly.boards[boardIndex].slice(0, 3);
          const payouts = computePayouts(perBoardPot, WEEKLY_WEIGHTS, rows.length);
          return (
            <section
              key={label}
              className="rounded-2xl border border-white/10 bg-white/[0.05] p-3"
            >
              <div className="flex items-center gap-3">
                <div
                  className="rounded-xl bg-white/[0.06] p-2"
                  style={{ color: colors.accent }}
                >
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-white">{label}</p>
                  <p className="text-[11px] font-semibold text-white/45">
                    {metricLabel} · fixed at open
                  </p>
                </div>
                <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] font-black text-white/45">
                  TOP 3
                </span>
              </div>
              {rows.length === 0 ? (
                <p className="mt-3 rounded-xl bg-black/15 px-3 py-2 text-center text-[11px] font-semibold text-white/35">
                  No ranked result for this metric yet
                </p>
              ) : (
                <div className="mt-3 space-y-1.5">
                  {rows.map((entry, index) => {
                    const rank = index + 1;
                    const address = entry.player.toBase58();
                    const isYou = Boolean(owner?.equals(entry.player));
                    return (
                      <LeaderboardRow
                        key={`${address}-${entry.runId}`}
                        rank={rank}
                        emblem={emblems.get(address)}
                        isYou={isYou}
                        name={`${isYou ? "You · " : ""}${playerLabelWithWallet(
                          entry.playerName,
                          address,
                        )}`}
                        primary={entry.value.toString()}
                        prizeLamports={payouts[index]}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {controller.error && (
        <p className="text-center text-xs text-red-300">{controller.error}</p>
      )}
    </div>
  );
}
