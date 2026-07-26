import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import { ZoneIcon } from "@/config/zoneIcons";
import { cn } from "@/ui/utils";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";

interface GuardianMedallionProps {
  /** Campaign zone id (1..10); clamped to the guardian range. */
  zoneId: number;
  /** Diameter in px (default 64). */
  size?: number;
  /** Add an accent glow behind the medallion. */
  glow?: boolean;
  className?: string;
}

/**
 * Circular guardian medallion: the zone guardian portrait (emoji fallback)
 * inside an accent-bordered ring, with an optional accent glow. Breathes gently
 * unless the viewer prefers reduced motion.
 */
const GuardianMedallion: React.FC<GuardianMedallionProps> = ({
  zoneId,
  size,
  glow = false,
  className,
}) => {
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const [imgError, setImgError] = useState(false);

  const dimension = size ?? 64;
  const guardian = getZoneGuardian(zoneId);

  return (
    <motion.div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-full border-2",
        className,
      )}
      style={{
        width: dimension,
        height: dimension,
        borderColor: colors.accent,
        background: `${colors.accent}14`,
        boxShadow: glow ? `0 0 18px ${colors.accent}66` : undefined,
      }}
      animate={reduceMotion ? undefined : { scale: [1, 1.04, 1] }}
      transition={
        reduceMotion
          ? undefined
          : { duration: 4, repeat: Infinity, ease: "easeInOut" }
      }
    >
      {imgError ? (
        <ZoneIcon zoneId={zoneId} className="h-1/2 w-1/2" />
      ) : (
        <img
          src={getGuardianPortrait(zoneId)}
          alt={guardian.name}
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setImgError(true)}
        />
      )}
    </motion.div>
  );
};

export default GuardianMedallion;
