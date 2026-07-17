import React from "react";

import { cn } from "@/ui/utils";
import { truncatePublicKey } from "@/utils/solanaDisplay";

interface WalletChipProps {
  address: string;
  /** Display text; defaults to the truncated address. */
  label?: string;
  /** Renders the pill as a button when provided. */
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
  className?: string;
}

/** The rounded wallet-address pill shared by Home and Profile. */
const WalletChip: React.FC<WalletChipProps> = ({
  address,
  label,
  onClick,
  title,
  ariaLabel,
  className,
}) => {
  const pillClassName = cn(
    "inline-flex max-w-full items-center rounded-full border border-white/[0.12] bg-white/[0.06] px-2 py-0.5",
    className,
  );
  const text = (
    <span className="truncate font-mono text-[11px] font-semibold text-white/60">
      {label ?? truncatePublicKey(address)}
    </span>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={ariaLabel}
        className={pillClassName}
      >
        {text}
      </button>
    );
  }

  return (
    <span className={pillClassName} title={title} aria-label={ariaLabel}>
      {text}
    </span>
  );
};

export default WalletChip;
