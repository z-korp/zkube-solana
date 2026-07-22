import type { DailyView } from "@/chain/dailyClient";
import { DAILY_WEIGHTS, DualPot } from "@/ui/components/economy";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";

interface TrialPotProps {
  /** Today's authoritative Daily view, or null while it is being prepared. */
  view: DailyView | null;
  /** Lamports building the next Weekly, or null while preparing. */
  followingWeeklyLamports: bigint | null;
  /** Lamports building the Season, or null while preparing. */
  followingSeasonLamports: bigint | null;
  /**
   * `live` shows the signature dual-pot as-is; `settling` adds a settling
   * ribbon; `preparing` (or a null view) shows the being-prepared placeholder.
   */
  mode: "live" | "settling" | "preparing";
  /** UTC wall-clock label for when runs score, e.g. "23:30 UTC". */
  runsCloseLabel?: string;
}

/**
 * The signature two-sided pot for the Trial home. Wraps the shared `DualPot`
 * so every lifecycle state reuses the same money surface: live during entries,
 * a settling ribbon once entries close, and a matching placeholder card while
 * today's guaranteed pot is still being prepared.
 */
const TrialPot: React.FC<TrialPotProps> = ({
  view,
  followingWeeklyLamports,
  followingSeasonLamports,
  mode,
  runsCloseLabel,
}) => {
  const colors = useThemeColors();

  if (mode === "preparing" || !view) {
    return (
      <div
        className="rounded-3xl border bg-black/40 p-5 backdrop-blur-xl"
        style={{
          borderColor: `${colors.accent}33`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05)`,
        }}
      >
        <p className="font-sans text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">
          Today&apos;s pot
        </p>
        <p className="mt-2 font-display text-lg font-black text-white">
          Daily being prepared
        </p>
        <p className="mt-1 font-sans text-xs font-semibold text-white/55">
          Opens 00:00 UTC
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {mode === "settling" && (
        <div className="rounded-2xl border border-yellow-400/30 bg-yellow-400/[0.08] px-3 py-2">
          <p className="font-sans text-[11px] font-bold uppercase tracking-[0.12em] text-yellow-200">
            Settling
          </p>
          <p className="mt-0.5 font-sans text-xs font-semibold text-white/60">
            Runs score {runsCloseLabel ?? "23:30 UTC"} · prizes push
            automatically
          </p>
        </div>
      )}
      <DualPot
        todayPotLamports={view.dailyPotLamports}
        weights={DAILY_WEIGHTS}
        followingDailyLamports={view.followingDailyLamports}
        followingWeeklyLamports={followingWeeklyLamports}
        followingSeasonLamports={followingSeasonLamports}
        entryLamports={view.entryLamports}
        variant="hero"
      />
    </div>
  );
};

export default TrialPot;
