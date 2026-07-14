import React, { type ReactNode } from "react";
import { motion } from "motion/react";

import { cn } from "@/ui/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  titleColor?: string;
  hintColor?: string;
  /** Tighter vertical padding for in-card empty blocks. */
  compact?: boolean;
  className?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  hint,
  titleColor,
  hintColor,
  compact = false,
  className,
}) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    className={cn(
      "flex flex-col items-center justify-center text-center",
      compact ? "py-8" : "py-16",
      className,
    )}
  >
    {icon && <div className="mb-4 opacity-50">{icon}</div>}
    <p
      className={cn(
        "mb-1 font-sans font-semibold",
        compact ? "text-base" : "text-xl",
      )}
      style={{ color: titleColor ?? "rgba(255,255,255,0.9)" }}
    >
      {title}
    </p>
    {hint && (
      <p
        className={cn("font-sans", compact ? "text-sm" : "text-base")}
        style={{ color: hintColor ?? "rgba(255,255,255,0.5)" }}
      >
        {hint}
      </p>
    )}
  </motion.div>
);

export default EmptyState;
