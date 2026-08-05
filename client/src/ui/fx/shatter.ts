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

/** Tuning shared by every shatter in the app. Multiples of `cell`. */
export const SHATTER = {
  /** Outward speed range. */
  speedMin: 4.6,
  speedSpan: 7.2,
  /** Extra upward kick, so debris arcs before it falls. */
  liftMin: 2.2,
  liftSpan: 1.9,
  /** Downward acceleration. */
  gravity: 6.6,
  /** Chips fall a little harder than image fragments. */
  chipGravityScale: 1.25,
  /** Angular velocity range, radians/s. */
  spin: 9,
  chipSpin: 15,
  /** Seconds a fragment/chip stays alive. */
  fragLifeMin: 0.62,
  fragLifeSpan: 0.34,
  chipLifeMin: 0.7,
  chipLifeSpan: 0.45,
  /** Departure jitter, seconds. */
  stagger: 0.05,
  /** A fragment shrinks to this fraction over its life. */
  shrinkTo: 0.45,
} as const;

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
    seed,
    delay = 0,
    originX = rect.x + rect.w / 2,
    originY = rect.y + rect.h / 2,
  } = options;
  const cols = Math.max(1, Math.round(rect.w / cell));
  const rows = Math.max(1, Math.round(rect.h / cell));
  const pieceW = rect.w / cols;
  const pieceH = rect.h / rows;
  const out: Fragment[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const k = seed * 1000 + row * cols + col;
      const cx = rect.x + col * pieceW + pieceW / 2;
      const cy = rect.y + row * pieceH + pieceH / 2;
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
      const speed = cell * (SHATTER.speedMin + hash(k, 1) * SHATTER.speedSpan);
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
        rot: 0,
        vx: dx * speed + (hash(k, 2) * 2 - 1) * cell * 1.1,
        vy:
          dy * speed - cell * (SHATTER.liftMin + hash(k, 3) * SHATTER.liftSpan),
        spin: (hash(k, 4) * 2 - 1) * SHATTER.spin,
        gravity: cell * SHATTER.gravity,
        delay: delay + hash(k, 5) * SHATTER.stagger,
        life: SHATTER.fragLifeMin + hash(k, 6) * SHATTER.fragLifeSpan,
      });
    }
  }
  return out;
}

interface ChipOptions {
  /** Area the chips launch from. */
  rect: BurstRect;
  /** Scale reference in px — chip size and speed derive from it. */
  cell: number;
  count: number;
  palette: string[];
  seed: number;
  delay?: number;
}

/** A confetti of small colour chips over the same area. */
export function spawnChips(options: ChipOptions): Chip[] {
  const { rect, cell, count, palette, seed, delay = 0 } = options;
  const out: Chip[] = [];
  for (let i = 0; i < count; i++) {
    const k = seed * 977 + i;
    const angle = hash(k, 9) * Math.PI * 2;
    const speed = cell * (SHATTER.speedMin + hash(k, 10) * SHATTER.speedSpan);
    out.push({
      x: rect.x + hash(k, 7) * rect.w,
      y: rect.y + hash(k, 8) * rect.h,
      w: cell * (0.16 + hash(k, 11) * 0.24),
      h: cell * (0.11 + hash(k, 12) * 0.17),
      colour: palette[i % palette.length],
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - cell * SHATTER.liftMin,
      rot: hash(k, 13) * Math.PI * 2,
      spin: (hash(k, 14) * 2 - 1) * SHATTER.chipSpin,
      gravity: cell * SHATTER.gravity * SHATTER.chipGravityScale,
      delay: delay + hash(k, 15) * SHATTER.stagger,
      life: SHATTER.chipLifeMin + hash(k, 16) * SHATTER.chipLifeSpan,
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
  const scale = 1 - (1 - SHATTER.shrinkTo) * clamp01(age / f.life);
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
