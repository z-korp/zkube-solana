/**
 * The gain, carried from where it happened to where it lands.
 *
 * A score that simply increments is a number changing; a score that arrives on
 * something the player watched leave the board is a score they made go up.
 * That is the whole of it.
 *
 * Two feeds, because the day pays two boards over the same run: a move that
 * scores sends one gold chip to the left recess, and a move that also satisfies
 * the day's rule sends a cyan one to the right at the same time. Within about
 * three clears that teaches the split without a word of copy.
 */
import { AnimatePresence, motion } from "motion/react";

export interface ScoreChip {
  id: number;
  /** Viewport coordinates of the row that produced it. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  amount: number;
  tone: "score" | "objective";
}

/** Long enough to read, short enough that a fast player never waits. */
export const CHIP_FLIGHT_MS = 260;
/** Each extra row's chip leaves a beat later, so four rows is an avalanche. */
export const CHIP_STAGGER_MS = 40;

export default function ScoreChips({ chips }: { chips: ScoreChip[] }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <AnimatePresence>
        {chips.map((chip) => (
          <motion.span
            key={chip.id}
            initial={{ x: chip.from.x, y: chip.from.y, opacity: 0, scale: 0.7 }}
            animate={{
              x: chip.to.x,
              y: chip.to.y,
              opacity: [0, 1, 1, 0],
              scale: [0.7, 1.15, 1, 0.8],
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: CHIP_FLIGHT_MS / 1000,
              ease: [0.2, 0.9, 0.3, 1.2],
              opacity: { times: [0, 0.15, 0.75, 1] },
            }}
            className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 rounded-md px-2 py-[3px] font-sans text-[15px] font-black tabular-nums"
            style={{
              color: "#241903",
              background:
                chip.tone === "score"
                  ? "linear-gradient(160deg,#FFF3C4,#E0A800)"
                  : "linear-gradient(160deg,#CFF3FF,#38BDF8)",
              boxShadow:
                chip.tone === "score"
                  ? "0 3px 0 rgba(0,0,0,0.55), 0 0 18px rgba(250,204,21,0.55)"
                  : "0 3px 0 rgba(0,0,0,0.55), 0 0 18px rgba(56,189,248,0.5)",
            }}
          >
            +{chip.amount.toLocaleString("en-US")}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
