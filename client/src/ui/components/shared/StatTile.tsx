import React, { type ReactNode } from "react";

import { cn } from "@/ui/utils";

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Value text color; defaults to near-white. */
  color?: string;
  labelColor?: string;
  size?: "sm" | "md";
  className?: string;
}

const StatTile: React.FC<StatTileProps> = ({
  label,
  value,
  color,
  labelColor,
  size = "md",
  className,
}) => (
  <div
    className={cn(
      "border border-white/[0.1] bg-white/[0.06] text-center backdrop-blur-xl",
      size === "md" ? "rounded-2xl px-3 py-3" : "rounded-xl px-2 py-2",
      className,
    )}
  >
    <p
      className={cn(
        "font-sans font-black",
        size === "md" ? "text-2xl" : "text-lg",
      )}
      style={{ color: color ?? "rgba(255,255,255,0.92)" }}
    >
      {value}
    </p>
    <p
      className={cn(
        "font-sans",
        size === "md"
          ? "text-xs font-semibold"
          : "text-[10px] font-bold uppercase",
      )}
      style={{ color: labelColor ?? "rgba(255,255,255,0.45)" }}
    >
      {label}
    </p>
  </div>
);

export default StatTile;
