import {
  GUARDIAN_FRAME_ZONES,
  getGuardianPortrait,
} from "@/config/bossCharacters";

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

export const GUARDIAN_FACE_CROPS: Record<number, FaceCropBox> = {
  1: [300, 100, 480, 280], // Mako — turtle head, upper right
  2: [66, 110, 446, 430], // Sobek — head incl. brow ridges and jaw in water
  3: [210, 15, 490, 295], // Fenris — snarling head upper right, ears clear
  4: [165, 20, 370, 225], // Noctua — owl head incl. horn tufts
  5: [120, 30, 410, 380], // Long — dragon head incl. antlers and beard
  6: [155, 40, 350, 265], // Lamassu — lion head incl. mane crest
  7: [150, 20, 390, 260], // Kitsune — fox head incl. both ears
  8: [130, 95, 400, 365], // Balam — jaguar head
  9: [220, 10, 438, 228], // Mamba — cobra head incl. hood
  10: [140, 75, 380, 315], // Kuntur — condor head inside the sun disc
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

export { GUARDIAN_FRAME_ZONES };

export function hasGuardianFrames(zoneId: number): boolean {
  return GUARDIAN_FRAME_ZONES.has(zoneId);
}

export function getGuardianFrame(
  zoneId: number,
  frame: GuardianFrameId,
): string {
  if (!hasGuardianFrames(zoneId)) return getGuardianPortrait(zoneId);
  const clamped = Math.min(10, Math.max(1, zoneId || 1));
  return `/assets/theme-${clamped}/boss/${frame}.png`;
}
