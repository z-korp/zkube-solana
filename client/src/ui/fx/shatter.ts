/**
 * The shatter effect — one vocabulary for every place blocks break apart.
 *
 * The boot reveal established the look: a sprite is sliced into a grid of
 * fragments, each thrown outward with its own spin and pulled down by gravity,
 * accompanied by a confetti of small colour chips. This module is the shared
 * implementation so the board's line clear and the boot cannot drift apart.
 *
 * Two properties are deliberate:
 *
 * - **Scale-invariant.** Every velocity, distance and gravity term is a
 *   multiple of `cell` (the fragment's own size in px), so the same numbers
 *   read identically on a 40px board block and a 300px boot block.
 * - **Closed-form in time.** A particle's position is p0 + v·t + ½g·t² rather
 *   than integrated per frame, so the animation is framerate-independent, can
 *   be seeked to any instant, and never drifts.
 */

/**
 * How hard a shatter throws, in the caller's own units per second.
 *
 * The values are absolute rather than relative to a fragment, because the two
 * shatters in the app want genuinely different reach: board debris stays around
 * the row it came from, while the boot reveal's has to cross the composition.
 * `cellTuning` below derives the board's scale-invariant profile, and the boot
 * passes its own.
 */
export interface ShatterTuning {
  /** Outward speed range. */
  speedMin: number;
  speedSpan: number;
  /** Sideways scatter added on top of the outward throw. */
  jitter: number;
  /** Extra upward kick, so debris arcs before it falls. */
  liftMin: number;
  liftSpan: number;
  /** Downward acceleration. */
  gravity: number;
  /** Chips fall a little harder than image fragments. */
  chipGravityScale: number;
  /** Angular velocity range, radians/s. */
  spin: number;
  chipSpin: number;
  /** Seconds a fragment/chip stays alive. */
  fragLifeMin: number;
  fragLifeSpan: number;
  chipLifeMin: number;
  chipLifeSpan: number;
  /** Departure jitter, seconds. */
  stagger: number;
  /** A fragment shrinks to this fraction over its life. */
  shrinkTo: number;
  /** Chip size range. */
  chipWMin: number;
  chipWSpan: number;
  chipHMin: number;
  chipHSpan: number;
}

/**
 * The board's profile: every term a multiple of one fragment's size, so a line
 * clear reads the same whatever the board is scaled to.
 */
