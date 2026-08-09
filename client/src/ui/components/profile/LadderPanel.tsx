import {
  LADDER_TIER_THRESHOLDS,
  isTopLadderTier,
  ladderTierColor,
  ladderTierName,
  ladderTierProgress,
} from "@/config/ladderTiers";
import { MONEY_GOLD, TierBlock, mixHex } from "@/ui/components/economy";

const PANEL_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, #131F35 0%, #0D1626 100%)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow:
    "0 12px 30px rgba(0,0,0,0.4), inset 0 1.5px 0 rgba(255,255,255,0.09)",
};

const SECTION_CLASS =
  "font-sans text-[10px] font-bold uppercase tracking-[0.22em] text-white/45";

interface LadderPanelProps {
  /** Cumulative ladder total. Only ever increases. */
  points: bigint;
  /** Highest tier ever reached, which a later reset cannot take away. */
  highestTier: number;
}

/**
 * The ladder rack — every tier at once, so the climb is visible rather than
 * inferred. Reached blocks stand at full colour, the current one carries its
 * own ring, and the rest wait dimmed. The bar underneath is the only moving
 * part: it fills through a tier and states what is left to the next.
 *
 * This is the progress a board cannot show. A board pays a small share of the
 * field, but every qualifying run moves this, so a player outside the money
 * still watches something climb.
 */
const LadderPanel: React.FC<LadderPanelProps> = ({ points, highestTier }) => {
  const tier =
    LADDER_TIER_THRESHOLDS.filter((threshold) => points >= threshold).length - 1;
  const current = Math.max(0, tier);
  const { fraction, remaining } = ladderTierProgress(points, current);
  const color = ladderTierColor(current);
  const atTop = isTopLadderTier(current);

  return (
    <section className="relative z-10 rounded-2xl p-4" style={PANEL_STYLE}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={SECTION_CLASS}>Ladder</p>
        <span
          className="font-mono text-[13px] font-bold tabular-nums"
          style={{ color: MONEY_GOLD }}
        >
          {Number(points).toLocaleString()}
          <span className="ml-1 font-sans text-[8px] font-bold uppercase tracking-[0.1em] text-white/45">
            pts
          </span>
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        {LADDER_TIER_THRESHOLDS.map((_, index) => (
          <div
            key={index}
            className="rounded-[24%]"
            style={
              index === current
                ? { boxShadow: `0 0 0 2px ${color}, 0 0 16px ${color}66` }
                : undefined
            }
          >
            <TierBlock tier={index} size={52} locked={index > current} />
          </div>
        ))}
      </div>

      <div
        className="mt-3.5 h-2 overflow-hidden rounded-full"
        style={{ background: "rgba(0,0,0,0.45)" }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.round(fraction * 100)}%`,
            background: `linear-gradient(90deg, ${mixHex(color, 0, 0.2)}, ${mixHex(color, 255, 0.35)})`,
            boxShadow: `0 0 10px ${color}88`,
          }}
        />
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span
          className="font-display text-[22px] leading-none"
          style={{ color }}
        >
          {ladderTierName(current)}
        </span>
        <span className="font-mono text-[11px] font-semibold tabular-nums text-white/50">
          {atTop
            ? "Top tier"
            : `${Number(remaining).toLocaleString()} to ${ladderTierName(current + 1)}`}
        </span>
      </div>

      {highestTier > current && (
        <p className="mt-2 border-t border-white/[0.05] pt-2 font-mono text-[11px] font-semibold text-white/50">
          Best ever · {ladderTierName(highestTier)}
        </p>
      )}
    </section>
  );
};

export default LadderPanel;
