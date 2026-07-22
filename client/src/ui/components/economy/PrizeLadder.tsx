import { formatSolLamports } from "@/utils/currency";
import { cn } from "@/ui/utils";

import { computePayouts } from "./payout";
import { MONEY_GOLD } from "./tokens";

interface PrizeLadderProps {
  /** Prepaid pot, in lamports. */
  potLamports: bigint;
  /** Prize weights, highest place first (e.g. DAILY_WEIGHTS). */
  weights: number[];
  /** Number of occupied places; renormalizes over the top weights when short. */
  occupied?: number;
  /** 1-based rank to emphasize; defaults to first place. */
  highlightRank?: number;
  className?: string;
}

/** English ordinal: 1 -> 1st, 2 -> 2nd, 3 -> 3rd, 4 -> 4th, ... */
function ordinal(rank: number): string {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

/**
 * A compact, wrapping row of prize rungs. Each rung stacks a rank label over
 * its floored payout (gold, tabular-nums). The highlighted rung (first place
 * by default) gets a gold-tinted background and border.
 */
const PrizeLadder: React.FC<PrizeLadderProps> = ({
  potLamports,
  weights,
  occupied,
  highlightRank,
  className,
}) => {
  const payouts = computePayouts(potLamports, weights, occupied);
  const highlight = highlightRank ?? 1;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {payouts.map((amount, index) => {
        const rank = index + 1;
        const emphasized = rank === highlight;
        return (
          <div
            key={rank}
            className="flex min-w-[3.5rem] flex-1 flex-col items-center gap-0.5 rounded-xl border px-2 py-1.5"
            style={
              emphasized
                ? { borderColor: `${MONEY_GOLD}55`, background: `${MONEY_GOLD}14` }
                : {
                    borderColor: "rgba(255,255,255,0.10)",
                    background: "rgba(0,0,0,0.40)",
                  }
            }
          >
            <span className="font-sans text-[10px] font-bold uppercase tracking-wide text-white/45">
              {ordinal(rank)}
            </span>
            {amount > 0n ? (
              <span
                className="font-sans text-xs font-bold tabular-nums"
                style={{ color: MONEY_GOLD }}
              >
                {formatSolLamports(amount)}
              </span>
            ) : (
              <span className="font-sans text-xs font-bold tabular-nums text-white/30">
                &mdash;
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PrizeLadder;
