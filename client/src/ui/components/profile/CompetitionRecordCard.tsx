import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion } from "motion/react";

import type { CompetitionRecord } from "@/chain/campaignClient";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { formatSolLamports } from "@/utils/currency";

interface CompetitionRecordCardProps {
  /** Period name: "Daily", "Weekly", or "Season". */
  title: string;
  record: CompetitionRecord;
  /** Optional footnote (e.g. the Weekly three-board explanation). */
  note?: string;
  /** Start expanded. */
  defaultOpen?: boolean;
}

/**
 * One collapsible Arcade prize record. Collapsed, it shows the period name and
 * the pushed reward total; expanded, it breaks out the best payout-bearing
 * rank, podiums, wins, and rewards. All figures come straight from the on-chain
 * CompetitionRecord — settlement is push-only, so these only ever grow.
 */
const CompetitionRecordCard: React.FC<CompetitionRecordCardProps> = ({
  title,
  record,
  note,
  defaultOpen = false,
}) => {
  const colors = useThemeColors();
  const [open, setOpen] = useState(defaultOpen);

  const rewards = `${formatSolLamports(record.rewardsLamports)} SOL`;
  const bestRank = record.bestPrizeRank > 0 ? `#${record.bestPrizeRank}` : "--";

  const details: Array<{ label: string; value: string; color?: string }> = [
    { label: "Best rank", value: bestRank, color: colors.accent2 },
    { label: "Podiums", value: record.podiums.toLocaleString() },
    { label: "Wins", value: record.wins.toLocaleString() },
    { label: "Rewards", value: rewards, color: colors.accent2 },
  ];

  return (
    <motion.section
      variants={{
        hidden: { opacity: 0, y: 12 },
        show: {
          opacity: 1,
          y: 0,
          transition: { type: "spring", stiffness: 300, damping: 24 },
        },
      }}
      className="overflow-hidden rounded-2xl border border-white/[0.12] bg-white/[0.06] backdrop-blur-xl"
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-transform active:scale-[0.99]"
      >
        <div className="min-w-0">
          <p
            className="font-sans text-[14px] font-extrabold"
            style={{ color: colors.text }}
          >
            {title}
          </p>
          <p className="mt-0.5 font-sans text-[11px] font-semibold text-white/50">
            {record.rewardsLamports > 0n
              ? `${rewards} won`
              : "No prizes yet"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className="font-sans text-[13px] font-black"
            style={{ color: colors.accent2 }}
          >
            {bestRank}
          </span>
          <ChevronDown
            size={18}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
            style={{ color: "rgba(255,255,255,0.6)" }}
          />
        </div>
      </button>

      {open && (
        <div className="border-t border-white/10 px-4 pb-3.5 pt-3">
          <div className="grid grid-cols-2 gap-2">
            {details.map((detail) => (
              <div
                key={detail.label}
                className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-center"
              >
                <p
                  className="font-sans text-base font-black"
                  style={{ color: detail.color ?? colors.text }}
                >
                  {detail.value}
                </p>
                <p className="font-sans text-[10px] font-bold uppercase tracking-wide text-white/45">
                  {detail.label}
                </p>
              </div>
            ))}
          </div>
          {note && (
            <p className="mt-2.5 font-sans text-[10px] font-semibold leading-relaxed text-white/40">
              {note}
            </p>
          )}
        </div>
      )}
    </motion.section>
  );
};

export default CompetitionRecordCard;
