import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { cn } from "@/ui/utils";

interface ZoneBackdropProps {
  /** Zone whose painted background art is revealed (1..10). */
  zoneId: number;
  /**
   * Opacity of the painted zone image over the solid base. Tuned so the menu
   * panels sit on clearly visible art; defaults to the 0.55–0.7 band.
   */
  imageOpacity?: number;
  className?: string;
}

/**
 * Shared menu-page background layer. Renders the active zone's painted art over
 * a solid base, then a LIGHT gradient veil — so the opaque menu panels stack on
 * top of a painting that stays clearly visible around them. This replaces the
 * old HomePage approach (a dim opacity-25 image under a near-opaque veil that
 * buried the art). The in-run play board never uses this; it keeps its own
 * chrome.
 *
 * The solid base is opaque so this reads identically wherever it is dropped —
 * it does not depend on, and never double-exposes, the global ThemeBackground.
 */
const ZoneBackdrop: React.FC<ZoneBackdropProps> = ({
  zoneId,
  imageOpacity = 0.62,
  className,
}) => {
  const themeId = getThemeId(zoneId);
  const images = getThemeImages(themeId);
  const colors = getThemeColors(themeId);

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      {/* Opaque base so the art reads consistently over anything behind it. */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: colors.background }}
      />
      {/* The painted zone art, revealed through the light veil below. */}
      <img
        src={images.background}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ opacity: imageOpacity }}
      />
      {/* Light gradient veil — keeps text legible without hiding the painting. */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,18,0.35)_0%,rgba(2,6,18,0.5)_45%,rgba(2,5,13,0.8)_100%)]" />
    </div>
  );
};

export default ZoneBackdrop;
