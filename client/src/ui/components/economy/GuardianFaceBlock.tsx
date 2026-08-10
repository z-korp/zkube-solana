import { motion, useReducedMotion } from "motion/react";

import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import {
  GUARDIAN_TIER_COLORS,
  getFaceWindowStyle,
} from "@/config/guardianBlocks";

export type MasteryBadge = "cleared" | "perfected";

interface GuardianFaceBlockProps {
  zoneId: number;
  /** Square size in px. */
  size: number;
  /**
   * Sticker rim colour. Defaults to the neutral white sticker; pass a ladder
   * tier colour where the block stands for a player rather than for a realm.
   */
  rimColor?: string;
  /**
   * Campaign mastery, worn as a corner star rather than as a rim.
   *
   * Mastery and ladder rank are different achievements and used to compete for
   * the same edge — a gold rim could only ever say one of them. The star says
   * what was finished; the rim says how high the player has climbed.
   */
  badge?: MasteryBadge | null;
  /** Gentle 4s scale breathe (hero placements only). */
  breathe?: boolean;
  className?: string;
}

function mix(hex: string, target: number, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (target - c) * amount);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

const NEUTRAL_RIM = "rgba(255,255,255,0.92)";
const BADGE_COLORS: Record<MasteryBadge, string> = {
  cleared: "#B9CADB",
  perfected: "#FACC15",
};

/**
 * The glossy guardian block — the app icon's block furniture as a component:
 * realm-coloured body, sticker rim, inset face window with the full-head crop
 * from guardianBlocks, and a gloss arc. One component from store shelf to
 * board row; only `size` changes.
 */
const GuardianFaceBlock: React.FC<GuardianFaceBlockProps> = ({
  zoneId,
  size,
  rimColor = NEUTRAL_RIM,
  badge = null,
  breathe = false,
  className = "",
}) => {
  const reduceMotion = useReducedMotion();
  const base = GUARDIAN_TIER_COLORS[zoneId] ?? GUARDIAN_TIER_COLORS[1];
  const window = getFaceWindowStyle(zoneId);
  const guardian = getZoneGuardian(zoneId);
  const rimWidth = Math.max(2, size * 0.045);
  const badgeColor = badge ? BADGE_COLORS[badge] : null;
  const badgeSize = Math.round(size * 0.32);

  return (
    <motion.div
      className={`relative flex-none ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: "24%",
        background: `linear-gradient(135deg, ${mix(base, 255, 0.5)} 0%, ${base} 55%, ${mix(base, 0, 0.38)} 100%)`,
        boxShadow: [
          `inset 0 0 0 ${rimWidth}px ${rimColor}`,
          // A hairline behind the rim. Without it a tier colour close to the
          // realm's own body — Jade on a green guardian — vanishes into it.
          `inset 0 0 0 ${rimWidth + Math.max(1, size * 0.02)}px rgba(0,0,0,0.5)`,
          badge === "perfected" ? `0 0 ${size * 0.28}px rgba(250,204,21,0.35)` : "",
          `0 ${size * 0.055}px ${size * 0.1}px rgba(0,0,0,0.45)`,
        ]
          .filter(Boolean)
          .join(", "),
      }}
      animate={breathe && !reduceMotion ? { scale: [1, 1.035, 1] } : undefined}
      transition={
        breathe && !reduceMotion
          ? { duration: 4, repeat: Infinity, ease: "easeInOut" }
          : undefined
      }
    >
      <div
        className="absolute overflow-hidden"
        style={{
          inset: "8.5%",
          borderRadius: "20%",
          background: `radial-gradient(circle at 50% 38%, ${mix(base, 255, 0.3)}, ${mix(base, 0, 0.45)} 85%)`,
          boxShadow: `inset 0 0 0 ${Math.max(1, size * 0.02)}px rgba(0,0,0,0.35)`,
        }}
      >
        <img
          src={getGuardianPortrait(zoneId)}
          alt={guardian.name}
          className="absolute max-w-none"
          style={{
            ...window,
            filter: "brightness(1.32) saturate(1.3) contrast(1.06)",
          }}
          draggable={false}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            borderRadius: "inherit",
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0.34), rgba(255,255,255,0) 36%)",
          }}
        />
      </div>
      {/* Mastery, worn on the corner. Below roughly 30px the star would be
          smaller than its own outline, so the block shows the rim alone. */}
      {badgeColor && size >= 30 && (
        <span
          aria-hidden
          className="absolute grid place-items-center rounded-full"
          style={{
            right: -badgeSize * 0.22,
            bottom: -badgeSize * 0.22,
            width: badgeSize,
            height: badgeSize,
            fontSize: badgeSize * 0.72,
            lineHeight: 1,
            color: badgeColor,
            background: "#0A1120",
            boxShadow: `inset 0 0 0 ${Math.max(1, badgeSize * 0.08)}px ${badgeColor}, 0 1px 3px rgba(0,0,0,0.6)`,
            textShadow: `0 0 ${badgeSize * 0.3}px ${badgeColor}99`,
          }}
        >
          ★
        </span>
      )}
    </motion.div>
  );
};

export default GuardianFaceBlock;
