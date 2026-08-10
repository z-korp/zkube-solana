import type { ReactNode } from "react";

import { ladderTierName } from "@/config/ladderTiers";

/**
 * Fraction of each frame's artwork taken up by its opening, measured by
 * `client/tools/sprites/install-tier-frames.py` and printed by it.
 *
 * Per tier rather than one constant: forcing every frame to the same ratio
 * would have cropped the ornament off the elaborate ranks, whose bands are
 * thicker. A higher tier legitimately reaches further past the block, which is
 * what makes the rack of them read as a climb.
 */
const TIER_FRAME_OPENINGS = [0.8255, 0.6673, 0.7078, 0.5886, 0.6177] as const;

/** Overlap: the block tucks under the band instead of leaving a seam. */
const TUCK = 1.03;

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
  const opening =
    TIER_FRAME_OPENINGS[tier] ?? TIER_FRAME_OPENINGS[0];
  const outer = Math.round((size * TUCK) / opening);
  // The box is the whole ornament, not the block: a frame that overhangs its
  // own box gets clipped by the first panel edge it meets.
  return (
    <span
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
