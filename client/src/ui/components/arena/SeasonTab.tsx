import { Fragment } from "react";
import { Timer, Trophy } from "lucide-react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { currentSeasonId } from "@/chain/seasonClient";
import { useSeason } from "@/contexts/season";
import {
  PaidCutLine,
  RankMedal,
} from "@/ui/components/arena/LeaderboardRow";
import { playerLabelWithWallet } from "@/ui/components/arena/leaderboardName";
import {
  GuardianFaceBlock,
  MONEY_GOLD,
  SEASON_WEIGHTS,
  SolMark,
  computePayouts,
} from "@/ui/components/economy";
import EmptyState from "@/ui/components/shared/EmptyState";
import InfoTip from "@/ui/components/shared/InfoTip";
import { Spinner } from "@/ui/components/shared/LoadingState";
import { useCountdown } from "@/hooks/useNowTick";
import { formatSolBalanceLamports } from "@/utils/currency";
import { formatCountdown } from "@/utils/time";

const PANEL_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, #131F35 0%, #0D1626 100%)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow:
    "0 12px 30px rgba(0,0,0,0.4), inset 0 1.5px 0 rgba(255,255,255,0.09)",
};

const YOU_RING: React.CSSProperties = {
  border: "1px solid #FACC15",
  background: "rgba(250,204,21,0.10)",
  boxShadow: "0 0 12px rgba(250,204,21,0.25)",
};

const HEAD_CLASS =
  "font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white/30";

/**
 * The Season floor: pot line, your three numbers, and the same titled and
 * columned leaderboard as the Daily — top five priced, your row below when
 * you sit outside them. The banding table lives in the ? popup.
 */
interface SeasonTabProps {
  /** Today's zone, for the guardian block on the pot panel. */
  zoneId?: number;
}

export default function SeasonTab({ zoneId }: SeasonTabProps = {}) {
  const owner = useConnectedPlayer().publicKey;
  const controller = useSeason();
  const season = controller.season;
  const closeSeconds = useCountdown(season?.closesAt);

  if (controller.loading && !season) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
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
  const statusChip =
    current && closeSeconds > 0 ? (
      <span className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-2.5 py-1.5 font-mono text-[11px] font-bold tabular-nums text-white">
        <Timer size={12} className="text-white/50" />
        {formatCountdown(closeSeconds)}
      </span>
    ) : (
      <span className="rounded-full border border-white/[0.08] bg-black/40 px-2.5 py-1.5 font-mono text-[11px] font-bold text-white">
        {season.status === "finalized" ? "PAID" : "FINALIZING"}
      </span>
    );

  const rows = season.leaderboard;
  const payouts = computePayouts(
    season.activePotLamports,
    SEASON_WEIGHTS,
    rows.length,
  );
  const myIndex = owner
    ? rows.findIndex((entry) => owner.equals(entry.player))
    : -1;
  const bestBand = season.player?.results[0] ?? null;

  const rowFor = (index: number, withDivider: boolean) => {
    const entry = rows[index];
    const rank = index + 1;
    const isYou = index === myIndex;
    const prize = payouts[index] ?? 0n;
    return (
      <div
        key={rank}
        className={`flex items-center gap-2.5 px-2 py-2.5 ${
          isYou
            ? "rounded-xl"
            : withDivider
              ? "border-t border-white/[0.05]"
              : ""
        }`}
        style={isYou ? YOU_RING : undefined}
      >
        <RankMedal rank={rank} />
        <span className="min-w-0 flex-1 truncate text-left font-sans text-[15px] font-bold text-white/90">
          {isYou
            ? "You"
            : entry
              ? (entry.playerName ??
                playerLabelWithWallet(null, entry.player.toBase58()))
              : "—"}
        </span>
        <span className="w-16 flex-none text-right font-mono text-[15px] font-bold tabular-nums text-white">
          {entry ? entry.points : ""}
        </span>
        <span className="flex w-[72px] flex-none items-center justify-end gap-1">
          {prize > 0n && (
            <span
              className="money flex items-center gap-1 font-mono text-[15px] font-bold tabular-nums"
              style={{ color: MONEY_GOLD }}
            >
              {formatSolBalanceLamports(prize)}
              <SolMark size={10} />
            </span>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3">
      <section className="rounded-2xl p-3.5" style={PANEL_STYLE}>
        <div className="flex items-center gap-2.5">
          {zoneId !== undefined && (
            <GuardianFaceBlock zoneId={zoneId} size={44} />
          )}
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className="money flex-none font-display text-[32px] leading-none tabular-nums"
              style={{ color: MONEY_GOLD }}
            >
              {formatSolBalanceLamports(season.activePotLamports)}
            </span>
            <SolMark size={15} />
            <span className="ml-1 truncate font-sans text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">
              season pot
            </span>
          </div>
          {statusChip}
          <InfoTip label="Season rules">
            Each finalized Daily pays one band: 100 / 60 / 30 / 10 / 2 pts by
            rank; your best 20 count over the 28 days
            ({season.sealedDailies}/28 sealed). The top 5 split the pot
            45 / 25 / 15 / 10 / 5%, floored to 0.001 SOL.
          </InfoTip>
        </div>
        <div className="mt-2.5 flex gap-1.5">
          <span className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-2.5 py-1.5 font-mono text-[11px] font-bold tabular-nums text-white">
            {season.player?.points ?? 0} pts
          </span>
          <span className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-2.5 py-1.5 font-mono text-[11px] font-bold tabular-nums text-white">
            {season.player?.resultCount ?? 0}/20 counted
          </span>
          <span className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-2.5 py-1.5 font-mono text-[11px] font-bold tabular-nums text-white">
            {bestBand ? `#${bestBand.rank} best rank` : "— best rank"}
          </span>
        </div>
      </section>

      <section className="rounded-2xl p-3.5" style={PANEL_STYLE}>
        <p className="font-sans text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
          Leaderboard
        </p>
        <div className="mt-1 flex items-center gap-2.5 px-2 pb-1">
          <span className={`${HEAD_CLASS} w-5`}>#</span>
          <span className={`${HEAD_CLASS} flex-1`}>Player</span>
          <span className={`${HEAD_CLASS} w-16 text-right`}>Pts</span>
          <span className={`${HEAD_CLASS} w-[72px] text-right`}>Prize</span>
        </div>

        {Array.from({ length: SEASON_WEIGHTS.length }, (_, index) =>
          rowFor(index, index > 0),
        )}

        {myIndex >= SEASON_WEIGHTS.length && (
          <Fragment>
            <PaidCutLine />
            {rowFor(myIndex, false)}
          </Fragment>
        )}

        {rows.length === 0 && (
          <p className="mt-1 border-t border-white/[0.05] px-2 pt-2 text-center font-sans text-xs font-semibold text-white/50">
            No Season points yet — finalized Daily ranks roll in here.
          </p>
        )}
      </section>
      {controller.error && (
        <p className="text-center text-xs text-red-300">{controller.error}</p>
      )}
    </div>
  );
}
