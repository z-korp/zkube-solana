import { ArrowUp, Info } from "lucide-react";

import { formatSolLamports } from "@/utils/currency";
import { cn } from "@/ui/utils";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/elements/tooltip";

import PrizeLadder from "./PrizeLadder";
import { DAILY_WEIGHTS } from "./payout";
import { BUILDING_GREEN, MONEY_GOLD } from "./tokens";

interface DualPotProps {
  /** Today's prepaid, guaranteed pot in lamports. */
  todayPotLamports: bigint;
  /** Ladder weights for today's pot; defaults to the Daily ladder. */
  weights?: number[];
  /** Lamports so far building the following Daily, or null while preparing. */
  followingDailyLamports: bigint | null;
  /** Lamports so far building the next Weekly, or null while preparing. */
  followingWeeklyLamports: bigint | null;
  /** Lamports so far building the Season, or null while preparing. */
  followingSeasonLamports: bigint | null;
  /** Ranked entry price in lamports (rendered in the info copy). */
  entryLamports: bigint;
  /** "hero" (default) enlarges today's amount; "compact" tightens the card. */
  variant?: "hero" | "compact";
  className?: string;
}

/**
 * The two-sided pot card: a prepaid, guaranteed pot the player competes for
 * today (top), and the following competitions the player's entries build
 * (bottom). Purely presentational — pot and building figures come from the
 * page. No live ticker; a single info affordance carries the rules.
 */
const DualPot: React.FC<DualPotProps> = ({
  todayPotLamports,
  weights,
  followingDailyLamports,
  followingWeeklyLamports,
  followingSeasonLamports,
  entryLamports,
  variant = "hero",
  className,
}) => {
  const colors = useThemeColors();
  const hero = variant !== "compact";

  const buildRows: { label: string; value: bigint | null }[] = [
    { label: "Following Daily", value: followingDailyLamports },
    { label: "Next Weekly", value: followingWeeklyLamports },
    { label: "Season", value: followingSeasonLamports },
  ];

  const infoText = `Today's pot is prepaid & guaranteed — entries never raise it. Each ${formatSolLamports(
    entryLamports,
  )} entry funds tomorrow: 60% Daily · 20% Weekly · 10% Season · 10% team. Scored or expired, never refunded.`;

  return (
    <div
      className={cn(
        "relative rounded-3xl border bg-black/40 backdrop-blur-xl",
        hero ? "p-5" : "p-4",
        className,
      )}
      style={{
        borderColor: `${colors.accent}33`,
        boxShadow: `0 0 24px ${colors.accent}14, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      {/* Single info affordance — one tooltip, no other body copy. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="How the pot works"
            className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full text-white/40 transition-colors hover:text-white/75"
          >
            <Info size={15} />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-left font-sans text-[11px] font-medium normal-case leading-relaxed">
          {infoText}
        </TooltipContent>
      </Tooltip>

      {/* Top — the guaranteed pot the player competes for today. */}
      <div className="flex flex-col gap-2 pr-8">
        <span
          className="font-sans text-[11px] font-bold uppercase tracking-[0.12em]"
          style={{ color: MONEY_GOLD }}
        >
          Playing for today
        </span>
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              "font-sans font-black leading-none tabular-nums",
              hero ? "text-4xl" : "text-2xl",
            )}
            style={{ color: MONEY_GOLD }}
          >
            {formatSolLamports(todayPotLamports)}
          </span>
          <span
            className="font-sans text-sm font-bold"
            style={{ color: `${MONEY_GOLD}b0` }}
          >
            SOL
          </span>
        </div>
        <PrizeLadder
          potLamports={todayPotLamports}
          weights={weights ?? DAILY_WEIGHTS}
        />
      </div>

      {/* Dashed divider between the two sides. */}
      <div className="my-4 border-t border-dashed border-white/15" />

      {/* Bottom — what the player's entries are building for tomorrow. */}
      <div className="flex flex-col gap-2">
        <span
          className="font-sans text-[11px] font-bold uppercase tracking-[0.12em]"
          style={{ color: BUILDING_GREEN }}
        >
          Your entries build tomorrow
        </span>
        <div className="flex flex-col gap-1.5">
          {buildRows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex items-center gap-1.5 font-sans text-xs font-semibold text-white/60">
                <ArrowUp size={13} style={{ color: BUILDING_GREEN }} />
                {row.label}
              </span>
              {row.value === null ? (
                <span className="font-sans text-xs italic text-white/35">
                  Being prepared
                </span>
              ) : (
                <span
                  className="font-sans text-xs font-bold tabular-nums"
                  style={{ color: BUILDING_GREEN }}
                >
                  {formatSolLamports(row.value)}
                  <span className="ml-1 text-[10px] font-semibold text-white/40">
                    SOL
                  </span>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DualPot;
