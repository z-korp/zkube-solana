/**
 * Geometry of the ladder border artwork.
 *
 * Measured and printed by `client/tools/sprites/install-tier-frames.py`, which
 * is the only thing allowed to change these numbers: they describe the files it
 * writes.
 *
 * Per tier rather than one constant because the ornaments do not share a
 * margin — prism's crystal wings reach much further past their opening than
 * slate's studs. Forcing every frame to one ratio cropped the elaborate ranks,
 * so each carries its own and a higher tier legitimately overhangs more.
 */
export const TIER_FRAME_OPENINGS: readonly number[] = [
  0.8255, 0.6673, 0.7078, 0.5886, 0.6177,
];

/** Overlap: the framed art tucks under the band instead of leaving a seam. */
export const TIER_FRAME_TUCK = 1.03;

/** Fraction of a tier's artwork taken up by its opening. */
export function tierFrameOpening(tier: number): number {
  return TIER_FRAME_OPENINGS[tier] ?? TIER_FRAME_OPENINGS[0]!;
}

/** Whole-ornament size for a given framed-artwork size. */
export function tierFrameOuterSize(tier: number, artSize: number): number {
  return Math.round((artSize * TIER_FRAME_TUCK) / tierFrameOpening(tier));
}

/**
 * Artwork size that makes a tier's whole ornament fit a fixed box.
 *
 * A list needs every row the same width. Sizing the *box* and deriving the
 * artwork keeps rows aligned and every ornament whole; the portrait then varies
 * a few pixels between ranks, which is the cheaper of the two inconsistencies.
 */
export function tierFrameInnerSize(tier: number, boxSize: number): number {
  return Math.round((boxSize * tierFrameOpening(tier)) / TIER_FRAME_TUCK);
}
