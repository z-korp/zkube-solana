import { Fragment } from "react";

import type { DailyView } from "@/chain/dailyClient";
import { seasonPointsForDailyRank } from "@/ui/components/arcade/seasonBands";
import {
  PaidCutLine,
  RankMedal,
} from "@/ui/components/arena/LeaderboardRow";
import { playerLabelWithWallet } from "@/ui/components/arena/leaderboardName";
import {
  DAILY_WEIGHTS,
  MONEY_GOLD,
  SolMark,
  computePayouts,
} from "@/ui/components/economy";
import { formatSolBalanceLamports } from "@/utils/currency";

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

interface DailyBoardProps {
  view: DailyView;
  /** Connected wallet base58, for the gold ring and your below-cut row. */
  address: string | null;
}

/**
 * The prize ladder IS the leaderboard: five rungs, always priced from the
 * live pot whether or not anyone holds them — rank, the Season points that
 * rank earns today, holder, score, potential earnings. Nothing renders below
 * the prize zone except the connected player's own row when they sit outside
 * it, so they always know where they stand. The percentage split lives in
 * the ? popup.
 */
const DailyBoard: React.FC<DailyBoardProps> = ({ view, address }) => {
  const payouts = computePayouts(view.dailyPotLamports, [...DAILY_WEIGHTS]);
  const rows = view.leaderboard;
  const myIndex = address
    ? rows.findIndex((entry) => entry.player.toBase58() === address)
    : -1;
  const scoreablePlayers = Math.max(view.uniquePlayers, rows.length);

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
        <span
          className="w-10 flex-none font-mono text-[12px] font-bold tabular-nums"
          style={{ color: MONEY_GOLD }}
        >
          +{seasonPointsForDailyRank(rank, scoreablePlayers)}
        </span>
        <span className="min-w-0 flex-1 truncate text-left font-sans text-[15px] font-bold text-white/90">
          {isYou
            ? "You"
            : entry
              ? (entry.playerName ??
                playerLabelWithWallet(null, entry.player.toBase58()))
              : "—"}
        </span>
        <span className="w-20 flex-none text-right font-mono text-[15px] font-bold tabular-nums text-white">
          {entry ? entry.dailyScore.toLocaleString() : ""}
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
    <section className="rounded-2xl p-3.5" style={PANEL_STYLE}>
      <p className="font-sans text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
        Leaderboard
      </p>
      <div className="mt-1 flex items-center gap-2.5 px-2 pb-1">
        <span className={`${HEAD_CLASS} w-5`}>#</span>
        <span className={`${HEAD_CLASS} w-10`}>Pts</span>
        <span className={`${HEAD_CLASS} flex-1`}>Player</span>
        <span className={`${HEAD_CLASS} w-20 text-right`}>Score</span>
        <span className={`${HEAD_CLASS} w-[72px] text-right`}>Prize</span>
      </div>

      {Array.from({ length: DAILY_WEIGHTS.length }, (_, index) =>
        rowFor(index, index > 0),
      )}

      {myIndex >= DAILY_WEIGHTS.length && (
        <Fragment>
          <PaidCutLine />
          {rowFor(myIndex, false)}
        </Fragment>
      )}

      {rows.length === 0 && (
        <p className="mt-1 border-t border-white/[0.05] px-2 pt-2 text-center font-sans text-xs font-semibold text-white/50">
          No entries yet — rank 1 is open.
        </p>
      )}
    </section>
  );
};

export default DailyBoard;
