import { Map } from "lucide-react";

import { cn } from "@/ui/utils";

import type { ArcadeLifecycle } from "./arcadeLifecycle";

interface DailyStatusPanelProps {
  /** Current Trial lifecycle; only non-playable states reach this panel. */
  lifecycle: ArcadeLifecycle;
  /** Navigate to the Campaign tab (same destination as the bottom nav). */
  onPlayCampaign: () => void;
  className?: string;
}

/**
 * The Arcade home's pot placeholder while today's Daily is not playable.
 * `preparing` is the normal post-midnight grace and only states the schedule.
 * `delayed` and `stale` mean the keeper is running late; settlement is
 * push-only and never cancelled, so the panel stays calm and offers Campaign
 * — free, and never a gate on ranked play — as something to do while waiting.
 * That offer stays in the quiet glass register, secondary to the page's
 * disabled primary keeper-status button, and never appears during normal
 * preparation or an open Daily.
 */
const DailyStatusPanel: React.FC<DailyStatusPanelProps> = ({
  lifecycle,
  onPlayCampaign,
  className,
}) => {
  const keeperLate = lifecycle === "delayed" || lifecycle === "stale";

  return (
    <div
      className={cn(
        "rounded-3xl border border-white/[0.1] bg-black/30 p-5 backdrop-blur-xl",
        className,
      )}
    >
      <p className="font-sans text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">
        Today&apos;s pot
      </p>
      <p className="mt-2 font-display text-lg font-black text-white">
        {lifecycle === "delayed"
          ? "Today’s Daily is running late"
          : lifecycle === "stale"
            ? "Yesterday’s Daily is still visible"
            : "Daily being prepared"}
      </p>
      <p className="mt-1 font-sans text-xs font-semibold text-white/55">
        {keeperLate
          ? "The keeper is catching up. Entries open as soon as today’s Daily is ready."
          : "Opens 00:00 UTC"}
      </p>

      {keeperLate && (
        <button
          type="button"
          onClick={onPlayCampaign}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/[0.14] bg-white/[0.06] px-3 py-2.5 font-sans text-xs font-bold uppercase tracking-[0.12em] text-white/85 transition-colors hover:bg-white/[0.1] active:bg-white/[0.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
        >
          <Map size={14} aria-hidden="true" className="shrink-0 opacity-80" />
          Play Campaign while you wait
        </button>
      )}
    </div>
  );
};

export default DailyStatusPanel;
