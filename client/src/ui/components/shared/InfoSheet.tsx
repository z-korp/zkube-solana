import React, { useState, type ReactNode } from "react";
import { Info } from "lucide-react";

import Sheet from "@/ui/components/shared/Sheet";
import { cn } from "@/ui/utils";

interface InfoSheetProps {
  /** Trigger text; defaults to "How it works". */
  label?: string;
  title: string;
  children: ReactNode;
  className?: string;
}

/**
 * Standard disclosure for protocol/economy detail copy: a small inline
 * trigger that opens a bottom Sheet with the full rules, so screens keep a
 * single plain-language line.
 */
const InfoSheet: React.FC<InfoSheetProps> = ({
  label = "How it works",
  title,
  children,
  className,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 font-sans text-xs font-bold text-white/55 transition-colors hover:text-white/80",
          className,
        )}
      >
        <Info size={13} />
        {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div className="flex flex-col gap-3 pb-1 font-sans text-sm leading-relaxed text-white/75">
          {children}
        </div>
      </Sheet>
    </>
  );
};

export function InfoRow({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/10 py-2 last:border-b-0">
      <span className="font-sans text-xs font-semibold text-white/55">
        {label}
      </span>
      <span className="text-right font-sans text-xs font-bold text-white/85">
        {value}
      </span>
    </div>
  );
}

export default InfoSheet;
