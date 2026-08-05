import { motion } from "motion/react";

/**
 * The perfect-clear callout.
 *
 * It shares the combo banner's grammar — a display-face shout that punches in,
 * holds, and leaves — but outranks it deliberately: larger, gold, and stacked
 * above the combo when both fire, because a perfect clear is the rarer reward
 * and almost always arrives *with* a combo rather than instead of one.
 *
 * It also lands a beat later than the combo, so the two read as an escalation
 * rather than two shouts at once.
 */

interface PerfectClearBannerProps {
  /** Bumped per perfect clear; changing it replays the banner. */
  nonce: number;
  reset: () => void;
}

export default function PerfectClearBanner({
  nonce,
  reset,
}: PerfectClearBannerProps) {
  if (!nonce) return null;
  return (
    <motion.div
      key={nonce}
      // own compositor layer: the keyframed transform would otherwise repaint
      // the glyphs and their shadow over the whole board every frame
      style={{ willChange: "transform, opacity" }}
      initial={{ scale: 0.2, opacity: 0, y: 6 }}
      animate={{
        scale: [0.2, 1.32, 1, 1, 1.06, 0.9],
        opacity: [0, 1, 1, 1, 1, 0],
        y: [6, -2, 0, 0, -4, -12],
      }}
      transition={{
        duration: 2.3,
        times: [0, 0.1, 0.2, 0.68, 0.85, 1],
        ease: [0.22, 1.2, 0.36, 1],
        delay: 0.16,
      }}
      onAnimationComplete={reset}
    >
      <span className="text-shine font-display inline-block px-4 text-6xl font-black tracking-wide">
        PERFECT
      </span>
    </motion.div>
  );
}
