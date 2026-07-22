import { TrendingUp } from "lucide-react";

import InfoSheet from "@/ui/components/shared/InfoSheet";
import { cn } from "@/ui/utils";
import { formatSolLamports } from "@/utils/currency";

import PrizeLadder from "./PrizeLadder";
import { DAILY_WEIGHTS, ordinal } from "./payout";
import { BUILDING_GREEN, MONEY_GOLD } from "./tokens";

/** The connected wallet's standing, as produced by `useMyDailyRank`. */
interface MyDailyRankProp {
  rank: number | null;
  inMoney: boolean;
  prizeLamports: bigint | null;
}

interface DailyPotProps {
  /** Today's prepaid, guaranteed pot in lamports. */
  potLamports: bigint;
  /** Lamports so far building tomorrow's Daily, or null while preparing. */
  followingDailyLamports: bigint | null;
  /** Ranked entry price in lamports (rendered in the info copy). */
  entryLamports: bigint;
  /** Ladder weights for today's pot; defaults to the Daily ladder. */
  weights?: number[];
  /** The connected wallet's rank / prize standing in today's Daily. */
  myRank: MyDailyRankProp;
  className?: string;
}

/**
 * The Arcade home money surface: today's guaranteed pot in gold, a single line
 * for what entries are building toward tomorrow's Daily, the prize ladder with
 * the player's rung highlighted, and a plain "where you stand" readout. Purely
 * presentational — every figure comes from the page. The Weekly/Season building
 * rows and the full board live on the Leaderboard, not here.
 */
const DailyPot: React.FC<DailyPotProps> = ({
  potLamports,
  followingDailyLamports,
  entryLamports,
  weights = DAILY_WEIGHTS,
  myRank,
  className,
}) => {
  const { rank, inMoney, prizeLamports } = myRank;
  // Emphasize the player's rung only when it pays; otherwise lead with first.
  const highlightRank = inMoney && rank !== null ? rank : undefined;

  let standing: string;
  if (rank === null) {
    standing = "Not ranked yet — play to climb";
  } else if (prizeLamports !== null && prizeLamports > 0n) {
    standing = `You're ${ordinal(rank)} · would win ${formatSolLamports(prizeLamports)} SOL`;
  } else {
    standing = `You're ${ordinal(rank)} · outside the prizes`;
  }

  return (
    <div
      className={cn(
        "relative flex flex-col gap-3 rounded-3xl border border-white/[0.1] bg-black/30 p-5 backdrop-blur-xl",
        className,
      )}
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)" }}
    >
      {/* Today's guaranteed pot. */}
      <div className="flex flex-col gap-1.5">
        <span
          className="font-sans text-[11px] font-bold uppercase tracking-[0.12em]"
          style={{ color: MONEY_GOLD }}
        >
          Playing for today
        </span>
        <div className="flex items-baseline gap-1.5">
          <span
            className="font-sans text-4xl font-black leading-none tabular-nums"
            style={{ color: MONEY_GOLD }}
          >
            {formatSolLamports(potLamports)}
          </span>
          <span
            className="font-sans text-sm font-bold"
            style={{ color: `${MONEY_GOLD}b0` }}
          >
            SOL
          </span>
        </div>
      </div>

      {/* Prize ladder — the player's paying rung is highlighted when they hold one. */}
      <PrizeLadder
        potLamports={potLamports}
        weights={weights}
        highlightRank={highlightRank}
      />

      {/* Where the connected wallet stands right now. */}
      <div
        className="rounded-2xl border px-3 py-2 text-center"
        style={
          inMoney
            ? { borderColor: `${MONEY_GOLD}55`, background: `${MONEY_GOLD}12` }
            : {
                borderColor: "rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.04)",
              }
        }
      >
        <span
          className="font-sans text-xs font-bold"
          style={{ color: rank === null ? "rgba(255,255,255,0.6)" : MONEY_GOLD }}
        >
          {standing}
        </span>
      </div>

      {/* One line for what entries build toward tomorrow's Daily. */}
      <p
        className="inline-flex items-center justify-center gap-1.5 font-sans text-[11px] font-bold"
        style={{ color: BUILDING_GREEN }}
      >
        <TrendingUp size={12} className="shrink-0" />
        Building tomorrow&apos;s Daily
        <span className="tabular-nums text-white/70">
          {followingDailyLamports === null
            ? "· being prepared"
            : `+${formatSolLamports(followingDailyLamports)} SOL`}
        </span>
      </p>

      {/* One tap-to-open info affordance carries the rules (no hover). */}
      <div className="flex justify-center">
        <InfoSheet title="How the pot works">
          <p>Today&apos;s pot is prepaid and guaranteed — entries never raise it.</p>
          <p>
            Each {formatSolLamports(entryLamports)} SOL entry funds tomorrow: 60%
            Daily, 20% Weekly, 10% Season, 10% team. Scored or expired, never
            refunded.
          </p>
        </InfoSheet>
      </div>
    </div>
  );
};

export default DailyPot;
