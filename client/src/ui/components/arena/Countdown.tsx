import React from "react";

import type { ThemeColors } from "@/config/themes";
import { useCountdown } from "@/hooks/useNowTick";
import { formatCountdown } from "@/utils/time";

/** Live countdown pill that flips to FINALIZING once the window closes. */
export const Countdown: React.FC<{
  endTime: number;
  colors: ThemeColors;
}> = ({ endTime, colors }) => {
  const seconds = useCountdown(endTime);

  if (seconds <= 0) {
    return (
      <span className="rounded-full bg-yellow-500/80 px-3 py-1.5 font-sans text-xs font-bold text-black">
        FINALIZING
      </span>
    );
  }

  return (
    <span
      className="rounded-full px-3 py-1.5 font-sans text-xs font-bold tabular-nums text-white"
      style={{ background: colors.accent }}
    >
      {formatCountdown(seconds)}
    </span>
  );
};

export default Countdown;
