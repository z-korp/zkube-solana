import { useState } from "react";
import { Crown, Globe2, Sparkles } from "lucide-react";

import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import {
  REALM_CONQUEROR_EMBLEM_ID,
  WORLD_PERFECT_EMBLEM_ID,
  resolveLeaderboardEmblem,
} from "@/config/emblems";
import { ZoneIcon } from "@/config/zoneIcons";
import { cn } from "@/ui/utils";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";

import { MONEY_GOLD } from "./tokens";

type EmblemBadgeState = "unlocked" | "locked" | "gold";

interface EmblemBadgeProps {
  /** On-chain emblem id: 0 auto, 1..10 guardians, 11 Realm, 12 World Perfect. */
  emblemId: number;
  /** Total Campaign stars — used to derive `state` when it is not supplied. */
  totalStars?: number;
  /** Explicit render state; when omitted it is derived from `totalStars`. */
  state?: EmblemBadgeState;
  /** Tile edge length in px (default 56). */
  size?: number;
  /** Draw the accent selection ring. */
  selected?: boolean;
  /**
   * For a concrete emblem (1..12) that a player selected via "auto", overlay a
   * small corner "auto" tag. The auto tile itself (id 0) always shows its own
   * mark and tag regardless of this flag. Defaults to false.
   */
  showAuto?: boolean;
  className?: string;
}

/**
 * Presentational emblem tile. Guardians (1..10) render their portrait with an
 * emoji fallback; the auto slot (0) shows a ✦ mark, Realm Conqueror (11) a
 * crown, World Perfect (12) a globe. Gold gets a gold ring and glow, locked is
 * dimmed and desaturated, selected adds the accent ring.
 */
const EmblemBadge: React.FC<EmblemBadgeProps> = ({
  emblemId,
  totalStars,
  state,
  size,
  selected,
  showAuto = false,
  className,
}) => {
  const colors = useThemeColors();
  const [imgError, setImgError] = useState(false);

  const resolvedState: EmblemBadgeState =
    state ??
    (() => {
      const { unlocked, gold } = resolveLeaderboardEmblem(
        emblemId,
        totalStars ?? 0,
      );
      return gold ? "gold" : unlocked ? "unlocked" : "locked";
    })();

  const dimension = size ?? 56;
  const isAuto = emblemId === 0;
  const isGuardian = emblemId >= 1 && emblemId <= 10;

  const style: React.CSSProperties = {
    width: dimension,
    height: dimension,
    borderColor: "rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
  };
  if (resolvedState === "gold") {
    style.borderColor = MONEY_GOLD;
    style.background = `${MONEY_GOLD}1a`;
    style.boxShadow = `0 0 14px ${MONEY_GOLD}66`;
  } else if (resolvedState === "locked") {
    style.filter = "grayscale(1)";
    style.opacity = 0.4;
  }
  if (selected) {
    style.borderColor = colors.accent;
    style.boxShadow = `0 0 0 2px ${colors.accent}${
      style.boxShadow ? `, ${style.boxShadow}` : ""
    }`;
  }

  const glyph =
    emblemId === REALM_CONQUEROR_EMBLEM_ID
      ? <Crown className="h-1/2 w-1/2" />
      : emblemId === WORLD_PERFECT_EMBLEM_ID
        ? <Globe2 className="h-1/2 w-1/2" />
        : <Sparkles className="h-1/2 w-1/2" />;

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-xl border",
        className,
      )}
      style={style}
    >
      {isGuardian && !imgError ? (
        <img
          src={getGuardianPortrait(emblemId)}
          alt={getZoneGuardian(emblemId).name}
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setImgError(true)}
        />
      ) : isGuardian ? (
        <ZoneIcon zoneId={emblemId} className="h-1/2 w-1/2" />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center"
          style={{ color: isAuto ? MONEY_GOLD : undefined }}
        >
          {glyph}
        </span>
      )}

      {/* The auto slot always carries its own tag. */}
      {isAuto && (
        <span className="pointer-events-none absolute bottom-0.5 font-sans text-[8px] font-bold uppercase tracking-wide text-white/55">
          auto
        </span>
      )}

      {/* A concrete emblem resolved from an auto selection. */}
      {!isAuto && showAuto && (
        <span
          className="pointer-events-none absolute right-0.5 top-0.5 rounded px-1 font-sans text-[7px] font-black uppercase leading-tight"
          style={{ background: `${colors.accent}dd`, color: "#000" }}
        >
          auto
        </span>
      )}
    </div>
  );
};

export default EmblemBadge;
