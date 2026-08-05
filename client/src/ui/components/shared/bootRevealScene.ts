/**
 * The boot reveal's drawing engine — framework-free so the React component
 * stays a thin shell.
 *
 * Two decisions drive the whole design:
 *
 * 1. Each block is rasterised ONCE into an offscreen bitmap and the shatter
 *    slices those bitmaps. Drawing hundreds of clipped SVG groups per frame
 *    (the first attempt) re-rasterises a filtered portrait every frame and
 *    cannot hold 60fps; one `drawImage` per fragment can.
 * 2. Every particle is closed-form in `t` — position is p0 + v·t + ½g·t² —
 *    rather than integrated frame to frame. That keeps the animation identical
 *    at any framerate, makes an arbitrary seek exact, and removes drift.
 */

import {
  drawChip,
  drawFragment,
  hash,
  spawnChips,
  spawnFragments,
  type Chip,
  type Fragment,
  type ShatterTuning,
} from "@/ui/fx/shatter";
import { mixHex } from "@/utils/colour";

/**
 * The reveal's throw, in design units per second. It reaches much further than
 * the board's line clear because the debris has to leave a 200-unit composition
 * and clear the screen, which is why the tuning is passed per burst rather than
 * shared: see `ShatterTuning`.
 */
const FRAGMENT_THROW: ShatterTuning = {
  speedMin: 150,
  speedSpan: 230,
  jitter: 34,
  liftMin: 70,
  liftSpan: 60,
  gravity: 210,
  chipGravityScale: 1.25,
  spin: 9,
  chipSpin: 15,
  fragLifeMin: 1.05,
  fragLifeSpan: 0.4,
  chipLifeMin: 1.15,
  chipLifeSpan: 0.55,
  stagger: 0.05,
  shrinkTo: 0.5,
  chipWMin: 0.7,
  chipWSpan: 1.3,
  chipHMin: 0.5,
  chipHSpan: 0.9,
};

/** The confetti throws a little harder and lives a little longer. */
const CHIP_THROW: ShatterTuning = {
  ...FRAGMENT_THROW,
  speedMin: 170,
  speedSpan: 260,
  liftMin: 62,
  liftSpan: 0,
  stagger: 0.07,
};

/** Sparks are weightless embers next to the debris, so they barely fall. */
const SPARK_GRAVITY = FRAGMENT_THROW.gravity * 0.6;

interface BootRevealColours {
  /** Live zone accent — tints the burst, sparks and ground wash. */
  accent: string;
}

interface BlockSpec {
  /** Guardian portrait, already loaded. */
  img: HTMLImageElement;
  /** Sub-rectangle of the 512px portrait framed in the block's window. */
  crop: readonly [number, number, number, number];
  /** Tier colour of the block body. */
  base: string;
  /** Placement in the 200-unit design space, matching the shipped app icon. */
  x: number;
  y: number;
  s: number;
  rot: number;
  role: "dropA" | "dropB" | "slide";
}

/** Timeline in seconds. */
export const BEATS = {
  dropA: 0.06,
  dropADur: 0.4,
  dropB: 0.34,
  dropBDur: 0.34,
  slide: 0.62,
  slideDur: 0.42,
  boom: 1.2,
  /**
   * The world lifts in gently behind the debris. This fade is long on purpose;
   * shortening it makes the luminance change read as a separate event.
   *
   * It outlasts `settle`, so the overlay must NOT be torn down there — see
   * `end`. Unmounting mid-fade drops the remaining scrim in a single frame,
   * which looks like the lights being switched on.
   */
  reveal: 1.34,
  revealDur: 1.1,
  word: 1.42,
  wordDur: 0.5,
  /**
   * Hand-over: the connect action may appear and a connected player is already
   * looking at the app. This deliberately waits for the scrim to reach zero
   * (reveal + revealDur) — anything the screen underneath reveals earlier would
   * surface behind a part-opaque scrim, appear dim, then brighten as it lifts.
   * Debris is still falling here, so the overlay stays mounted but inert.
   */
  settle: 2.45,
  end: 3.2,
} as const;

const GRID = 12; // GRID² fragments per block
const CHIP_COUNT = 260;
const SUPERSAMPLE = 3;
const DESIGN = 200; // composition is 200 units across

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const lighten = (c: string, k: number) => mixHex(c, "#ffffff", k);
const darken = (c: string, k: number) => mixHex(c, "#000000", k);

