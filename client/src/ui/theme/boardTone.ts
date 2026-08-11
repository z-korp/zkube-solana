/**
 * The board's tones, per realm, derived from the theme table.
 *
 * Every realm lands on the SAME luminance and differs only in hue. That is not
 * a stylistic preference — mixing a colour toward white or black preserves its
 * saturation, so the identical recipe made Polynesia's saturated navy read
 * bright while Egypt's near-black brown read dark. Normalising luminance and
 * pulling chroma in proportion to saturation is what makes ten realms one game.
 *
 * Values are the ones the layout study settled on: the ground sits at L 9, a
 * cell cap runs L 23 → 15 top to bottom, a block's backing takes L 19 so a
 * filled cell reads as the same tile carrying a motif, and the cap's rim is the
 * realm accent at L 96 held at low alpha.
 */
import type { ThemeColors } from "@/config/themes";

const L_GROUND = 9;
const L_CAP_TOP = 23;
const L_CAP_BOTTOM = 15;
/** A block's backing: the cap's own face, so a piece nests instead of covering. */
const L_BLOCK_BACKING = 19;
const L_RIM = 96;

/** Rec. 709 relative luminance, which is what the eye actually reads. */
function luminance([r, g, b]: RGB): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export type RGB = readonly [number, number, number];

function parse(hex: string): RGB {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as RGB;
}

function setLuminance(colour: RGB, target: number): RGB {
  const current = luminance(colour);
  // A pure black carries no hue to preserve, so it becomes neutral grey.
  if (current < 1.5) return [target, target, target];
  const factor = target / current;
  return colour.map((v) => Math.min(255, Math.max(0, Math.round(v * factor)))) as unknown as RGB;
}

/**
 * Pull chroma toward the colour's own grey, harder the more saturated it is.
 * A saturated hue reads brighter than its luminance says, so without this the
 * blue realms sit forward of the brown ones at identical L.
 */
function temper(colour: RGB): RGB {
  const grey = luminance(colour);
  const chroma = Math.max(...colour) - Math.min(...colour);
  const amount = Math.min(0.45, 0.18 + (chroma / 255) * 0.45);
  return colour.map((v) => Math.round(v + (grey - v) * amount)) as unknown as RGB;
}

function css([r, g, b]: RGB): string {
  return `rgb(${r},${g},${b})`;
}

function tone(hex: string, target: number): RGB {
  return temper(setLuminance(parse(hex), target));
}

export interface BoardTone {
  /** Behind everything inside the board. */
  ground: string;
  /** A cell cap, lit from above. */
  capTop: string;
  capBottom: string;
  /** The cap's rim, in the realm's accent. */
  rim: string;
  /** What a block's black backing is replaced with. */
  blockBacking: RGB;
}

export function boardTone(colours: ThemeColors): BoardTone {
  const base = colours.background;
  return {
    ground: css(tone(base, L_GROUND)),
    capTop: css(tone(base, L_CAP_TOP)),
    capBottom: css(tone(base, L_CAP_BOTTOM)),
    rim: css(tone(colours.accent, L_RIM)),
    blockBacking: tone(base, L_BLOCK_BACKING),
  };
}
