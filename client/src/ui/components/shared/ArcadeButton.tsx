import type { ReactNode } from "react";
import { motion } from "motion/react";
import { mixHex } from "@/ui/components/economy";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";

interface ArcadeButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  accentOverride?: string;
}

/**
 * The chunky pressable block CTA — same furniture language as the guardian
 * blocks: diagonal light→dark accent body, hard undershadow, real 4px press
 * travel. Blocks are pressable; glass is a readout.
 */
const ArcadeButton: React.FC<ArcadeButtonProps> = ({
  children,
  onClick,
  disabled = false,
  className = "",
  accentOverride,
}) => {
  const themeColors = useThemeColors();
  const accent = accentOverride ?? themeColors.accent;
  const under = mixHex(accent, 0, 0.55);

  return (
    <motion.button
      whileTap={
        disabled
          ? undefined
          : {
              y: 4,
              boxShadow: `0 1px 0 ${under}, 0 4px 14px -10px ${accent}AA, inset 0 2px 0 rgba(255,255,255,0.5)`,
            }
      }
      disabled={disabled}
      onClick={onClick}
      className={`relative w-full overflow-hidden rounded-2xl px-4 py-4 text-center font-sans text-[18px] font-extrabold uppercase tracking-[0.1em] disabled:cursor-not-allowed disabled:opacity-55 ${className}`}
      style={{
        color: "#0a1628",
        background: `linear-gradient(160deg, ${mixHex(accent, 255, 0.42)} 0%, ${accent} 55%, ${mixHex(accent, 0, 0.28)} 100%)`,
        boxShadow: `0 5px 0 ${under}, 0 12px 26px -10px ${accent}AA, inset 0 2px 0 rgba(255,255,255,0.5)`,
      }}
    >
      <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.28),transparent)] opacity-60" />
      <span className="relative z-10 inline-flex items-center justify-center gap-2">
        {children}
      </span>
    </motion.button>
  );
};

export default ArcadeButton;