/** cubic-bezier(p1,p2,p3,p4) sampled by bisection on x. */
function bezier(p1: number, p2: number, p3: number, p4: number) {
  return (x: number) => {
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 18; i++) {
      t = (lo + hi) / 2;
      const u = 1 - t;
      const cx = 3 * u * u * t * p1 + 3 * u * t * t * p3 + t * t * t;
      if (cx < x) lo = t;
      else hi = t;
    }
    const u = 1 - t;
    return 3 * u * u * t * p2 + 3 * u * t * t * p4 + t * t * t;
  };
}
const easeFall = bezier(0.45, 0.03, 0.62, 1);
const easeSlide = bezier(0.32, 0.02, 0.4, 1);
const easeOut = bezier(0.2, 0.7, 0.3, 1);

/** Squash and rebound after a block lands: [scaleX, scaleY] for progress p. */
function landSquash(p: number): [number, number] {
  if (p < 0.62) return [0.97, 1.1];
  if (p < 0.76) {
    const k = (p - 0.62) / 0.14;
    return [0.97 + k * 0.12, 1.1 - k * 0.23];
  }
  if (p < 0.88) {
    const k = (p - 0.76) / 0.12;
    return [1.09 - k * 0.12, 0.87 + k * 0.18];
  }
  const k = (p - 0.88) / 0.12;
  return [0.97 + k * 0.03, 1.05 - k * 0.05];
}

