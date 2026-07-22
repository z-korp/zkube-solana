import { useCountdown } from "@/hooks/useNowTick";
import { formatCountdown } from "@/utils/time";

/**
 * Live, once-per-second countdown to the moment paid entries close. Flips to a
 * closed label at zero. Presentational only — the window boundary is supplied
 * by the page from the authoritative Daily view.
 */
const EntriesCountdown: React.FC<{ endsAt: number }> = ({ endsAt }) => {
  const seconds = useCountdown(endsAt);

  if (seconds <= 0) {
    return (
      <span className="font-sans text-xs font-bold uppercase tracking-[0.14em] text-white/55">
        Entries closed
      </span>
    );
  }

  return (
    <span className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
      Entries close in{" "}
      <span className="tabular-nums text-white">{formatCountdown(seconds)}</span>
    </span>
  );
};

export default EntriesCountdown;
