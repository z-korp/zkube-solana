import type { Variants } from "motion/react";

/**
 * Shared page/tab entry animation: a container that fades in and staggers its
 * children, each child rising with the same spring. Pages that want a slower
 * cadence pass their own `staggerChildren` (e.g. 0.06).
 */
export const staggerContainer = (staggerChildren = 0.05): Variants => ({
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren },
  },
});

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 24 },
  },
};
