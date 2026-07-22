import React from "react";

import type { PlayerEmblemView } from "@/chain/playerStateClient";
import { TROPHY_IMAGES } from "@/ui/components/arena/leaderboardMedals";
import { EmblemBadge, MONEY_GOLD } from "@/ui/components/economy";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { cn } from "@/ui/utils";
import { formatSolLamports } from "@/utils/currency";

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

function medalBackground(rank: number): string {
  if (rank === 1) return "rgba(255,215,0,0.16)";
  if (rank === 2) return "rgba(192,192,192,0.14)";
  if (rank === 3) return "rgba(205,127,50,0.14)";
  return "rgba(255,255,255,0.05)";
}

/**
 * One clean leaderboard row: medal/rank, inline emblem, name (with the "you"
 * pulse), the primary figure, and an optional floored SOL prize. Shared by the
 * Weekly and Season boards and the Daily "your rank" footer so every board
 * reads as one system.
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
  const colors = useThemeColors();
  const medal = TROPHY_IMAGES[rank];

  const inner = (
    <>
      <div
        className="flex w-7 shrink-0 items-center justify-center font-sans text-base font-black tabular-nums"
        style={{ color: rank <= 3 ? colors.accent2 : colors.textMuted }}
      >
        {medal ? (
          <img
            src={medal}
            alt={`Rank ${rank}`}
            className="h-6 w-6"
            draggable={false}
          />
        ) : (
          rank
        )}
      </div>

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

      <span
        className="min-w-0 flex-1 truncate font-sans text-sm font-extrabold"
        style={{ color: isYou ? colors.accent : colors.text }}
      >
        {name}
      </span>

      <div className="flex shrink-0 flex-col items-end leading-tight">
        <span
          className="font-sans text-[15px] font-black tabular-nums"
          style={{ color: colors.text }}
        >
          {primary}
        </span>
        {prizeLamports !== undefined &&
          (prizeLamports > 0n ? (
            <span
              className="font-sans text-[11px] font-bold tabular-nums"
              style={{ color: MONEY_GOLD }}
            >
              {formatSolLamports(prizeLamports)} SOL
            </span>
          ) : (
            <span className="font-sans text-[11px] font-bold text-white/25">
              &mdash;
            </span>
          ))}
      </div>
    </>
  );

  const style: React.CSSProperties = isYou
    ? ({
        "--pulse-base": `${colors.accent}20`,
        "--pulse-bright": `${colors.accent}40`,
        borderColor: `${colors.accent}AA`,
      } as React.CSSProperties)
    : {
        backgroundColor: medalBackground(rank),
        borderColor:
          rank <= 3 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.10)",
      };

  const classes = cn(
    "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left backdrop-blur-xl",
    isYou && "leaderboard-pulse",
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
