import { useState, type ReactNode } from "react";

import Sheet from "@/ui/components/shared/Sheet";

interface InfoTipProps {
  /** Sheet title and the ? button's accessible name. */
  label?: string;
  children: ReactNode;
}

/**
 * The one explainer affordance per surface: a small tappable ? that opens a
 * sheet — same body as Settings — with the rules written in a panel. The
 * surface itself stays numbers.
 */
const InfoTip: React.FC<InfoTipProps> = ({ label = "Rules", children }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen(true)}
        className="grid h-6 w-6 flex-none place-items-center rounded-full border border-white/[0.18] bg-black/40 font-mono text-[11px] font-bold text-white/55"
      >
        ?
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <div
          className="mb-2 rounded-2xl p-4 font-sans text-sm font-semibold leading-relaxed text-white/85"
          style={{
            background: "linear-gradient(180deg, #131F35 0%, #0D1626 100%)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "inset 0 1.5px 0 rgba(255,255,255,0.09)",
          }}
        >
          {children}
        </div>
      </Sheet>
    </>
  );
};

export default InfoTip;
