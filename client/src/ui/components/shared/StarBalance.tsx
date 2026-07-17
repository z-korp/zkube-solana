import React from "react";

import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { cn } from "@/ui/utils";

interface StarBalanceProps {
  value: string | number;
  /** md → text-2xl figure with a text-[10px] label; lg → text-3xl / text-[11px]. */
  size?: "md" | "lg";
  align?: "left" | "right";
  /** Label color override; defaults to the shared text-white/50. */
  labelColor?: string;
  /** Extra label classes (e.g. spacing). */
  labelClassName?: string;
  className?: string;
}

/** The "★ n / Stars balance" block shared by Home, Profile, and the Shop. */
const StarBalance: React.FC<StarBalanceProps> = ({
  value,
  size = "md",
  align = "left",
  labelColor,
  labelClassName,
  className,
}) => {
  const colors = useThemeColors();

  return (
    <div className={cn(align === "right" && "text-right", className)}>
      <p
        className={cn(
          "font-sans font-black leading-none",
          size === "lg" ? "text-3xl" : "text-2xl",
        )}
        style={{ color: colors.accent2 }}
      >
        ★ {value}
      </p>
      <p
        className={cn(
          "font-sans font-semibold",
          size === "lg" ? "text-[11px]" : "text-[10px]",
          !labelColor && "text-white/50",
          labelClassName,
        )}
        style={labelColor ? { color: labelColor } : undefined}
      >
        Stars balance
      </p>
    </div>
  );
};

export default StarBalance;
