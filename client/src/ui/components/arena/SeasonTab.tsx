import { Fragment, useMemo } from "react";
import { Trophy } from "lucide-react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { currentSeasonId } from "@/chain/seasonClient";
import { useSeason } from "@/contexts/season";
import BoardPotHeader from "@/ui/components/arena/BoardPotHeader";
import { Countdown } from "@/ui/components/arena/Countdown";
import LeaderboardRow, {
  PaidCutLine,
} from "@/ui/components/arena/LeaderboardRow";
import { playerLabelWithWallet } from "@/ui/components/arena/leaderboardName";
import { useLeaderboardEmblems } from "@/ui/components/arena/useLeaderboardEmblems";
import { SEASON_WEIGHTS, computePayouts } from "@/ui/components/economy";
import EmptyState from "@/ui/components/shared/EmptyState";
import { Spinner } from "@/ui/components/shared/LoadingState";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";

export default function SeasonTab() {
  const colors = useThemeColors();
  const owner = useConnectedPlayer().publicKey;
  const controller = useSeason();
  const season = controller.season;

  // Batch every standings owner's emblem in one read (hooks stay unconditional).
  const visibleOwners = useMemo(
    () => (season?.leaderboard ?? []).map((entry) => entry.player.toBase58()),
    [season],
  );
  const emblems = useLeaderboardEmblems(visibleOwners);

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
    current && season.closesAt > now ? (
      <Countdown endTime={season.closesAt} colors={colors} />
    ) : (
      <span className="rounded-full bg-white/60 px-3 py-1.5 font-sans text-xs font-bold text-black">
        {season.status === "finalized" ? "PAYOUTS PUSHED" : "FINALIZING"}
      </span>
    );

  const payouts = computePayouts(
    season.activePotLamports,
    SEASON_WEIGHTS,
    season.leaderboard.length,
  );

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3">
      <BoardPotHeader
        label="This Season's pot"
        potLamports={season.activePotLamports}
        followingLamports={season.followingSeasonLamports}
        followingLabel="Building next Season"
        timing={timing}
      >
        <div className="grid grid-cols-2 gap-2">
          <Note label="Daily band → points" value="100 / 60 / 30 / 10 / 2" />
          <Note label="Payout · top 5" value="45 / 25 / 15 / 10 / 5" />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/50">
          Your best 20 Daily bands count over the 28-day Season
          {" · "}
          {season.sealedDailies}/28 sealed. Payouts are pushed automatically;
          empty allocations and rounding dust feed the next Season.
        </p>
      </BoardPotHeader>

      <section className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">
          Your counted Dailies
        </p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <p className="font-display text-2xl font-black text-white">
              {season.player?.points ?? 0} pts
            </p>
            <p className="text-[11px] font-semibold text-white/45">
              {season.player?.resultCount ?? 0}/20 best results recorded
            </p>
          </div>
          {season.player?.results[0] && (
            <p className="text-right text-[11px] font-bold" style={{ color: colors.accent }}>
              Best band
              <br />#{season.player.results[0].rank} ·{" "}
              {season.player.results[0].points} pts
            </p>
          )}
        </div>
      </section>

      {season.leaderboard.length === 0 ? (
        <EmptyState
          compact
          icon={<Trophy className="h-8 w-8" />}
          title="No Season points yet"
          hint="Finalized Daily ranks are rolled into the 28-day board."
        />
      ) : (
        <section className="space-y-2">
          <p className="px-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/40">
            Season standings
          </p>
          {season.leaderboard.map((entry, index) => {
            const rank = index + 1;
            const address = entry.player.toBase58();
            const isYou = Boolean(owner?.equals(entry.player));
            const paying = index < SEASON_WEIGHTS.length;
            return (
              <Fragment key={address}>
                {index === SEASON_WEIGHTS.length && <PaidCutLine />}
                <LeaderboardRow
                  rank={rank}
                  emblem={emblems.get(address)}
                  isYou={isYou}
                  name={`${isYou ? "You · " : ""}${playerLabelWithWallet(
                    entry.playerName,
                    address,
                  )}`}
                  primary={`${entry.points} pts`}
                  prizeLamports={paying ? payouts[index] : 0n}
                  dimmed={!paying}
                />
              </Fragment>
            );
          })}
        </section>
      )}
      {controller.error && (
        <p className="text-center text-xs text-red-300">{controller.error}</p>
      )}
    </div>
  );
}

function Note({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-[9px] font-black uppercase tracking-wider text-white/35">
        {label}
      </p>
      <p className="mt-1 text-xs font-black tabular-nums text-white">{value}</p>
    </div>
  );
}
