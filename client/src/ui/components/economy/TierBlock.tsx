import { ladderTierColor } from "@/config/ladderTiers";
import { mixHex } from "./tokens";

interface TierBlockProps {
  /** Protocol tier index. */
  tier: number;
  /** Square size in px. */
  size: number;
  /** Dim an unreached tier without changing its identity. */
  locked?: boolean;
  className?: string;
}

/**
 * A ladder tier as block furniture — the same glossy body, white sticker rim
 * and gloss arc as the guardian blocks, with the tier numeral in the window
 * instead of a portrait. One component from the profile hero to a board row;
 * only `size` changes.
 */
const TierBlock: React.FC<TierBlockProps> = ({
  tier,
  size,
  locked = false,
  className = "",
}) => {
  const base = ladderTierColor(tier);
  const rimWidth = Math.max(2, size * 0.045);

  return (
    <div
      aria-hidden
      className={`relative flex-none ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: "24%",
        background: `linear-gradient(135deg, ${mixHex(base, 255, 0.5)} 0%, ${base} 55%, ${mixHex(base, 0, 0.38)} 100%)`,
        boxShadow: [
          `inset 0 0 0 ${rimWidth}px rgba(255,255,255,0.92)`,
          `0 ${size * 0.055}px ${size * 0.1}px rgba(0,0,0,0.45)`,
        ].join(", "),
        // An unreached tier is unlit, never broken: it keeps its colour and
        // its material so the rack reads as a ladder rather than as damage.
        opacity: locked ? 0.62 : 1,
        filter: locked ? "saturate(0.5) brightness(0.85)" : undefined,
      }}
    >
      <div
        className="absolute grid place-items-center overflow-hidden"
        style={{
          inset: "8.5%",
          borderRadius: "20%",
          background: `radial-gradient(circle at 50% 38%, ${mixHex(base, 255, 0.3)}, ${mixHex(base, 0, 0.45)} 85%)`,
          boxShadow: `inset 0 0 0 ${Math.max(1, size * 0.02)}px rgba(0,0,0,0.35)`,
        }}
      >
        {/* A heavy sans numeral, not the display serif: inside chunky sticker
            furniture an etched face reads as ornament rather than as rank. */}
        <span
          className="relative z-10 font-sans font-black leading-none tabular-nums"
          style={{
            fontSize: size * 0.46,
            color: "rgba(255,255,255,0.97)",
            textShadow: `0 1.5px 0 ${mixHex(base, 0, 0.6)}, 0 2px 8px rgba(0,0,0,0.55)`,
          }}
        >
          {tier + 1}
        </span>
        <span
          className="pointer-events-none absolute inset-0"
          style={{
            borderRadius: "inherit",
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0.34), rgba(255,255,255,0) 36%)",
          }}
        />
      </div>
    </div>
  );
};

export default TierBlock;
