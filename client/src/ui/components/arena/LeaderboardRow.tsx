import React from "react";

import type { PlayerEmblemView } from "@/chain/playerStateClient";
import { EmblemBadge, MONEY_GOLD, SolMark } from "@/ui/components/economy";
import { cn } from "@/ui/utils";
import { formatSolBalanceLamports } from "@/utils/currency";

interface LeaderboardRowProps {
  rank: number;
  /** Display name (callers prefix "You · " themselves). */
  name: string;
  /** Featured emblem for this wallet; a neutral slot renders when absent. */
  emblem?: PlayerEmblemView;
  isYou?: boolean;
  /** Right-aligned primary figure, already formatted (e.g. "1,240" or "3 pts"). */
  primary: string;
  /**
   * Prize for this rank. `undefined` hides the prize slot; a bigint renders the
   * floored SOL payout — gold when it pays, a muted dash at `0n`. Pass `0n` for
   * ranks past the paying field to draw the cut-line's greyed rows.
   */
  prizeLamports?: bigint;
  /** Dim rows below the paid cut-line while keeping them readable. */
  dimmed?: boolean;
  onClick?: () => void;
  className?: string;
}

const MEDAL_COLORS = ["#FACC15", "#C9D6E4", "#E2955C"] as const;

/** The medal chip every board rank wears. */
export const RankMedal: React.FC<{ rank: number; size?: number }> = ({
  rank,
  size = 20,
}) => (
  <span
    className="flex flex-none items-center justify-center font-mono font-black"
    style={{
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.3),
      fontSize: Math.round(size * 0.5),
      background: MEDAL_COLORS[rank - 1] ?? "rgba(255,255,255,0.18)",
      color: rank <= 3 ? "#181205" : "rgba(255,255,255,0.75)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4)",
    }}
  >
    {rank}
  </span>
);

/**
 * One board row in the opaque grammar: medal chip, inline emblem, name, the
 * primary figure, and an optional floored SOL prize. Rows render transparent —
 * the parent panel carries the surface — except the connected player's row,
 * which wears the gold ring. Shared by the Weekly and Season boards so every
 * board reads as one system.
 */
const LeaderboardRow: React.FC<LeaderboardRowProps> = ({
  rank,
  name,
  emblem,
  isYou = false,
  primary,
  prizeLamports,
  dimmed = false,
  onClick,
  className,
}) => {
  const inner = (
    <>
      <RankMedal rank={rank} />

      {emblem ? (
        <EmblemBadge
          emblemId={emblem.featuredEmblem}
          totalStars={emblem.totalStars}
          size={24}
          className="shrink-0"
        />
      ) : (
        <span className="h-6 w-6 shrink-0 rounded-lg border border-white/10 bg-white/[0.04]" />
      )}

      <span className="min-w-0 flex-1 truncate font-sans text-[13px] font-bold text-white/90">
        {name}
      </span>

      <div className="flex shrink-0 flex-col items-end leading-tight">
        <span className="font-mono text-[14px] font-bold tabular-nums text-white">
          {primary}
        </span>
        {prizeLamports !== undefined &&
          (prizeLamports > 0n ? (
            <span
              className="flex items-center gap-1 font-mono text-[11px] font-bold tabular-nums"
              style={{ color: MONEY_GOLD }}
            >
              {formatSolBalanceLamports(prizeLamports)}
              <SolMark size={8} />
            </span>
          ) : (
            <span className="font-sans text-[11px] font-bold text-white/25">
              &mdash;
            </span>
          ))}
      </div>
    </>
  );

  const style: React.CSSProperties | undefined = isYou
    ? {
        border: "1px solid #FACC15",
        background: "rgba(250,204,21,0.10)",
        boxShadow: "0 0 12px rgba(250,204,21,0.25)",
      }
    : undefined;

  const classes = cn(
    "flex w-full items-center gap-2.5 px-2.5 py-2.5 text-left",
    isYou && "rounded-xl",
    dimmed && "opacity-45",
    onClick && "transition-transform active:scale-[0.99]",
    className,
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes} style={style}>
        {inner}
      </button>
    );
  }
  return (
    <div className={classes} style={style}>
      {inner}
    </div>
  );
};

/** Divider marking the boundary between paying and non-paying ranks. */
export const PaidCutLine: React.FC<{ label?: string }> = ({
  label = "Paid places above",
}) => (
  <div className="flex items-center gap-2 px-1 py-0.5">
    <div className="h-px flex-1 bg-white/10" />
    <span className="font-sans text-[9px] font-black uppercase tracking-[0.16em] text-white/30">
      {label}
    </span>
    <div className="h-px flex-1 bg-white/10" />
  </div>
);

export default LeaderboardRow;
