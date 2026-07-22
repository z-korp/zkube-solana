import { Info } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { MONEY_GOLD } from "@/ui/components/economy";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import Sheet from "@/ui/components/shared/Sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/elements/tooltip";
import { formatSolLamports } from "@/utils/currency";

/**
 * The single info affordance carries every rule; no other body copy exists on
 * this surface (product truth: owner-only signature, tomorrow's split, and the
 * scored-or-expired-never-refunded guarantee).
 */
const INFO_COPY =
  "Owner signs; a device session can't pay. Funds tomorrow: 60% Daily · 20% Weekly · 10% Season · 10% team. Scored or expired, never refunded.";

interface InsertCoinSheetProps {
  open: boolean;
  onClose: () => void;
  /** Exact ranked entry price in lamports (rendered gold + mono). */
  entryLamports: bigint;
  /** Proceeds with the existing daily.enter() owner-signature flow. */
  onConfirm: () => void;
  /** True while the owner signature is being prepared. */
  busy?: boolean;
}

/** A static, CSS-only arcade coin slot with a gently bobbing coin. */
const CoinSlot: React.FC = () => {
  const reduceMotion = useReducedMotion();
  return (
    <div className="relative flex h-[72px] w-28 items-end justify-center">
      <div
        className="absolute bottom-0 h-14 w-28 rounded-2xl border border-white/[0.12] bg-black/40"
        style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)" }}
      >
        <span className="absolute left-1/2 top-4 h-1.5 w-12 -translate-x-1/2 rounded-full bg-black/70 ring-1 ring-white/10" />
      </div>
      <motion.span
        className="absolute left-1/2 top-0 flex h-8 w-8 -translate-x-1/2 items-center justify-center font-mono text-sm font-black"
        style={{
          borderRadius: "9999px",
          background: `radial-gradient(circle at 35% 30%, ${MONEY_GOLD}, ${MONEY_GOLD}cc 60%, ${MONEY_GOLD}80)`,
          color: "#3a2c00",
          boxShadow: `0 0 12px ${MONEY_GOLD}66`,
        }}
        animate={reduceMotion ? undefined : { y: [0, 6, 0] }}
        transition={
          reduceMotion
            ? undefined
            : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
        }
      >
        ◎
      </motion.span>
    </div>
  );
};

/**
 * Minimal ranked-entry confirm, shown when the player taps the ranked CTA and
 * before the owner signature. A coin-slot visual, the "Insert coin" heading,
 * the exact entry amount in gold mono, exactly one info tooltip, and a single
 * "Sign & enter" button that hands off to the unchanged daily.enter() flow.
 */
const InsertCoinSheet: React.FC<InsertCoinSheetProps> = ({
  open,
  onClose,
  entryLamports,
  onConfirm,
  busy = false,
}) => {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      srTitle="Insert coin to enter ranked"
      dismissible={!busy}
    >
      <div className="flex flex-col items-center gap-5 pt-2">
        <CoinSlot />

        <div className="flex flex-col items-center gap-2">
          <h2 className="font-display text-2xl font-bold tracking-wide text-white">
            Insert coin
          </h2>
          <div className="flex items-baseline gap-1.5">
            <span
              className="font-mono text-4xl font-black tabular-nums"
              style={{ color: MONEY_GOLD }}
            >
              {formatSolLamports(entryLamports)}
            </span>
            <span
              className="font-mono text-base font-bold"
              style={{ color: `${MONEY_GOLD}b0` }}
            >
              SOL
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="How ranked entry works"
                  className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-white/40 transition-colors hover:text-white/75"
                >
                  <Info size={15} />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-left font-sans text-[11px] font-medium normal-case leading-relaxed">
                {INFO_COPY}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="w-full pt-1">
          <ArcadeButton disabled={busy} onClick={onConfirm}>
            {busy ? "Preparing signature…" : "Sign & enter"}
          </ArcadeButton>
        </div>
      </div>
    </Sheet>
  );
};

export default InsertCoinSheet;
