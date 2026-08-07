
/**
 * Face crops, tier colours, and expression frames for the guardian block
 * system — the single source of truth shared by the boot reveal, the
 * settlement surfaces, and any future guardian-block component.
 *
 * Crops are axis-aligned boxes in the 512×512 portrait space, deliberately
 * loose: the WHOLE head, including its topmost and bottommost features, must
 * sit inside the box with margin. Tight crops that clip horns, ears, or jaw
 * have been rejected repeatedly — zoom out, never in.
 */

export type FaceCropBox = readonly [x1: number, y1: number, x2: number, y2: number];

// Boxes derived from the v3 bust masters (union of the compositor's eye and
// mouth masks, expanded for margin — see tools/sprites/composite-flips.py).
export const GUARDIAN_FACE_CROPS: Record<number, FaceCropBox> = {
  1: [70, 71, 435, 354], // Mako
  2: [38, 64, 472, 512], // Sobek
  3: [109, 91, 396, 374], // Fenris
  4: [86, 93, 419, 332], // Noctua
  5: [117, 121, 388, 404], // Long
  6: [95, 73, 405, 377], // Lamassu
  7: [118, 132, 382, 378], // Kitsune
  8: [95, 111, 405, 394], // Balam
  9: [58, 65, 462, 485], // Mamba
  10: [103, 87, 397, 363], // Kuntur
};

/** One glossy block body colour per realm (the app-icon tier colours). */
export const GUARDIAN_TIER_COLORS: Record<number, string> = {
  1: "#6FB5EF",
  2: "#E8C86A",
  3: "#9FB6C9",
  4: "#C6D3DE",
  5: "#46C87C",
  6: "#4E7BE0",
  7: "#E8455E",
  8: "#5FBF52",
  9: "#2FCFC0",
  10: "#E89A3C",
};

/**
 * Soft edge bleed for bust art. A bust drawn to the bottom of its own PNG
 * meets the dialogue box as a hard horizontal slice through the chest, so
 * the last third dissolves instead. Deliberately ONE gradient layer: a
 * multi-layer mask needs mask-composite, which silently no-ops in enough
 * engines to have shipped the hard cut twice.
 */
const BUST_FADE = "linear-gradient(to bottom, black 62%, transparent 98%)";

export const GUARDIAN_BUST_FADE_STYLE = {
  maskImage: BUST_FADE,
  WebkitMaskImage: BUST_FADE,
  maskSize: "100% 100%",
  WebkitMaskSize: "100% 100%",
  maskRepeat: "no-repeat",
  WebkitMaskRepeat: "no-repeat",
} as const;

const PORTRAIT_SPACE = 512;

/**
 * Squarified crop: the box expanded to a square around its centre and clamped
 * to the portrait bounds, plus the CSS placement for an <img> inside a square
 * window (percentages relative to the window box).
 */
export function getFaceWindowStyle(zoneId: number): {
  width: string;
  left: string;
  top: string;
} {
  const [x1, y1, x2, y2] = GUARDIAN_FACE_CROPS[zoneId] ?? GUARDIAN_FACE_CROPS[1];
  const side = Math.max(x2 - x1, y2 - y1);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const sx = Math.max(0, Math.min(PORTRAIT_SPACE - side, cx - side / 2));
  const sy = Math.max(0, Math.min(PORTRAIT_SPACE - side, cy - side / 2));
  const scale = PORTRAIT_SPACE / side;
  return {
    width: `${scale * 100}%`,
    left: `${-(sx / side) * 100}%`,
    top: `${-(sy / side) * 100}%`,
  };
}

export type GuardianFrameId =
  | "idle"
  | "talk-open"
  | "talk-mid"
  | "blink"
  | "celebrate"
  | "satisfied"
  | "greeting"
  | "defeated"
  | "surprised";

export function getGuardianFrame(
  zoneId: number,
  frame: GuardianFrameId,
): string {
  const clamped = Math.min(10, Math.max(1, zoneId || 1));
  return `/assets/theme-${clamped}/boss/${frame}.png`;
}
