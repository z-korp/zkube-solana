import React from "react";
import { Loader2 } from "lucide-react";

import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { cn } from "@/ui/utils";

/** Bare accent-colored spinner (defaults to h-7 w-7). */
export const Spinner: React.FC<{ className?: string }> = ({ className }) => {
  const colors = useThemeColors();
  return (
    <Loader2
      className={cn("h-7 w-7 animate-spin", className)}
      style={{ color: colors.accent }}
    />
  );
};

interface LoadingStateProps {
  /** Muted caption under the spinner; omit for a spinner-only block. */
  label?: string;
  /** Vertical padding etc. on the centered column. */
  className?: string;
  /** Spinner size/margin overrides (e.g. "mb-4 h-8 w-8"). */
  spinnerClassName?: string;
}

/** Centered column spinner with an optional muted label. */
const LoadingState: React.FC<LoadingStateProps> = ({
  label,
  className,
  spinnerClassName,
}) => {
  const colors = useThemeColors();

  return (
    <div
      className={cn("flex flex-col items-center justify-center", className)}
      style={{ color: colors.textMuted }}
    >
      <Spinner className={spinnerClassName} />
      {label && <p className="font-sans text-sm font-medium">{label}</p>}
    </div>
  );
};

export default LoadingState;
