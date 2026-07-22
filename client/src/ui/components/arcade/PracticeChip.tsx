import { Sparkles } from "lucide-react";

/**
 * Compact, secondary affordance for the free unranked Practice run against
 * yesterday's finalized Arena. The ranked entry is always the primary CTA; this
 * chip only appears when Practice is actually enterable.
 */
const PracticeChip: React.FC<{
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}> = ({ onClick, busy = false, disabled = false }) => {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.08] px-4 py-3 text-cyan-100 transition-colors hover:bg-cyan-300/[0.12] disabled:cursor-not-allowed disabled:opacity-55"
    >
      <Sparkles size={16} className="text-cyan-200" />
      <span className="font-sans text-sm font-bold">
        {busy ? "Preparing…" : "Practice free · unranked"}
      </span>
    </button>
  );
};

export default PracticeChip;
