import type { ReactNode } from "react";

import { ladderTierName } from "@/config/ladderTiers";
import { tierFrameOuterSize } from "@/config/tierFrames";
import { MONEY_SURFACE_SENTINEL } from "@/ui/moneySurface";

interface TierFrameProps {
  /** Protocol tier index. */
  tier: number;
  /** Size of the artwork being framed, in px. The frame grows around it. */
  size: number;
  children: ReactNode;
  className?: string;
}

/**
 * The ladder tier as an ornamental border around a player's block.
 *
 * A frame rather than a rim. Recolouring the block's own sticker rim fought
 * the realm's colour and painted over a border the block already had — two
 * different achievements competing for one edge. The rank gets its own
 * ornament outside the block, so a realm stays its own colour and the rank is
 * still readable at a glance.
 */
const TierFrame: React.FC<TierFrameProps> = ({
  tier,
  size,
  children,
  className = "",
}) => {
  const outer = tierFrameOuterSize(tier, size);
  // The box is the whole ornament, not the block: a frame that overhangs its
  // own box gets clipped by the first panel edge it meets.
  return (
    <span
      data-zkube-money-surface={MONEY_SURFACE_SENTINEL}
      className={`relative inline-grid flex-none place-items-center ${className}`}
      style={{ width: outer, height: outer }}
    >
      {children}
      <img
        src={`/assets/common/tier-${tier}.png`}
        alt={`${ladderTierName(tier)} tier`}
        draggable={false}
        className="pointer-events-none absolute select-none"
        style={{
          width: outer,
          height: outer,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />
    </span>
  );
};

export default TierFrame;