export function cellTuning(cell: number): ShatterTuning {
  return {
    speedMin: cell * 4.6,
    speedSpan: cell * 7.2,
    jitter: cell * 1.1,
    liftMin: cell * 2.2,
    liftSpan: cell * 1.9,
    gravity: cell * 6.6,
    chipGravityScale: 1.25,
    spin: 9,
    chipSpin: 15,
    fragLifeMin: 0.62,
    fragLifeSpan: 0.34,
    chipLifeMin: 0.7,
    chipLifeSpan: 0.45,
    stagger: 0.05,
    shrinkTo: 0.45,
    chipWMin: cell * 0.16,
    chipWSpan: cell * 0.24,
    chipHMin: cell * 0.11,
    chipHSpan: cell * 0.17,
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Deterministic hash — a given seed always scatters the same way. */
export const hash = (i: number, salt = 0) => {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

export interface Fragment {
  /** Source bitmap and the sub-rectangle of it this piece carries. */
  bitmap: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Start centre and draw size, in px. */
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  vx: number;
  vy: number;
  spin: number;
  gravity: number;
  delay: number;
  life: number;
  /** Fraction of its size the piece shrinks to over its life. */
  shrink: number;
}

export interface Chip {
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  gravity: number;
  delay: number;
  life: number;
}

interface BurstRect {
  /** Where the piece sits on screen, in px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FragmentOptions {
  /** The sprite to slice. */
  bitmap: CanvasImageSource;
  /** Natural size of `bitmap`, so slices map to source pixels. */
  bitmapW: number;
  bitmapH: number;
  /** Screen rect the sprite currently occupies. */
  rect: BurstRect;
  /** Target fragment size in px; the grid is derived from it. */
  cell: number;
  /** How hard this burst throws. */
  tuning: ShatterTuning;
  /**
   * The sprite's rotation on screen, in radians. Pieces are laid out around the
   * rect's centre at that angle and carry it, so the first frame of the burst is
   * the tilted sprite intact rather than an upright mosaic of it.
   */
  rotate?: number;
  /** Point the debris flies away from, in px. Defaults to the rect's centre. */
  originX?: number;
  originY?: number;
  /** Distinguishes one burst's scatter from another's. */
  seed: number;
  /** Added to every particle's delay, e.g. to sweep along a row. */
  delay?: number;
}

/** Slice a sprite into fragments thrown outward from `origin`. */
export function spawnFragments(options: FragmentOptions): Fragment[] {
  const {
    bitmap,
    bitmapW,
    bitmapH,
    rect,
    cell,
    tuning,
    seed,
    rotate = 0,
    delay = 0,
    originX = rect.x + rect.w / 2,
    originY = rect.y + rect.h / 2,
  } = options;
  const cols = Math.max(1, Math.round(rect.w / cell));
  const rows = Math.max(1, Math.round(rect.h / cell));
  const pieceW = rect.w / cols;
  const pieceH = rect.h / rows;
  const cos = Math.cos(rotate);
  const sin = Math.sin(rotate);
  const midX = rect.x + rect.w / 2;
  const midY = rect.y + rect.h / 2;
  const out: Fragment[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const k = seed * 1000 + row * cols + col;
      // offset within the sprite, then turned with it (a no-op at rotate 0)
      const lx = col * pieceW + pieceW / 2 - rect.w / 2;
      const ly = row * pieceH + pieceH / 2 - rect.h / 2;
      const cx = midX + lx * cos - ly * sin;
      const cy = midY + lx * sin + ly * cos;
      /*
       * Direction is normalised by the rect's own half-extents before being
       * unit-scaled. Using raw offsets would make a wide, one-cell-tall row
       * throw almost everything sideways — a smear rather than a burst —
       * because every fragment sits near its centre line vertically. Dividing
       * through the extents first means a piece at the top edge flies up as
       * hard as an end piece flies out, whatever the sprite's proportions.
       */
      const nx = (cx - originX) / Math.max(1, rect.w / 2);
      const ny = (cy - originY) / Math.max(1, rect.h / 2);
      const norm = Math.hypot(nx, ny) || 1;
      const dx = nx / norm;
      const dy = ny / norm;
      const speed = tuning.speedMin + hash(k, 1) * tuning.speedSpan;
      out.push({
        bitmap,
        sx: (col / cols) * bitmapW,
        sy: (row / rows) * bitmapH,
        sw: bitmapW / cols,
        sh: bitmapH / rows,
        x: cx,
        y: cy,
        w: pieceW,
        h: pieceH,
        rot: rotate,
        vx: dx * speed + (hash(k, 2) * 2 - 1) * tuning.jitter,
        vy: dy * speed - (tuning.liftMin + hash(k, 3) * tuning.liftSpan),
        spin: (hash(k, 4) * 2 - 1) * tuning.spin,
        gravity: tuning.gravity,
        delay: delay + hash(k, 5) * tuning.stagger,
        life: tuning.fragLifeMin + hash(k, 6) * tuning.fragLifeSpan,
        shrink: tuning.shrinkTo,
      });
    }
  }
  return out;
}

interface ChipOptions {
  /** Area the chips launch from. */
  rect: BurstRect;
  /** How hard this burst throws. */
  tuning: ShatterTuning;
  count: number;
  palette: string[];
  seed: number;
  delay?: number;
  /**
   * Maps a chip's ordinal to its randomness key. The default keys off `seed`;
   * a caller that spawns one interleaved sequence across several rects passes
   * its own so each rect keeps the keys it would have had.
   */
  keyOf?: (index: number) => number;
}

/** A confetti of small colour chips over the same area. */
export function spawnChips(options: ChipOptions): Chip[] {
  const {
    rect,
    tuning,
    count,
    palette,
    seed,
    delay = 0,
    keyOf = (i) => seed * 977 + i,
  } = options;
  const out: Chip[] = [];
  for (let i = 0; i < count; i++) {
    const k = keyOf(i);
    const angle = hash(k, 9) * Math.PI * 2;
    const speed = tuning.speedMin + hash(k, 10) * tuning.speedSpan;
    out.push({
      x: rect.x + hash(k, 7) * rect.w,
      y: rect.y + hash(k, 8) * rect.h,
      w: tuning.chipWMin + hash(k, 11) * tuning.chipWSpan,
      h: tuning.chipHMin + hash(k, 12) * tuning.chipHSpan,
      colour: palette[k % palette.length],
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - tuning.liftMin,
      rot: hash(k, 13) * Math.PI * 2,
      spin: (hash(k, 14) * 2 - 1) * tuning.chipSpin,
      gravity: tuning.gravity * tuning.chipGravityScale,
      delay: delay + hash(k, 15) * tuning.stagger,
      life: tuning.chipLifeMin + hash(k, 16) * tuning.chipLifeSpan,
    });
  }
  return out;
}

/** Fade in the last third of a particle's life. */
const fadeOf = (age: number, life: number, knee: number) => {
  const remaining = 1 - clamp01(age / life);
  return remaining < knee ? remaining / knee : 1;
};

/**
 * Draw one fragment at age `t` seconds after its burst began.
 * Returns false once the piece has expired, so callers can retire it.
 */
export function drawFragment(
  ctx: CanvasRenderingContext2D,
  f: Fragment,
  t: number,
): boolean {
  const age = t - f.delay;
  if (age < 0) return true;
  if (age >= f.life) return false;
  const scale = 1 - (1 - f.shrink) * clamp01(age / f.life);
  ctx.save();
  ctx.globalAlpha = fadeOf(age, f.life, 0.35);
  ctx.translate(
    f.x + f.vx * age,
    f.y + f.vy * age + 0.5 * f.gravity * age * age,
  );
  ctx.rotate(f.rot + f.spin * age);
  const w = f.w * scale;
  const h = f.h * scale;
  ctx.drawImage(f.bitmap, f.sx, f.sy, f.sw, f.sh, -w / 2, -h / 2, w, h);
  ctx.restore();
  return true;
}

/** Draw one confetti chip; returns false once expired. */
export function drawChip(
  ctx: CanvasRenderingContext2D,
  c: Chip,
  t: number,
): boolean {
  const age = t - c.delay;
  if (age < 0) return true;
  if (age >= c.life) return false;
  ctx.save();
  ctx.globalAlpha = fadeOf(age, c.life, 0.4);
  ctx.translate(
    c.x + c.vx * age,
    c.y + c.vy * age + 0.5 * c.gravity * age * age,
  );
  ctx.rotate(c.rot + c.spin * age);
  ctx.fillStyle = c.colour;
  ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
  ctx.restore();
  return true;
}
