import React, { type ReactNode } from "react";
import { TrendingUp } from "lucide-react";

import { BUILDING_GREEN, MONEY_GOLD } from "@/ui/components/economy";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { cn } from "@/ui/utils";
import { formatSolLamports } from "@/utils/currency";

interface BoardPotHeaderProps {
  /** Uppercase eyebrow, e.g. "Today's Daily pot". */
  label: string;
  /** Guaranteed, prepaid pot for the active period, in lamports. */
  potLamports: bigint;
  /** Lamports so far building the following period, or null while preparing. */
  followingLamports: bigint | null;
  /** What the following pot is, e.g. "Building tomorrow's Daily". */
  followingLabel: string;
  /** Countdown pill or status chip rendered top-right. */
  timing?: ReactNode;
  /** Prize ladder and any rules note. */
  children?: ReactNode;
  className?: string;
}

/**
 * Compact per-board header: the guaranteed pot in gold, a small "building next"
 * readout in green, an optional timing pill, and a slot for the prize ladder.
 * Purely presentational — every figure comes from the authoritative chain view.
 */
const BoardPotHeader: React.FC<BoardPotHeaderProps> = ({
  label,
  potLamports,
  followingLamports,
  followingLabel,
  timing,
  children,
  className,
}) => {
  const colors = useThemeColors();

  return (
    <section
      className={cn(
        "rounded-2xl border border-white/[0.12] bg-white/[0.06] p-4 backdrop-blur-xl",
        className,
      )}
      style={{ boxShadow: `inset 0 1px 0 ${colors.accent}12` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-sans text-[10px] font-black uppercase tracking-[0.16em] text-white/45">
            {label}
          </p>
          <p
            className="mt-0.5 font-display text-[26px] font-black leading-none tabular-nums"
            style={{ color: MONEY_GOLD }}
          >
            {formatSolLamports(potLamports)}
            <span className="ml-1 text-base font-black text-white/55">SOL</span>
          </p>
          <p
            className="mt-1.5 inline-flex items-center gap-1 font-sans text-[11px] font-bold"
            style={{ color: BUILDING_GREEN }}
          >
            <TrendingUp size={12} className="shrink-0" />
            {followingLabel}
            <span className="tabular-nums text-white/70">
              {followingLamports === null
                ? "· being prepared"
                : `+${formatSolLamports(followingLamports)} SOL`}
            </span>
          </p>
        </div>
        {timing && <div className="shrink-0">{timing}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
};

export default BoardPotHeader;