function roundRectPath(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/**
 * Paint one block into its own bitmap — the same furniture the shipped app
 * icon uses: sticker rim, dimensional body, top highlight, inset portrait
 * window with halo and gloss, keyline and inner rim.
 */
function renderBlock(spec: BlockSpec): HTMLCanvasElement {
  const s = spec.s;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.ceil(s * SUPERSAMPLE);
  const g = canvas.getContext("2d");
  if (!g) return canvas;
  g.scale(SUPERSAMPLE, SUPERSAMPLE);

  const base = spec.base;
  const r = s * 0.19;
  const pad = s * 0.085;
  const w = s - pad * 2;
  const wr = r * 0.55;

  roundRectPath(g, 0, 0, s, s, r);
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.fill();

  const body = g.createLinearGradient(s * 0.15, 0, s * 0.85, s);
  body.addColorStop(0, lighten(base, 0.5));
  body.addColorStop(0.42, base);
  body.addColorStop(1, darken(base, 0.38));
  roundRectPath(g, s * 0.028, s * 0.028, s * 0.944, s * 0.944, r * 0.92);
  g.fillStyle = body;
  g.fill();

  roundRectPath(g, s * 0.1, s * 0.055, s * 0.8, s * 0.16, s * 0.07);
  g.fillStyle = "rgba(255,255,255,0.3)";
  g.fill();

  g.save();
  roundRectPath(g, pad, pad, w, w, wr);
  g.clip();
  const halo = g.createRadialGradient(
    s / 2,
    s * 0.42,
    1,
    s / 2,
    s * 0.42,
    w * 0.62,
  );
  halo.addColorStop(0, lighten(base, 0.42));
  halo.addColorStop(1, darken(base, 0.55));
  g.fillStyle = halo;
  g.fillRect(pad, pad, w, w);
  const [x1, y1, x2, y2] = spec.crop;
  const sc = Math.max(w / (x2 - x1), w / (y2 - y1)) * 1.02;
  const iw = 512 * sc;
  g.filter = "brightness(1.32) saturate(1.3) contrast(1.06)";
  g.drawImage(
    spec.img,
    pad - x1 * sc + (w - (x2 - x1) * sc) / 2,
    pad - y1 * sc + (w - (y2 - y1) * sc) / 2,
    iw,
    iw,
  );
  g.filter = "none";
  const gloss = g.createLinearGradient(0, pad, 0, pad + w * 0.34);
  gloss.addColorStop(0, "rgba(255,255,255,0.62)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gloss;
  g.fillRect(pad, pad, w, w * 0.34);
  g.restore();

  roundRectPath(g, pad, pad, w, w, wr);
  g.strokeStyle = "rgba(0,27,51,0.4)";
  g.lineWidth = s * 0.03;
  g.stroke();
  roundRectPath(g, pad, pad, w, w, wr);
  g.strokeStyle = lighten(base, 0.62);
  g.lineWidth = s * 0.022;
  g.globalAlpha = 0.85;
  g.stroke();
  g.globalAlpha = 1;
  return canvas;
}

interface Spark {
  r: number;
  cream: boolean;
  vx: number;
  vy: number;
  life: number;
}

export class BootRevealScene {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 2);
  private readonly bitmaps: HTMLCanvasElement[];
  private readonly frags: Fragment[] = [];
  private readonly chips: Chip[] = [];
  private readonly sparks: Spark[] = [];
  private readonly massX: number;
  private readonly massY: number;
  private width = 0;
  private height = 0;
  private unit = 1;
  private shakeX = 0;
  private shakeY = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly blocks: BlockSpec[],
    private readonly colours: BootRevealColours,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("boot reveal: 2d context unavailable");
    this.ctx = ctx;
    this.bitmaps = blocks.map(renderBlock);
    this.massX = blocks.reduce((a, b) => a + b.x + b.s / 2, 0) / blocks.length;
    this.massY = blocks.reduce((a, b) => a + b.y + b.s / 2, 0) / blocks.length;
    this.buildParticles();
    this.resize();
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    // the composition spans ~66% of the short edge
    this.unit = (Math.min(this.width, this.height) * 0.66) / DESIGN;
  }

  private toPx = (v: number) => v * this.unit;
  private toX = (x: number) =>
    this.width / 2 + (x - this.massX) * this.unit + this.shakeX;
  private toY = (y: number) =>
    this.height / 2 + (y - this.massY) * this.unit + this.shakeY;

  /**
   * All particles are built in design units and drawn through the design-space
   * transform, so the shared engine needs no notion of this scene's scaling.
   *
   * The blocks are square, which is why the engine's aspect-normalised throw
   * direction matches this scene's: dividing both components of the offset by
   * the same half-extent leaves the direction untouched.
   */
  private buildParticles() {
    this.blocks.forEach((b, bi) => {
      this.frags.push(
        ...spawnFragments({
          bitmap: this.bitmaps[bi],
          bitmapW: this.bitmaps[bi].width,
          bitmapH: this.bitmaps[bi].height,
          rect: { x: b.x, y: b.y, w: b.s, h: b.s },
          cell: b.s / GRID,
          tuning: FRAGMENT_THROW,
          // the mosaic starts as the tilted block the assembly just landed
          rotate: (b.rot * Math.PI) / 180,
          // debris flies away from the composition's middle, not each block's
          originX: 100,
          originY: 100,
          seed: bi,
        }),
      );
    });

    const palette = [
      ...this.blocks.map((b) => b.base),
      "#FFF4D7",
      this.colours.accent,
    ];
    // One interleaved run of chips across the three blocks. Each block takes
    // every third ordinal, and `keyOf` hands the engine that ordinal so the
    // arrangement is the same as a single loop over all of them would give.
    this.blocks.forEach((b, bi) => {
      const spread = b.s * 0.44;
      const count = Math.ceil((CHIP_COUNT - bi) / this.blocks.length);
      this.chips.push(
        ...spawnChips({
          rect: {
            x: b.x + b.s / 2 - spread,
            y: b.y + b.s / 2 - spread,
            w: spread * 2,
            h: spread * 2,
          },
          tuning: CHIP_THROW,
          count,
          palette,
          seed: bi,
          keyOf: (i) => bi + i * this.blocks.length,
        }),
      );
    });
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2 + 0.35;
      const speed = 230 + hash(i, 17) * 150;
      this.sparks.push({
        r: 0.9 + (i % 3) * 0.5,
        cream: i % 3 === 0,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 0.5 + hash(i, 18) * 0.22,
      });
    }
  }

  /** Draw the frame for absolute time `t` (seconds since the reveal began). */
  draw(t: number) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    // impact shake, applied in draw space (shaking the element would drag its
    // edges into view now that the canvas covers the viewport)
    const kick = (at: number, dur: number, amp: number) => {
      const k = (t - at) / dur;
      if (k < 0 || k > 1) return 0;
      return Math.sin(k * Math.PI * 5) * (1 - k) * amp;
    };
    const shake = kick(0.92, 0.18, 2.5) + kick(BEATS.boom, 0.38, 5);
    this.shakeX = shake;
    this.shakeY = -shake * 0.6;

    if (t < BEATS.boom) this.drawBlocks(t);
    else this.drawShatter(t - BEATS.boom);
  }

  private drawBlocks(t: number) {
    const { ctx } = this;
    this.blocks.forEach((b, bi) => {
      let p: number;
      let ox = 0;
      let oy = 0;
      let sx = 1;
      let sy = 1;
      if (b.role === "slide") {
        if (t < BEATS.slide) return;
        p = clamp01((t - BEATS.slide) / BEATS.slideDur);
        // in from the right, overshoot past the target, settle back
        if (p < 0.68) {
          const e = easeSlide(p / 0.68);
          ox = 250 + (-9 - 250) * e;
          sx = 1.16 - 0.16 * e;
          sy = 0.94 + 0.06 * e;
        } else if (p < 0.84) {
          const k = (p - 0.68) / 0.16;
          ox = -9 + 13 * k;
        } else {
          const k = (p - 0.84) / 0.16;
          ox = 4 - 4 * k;
        }
      } else {
        const start = b.role === "dropA" ? BEATS.dropA : BEATS.dropB;
        const dur = b.role === "dropA" ? BEATS.dropADur : BEATS.dropBDur;
        if (t < start) return;
        p = clamp01((t - start) / dur);
        if (p < 0.62) {
          oy = -230 * (1 - easeFall(p / 0.62));
          sx = 0.97;
          sy = 1.1;
        } else {
          [sx, sy] = landSquash(p);
        }
      }
      ctx.save();
      ctx.globalAlpha = p < 0.12 ? p / 0.12 : 1;
      const cx = this.toX(b.x + b.s / 2) + this.toPx(ox);
      const cy = this.toY(b.y + b.s / 2) + this.toPx(oy);
      const w = this.toPx(b.s) * sx;
      const h = this.toPx(b.s) * sy;
      // drops squash against their base; the slide squashes about its centre
      const pivot =
        b.role === "slide" ? cy : cy + (this.toPx(b.s) / 2) * (1 - sy);
      ctx.translate(cx, pivot);
      ctx.rotate((b.rot * Math.PI) / 180);
      ctx.drawImage(this.bitmaps[bi], -w / 2, -h / 2, w, h);
      ctx.restore();
    });
  }

  /**
   * The burst. One transform puts the canvas into design space — the same
   * mapping `toX`/`toY`/`toPx` apply one point at a time — so the shared
   * shatter engine draws its particles straight into the composition.
   */
  private drawShatter(bt: number) {
    const { ctx } = this;
    const k = this.dpr * this.unit;
    ctx.setTransform(
      k,
      0,
      0,
      k,
      this.dpr * (this.width / 2 - this.massX * this.unit + this.shakeX),
      this.dpr * (this.height / 2 - this.massY * this.unit + this.shakeY),
    );
    /** One CSS pixel, in design units. */
    const px = 1 / this.unit;

    for (const f of this.frags) drawFragment(ctx, f, bt);
    for (const c of this.chips) drawChip(ctx, c, bt);

    for (const s of this.sparks) {
      const fade = 1 - clamp01(bt / s.life);
      if (fade <= 0) continue;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = s.cream ? "#FFF4D7" : this.colours.accent;
      ctx.beginPath();
      ctx.arc(
        100 + s.vx * bt,
        100 + s.vy * bt + 0.5 * SPARK_GRAVITY * bt * bt,
        s.r * (1 - 0.5 * clamp01(bt / s.life)),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }

    const fl = clamp01(bt / 0.5);
    if (fl < 1) {
      const r = 46 * (0.12 + 3 * fl);
      const grad = ctx.createRadialGradient(100, 100, px, 100, 100, r);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.42, `${lighten(this.colours.accent, 0.6)}d9`);
      grad.addColorStop(0.78, `${this.colours.accent}47`);
      grad.addColorStop(1, `${this.colours.accent}00`);
      ctx.save();
      ctx.globalAlpha = fl < 0.1 ? fl / 0.1 : 1 - (fl - 0.1) / 0.9;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(100, 100, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * Scrim opacity: opaque under the assembly, then lifted by the burst. Eased
   * out so most of the change lands in the flash's brightest moments.
   */
  static scrimOpacity(t: number) {
    return 1 - clamp01((t - BEATS.reveal) / BEATS.revealDur);
  }

  /** Wordmark transform/opacity, landing with weight. */
  static wordmark(t: number) {
    const p = clamp01((t - BEATS.word) / BEATS.wordDur);
    const e = easeOut(p);
    return {
      opacity: clamp01(p / 0.55),
      scale: 1.22 - 0.22 * e,
      y: (1 - e) * -8,
      blur: p < 1 ? (1 - e) * 2 : 0,
    };
  }
}
