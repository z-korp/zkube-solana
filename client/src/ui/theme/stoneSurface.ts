/**
 * The screen the board is cut into.
 *
 * One stone for the whole phone, taken from the realm's own `grid-bg.png` —
 * which is not a texture we invented for this: it is a carved slab, and each
 * realm's carries its own iconography (tiki faces, hieroglyphs, Mayan glyphs).
 *
 * It is retinted rather than used as-is. A `color` blend takes hue and
 * saturation from the flat layer and LUMINANCE from the image, so the carving
 * survives while the colour becomes the realm's — and a flat darkening layer
 * on top lands every realm on the same value. Without that, the identical slab
 * treatment made Polynesia read bright and Egypt read black.
 */
import type { CSSProperties } from "react";

import type { ThemeColors } from "@/config/themes";

/** How far the stone sits below the board it frames. */
const DARKEN = 0.62;

export function stoneSurface(colours: ThemeColors): CSSProperties {
  const tint = colours.accent;
  return {
    backgroundImage: [
      `linear-gradient(0deg, rgba(0,0,0,${DARKEN}), rgba(0,0,0,${DARKEN}))`,
      `linear-gradient(0deg, ${tint}, ${tint})`,
      "var(--theme-grid-bg-image, none)",
    ].join(", "),
    backgroundBlendMode: "normal, color, normal",
    backgroundSize: "cover, cover, cover",
    backgroundPosition: "center",
    backgroundColor: "var(--theme-grid-bg, #10172A)",
  };
}

/** The board is a well cut into that stone, so its edges fall into shadow. */
export const BOARD_WELL: CSSProperties = {
  boxShadow:
    "inset 0 0 0 1px rgba(201,169,110,0.22), inset 0 14px 22px rgba(0,0,0,0.75), inset 0 -14px 22px rgba(0,0,0,0.75)",
};
