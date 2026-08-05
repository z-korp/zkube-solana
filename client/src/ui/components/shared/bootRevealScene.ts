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

export interface BootRevealColours {
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
const GRAVITY = 210; // design units / s²
const DESIGN = 200; // composition is 200 units across

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Deterministic hash — the scatter is identical on every run. */
const rnd = (i: number, salt = 0) => {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

function mixHex(color: string, target: string, amount: number): string {
  const ch = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const from = ch(color);
  const to = ch(target);
  return (
    "#" +
    from
      .map((v, i) =>
        Math.round(v + (to[i] - v) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
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

interface Fragment {
  block: number;
  sx: number;
  sy: number;
  src: number;
  size: number;
  x: number;
  y: number;
  rot: number;
  vx: number;
  vy: number;
  spin: number;
  delay: number;
  life: number;
}
interface Chip {
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  delay: number;
  life: number;
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

  private buildParticles() {
    this.blocks.forEach((b, bi) => {
      const cell = b.s / GRID;
      const src = this.bitmaps[bi].width / GRID;
      const a = (b.rot * Math.PI) / 180;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (let row = 0; row < GRID; row++) {
        for (let col = 0; col < GRID; col++) {
          const k = bi * 1000 + row * GRID + col;
          // fragment centre, rotated with its block so the mosaic reconstructs
          const lx = col * cell + cell / 2 - b.s / 2;
          const ly = row * cell + cell / 2 - b.s / 2;
          const cx = b.x + b.s / 2 + lx * ca - ly * sa;
          const cy = b.y + b.s / 2 + lx * sa + ly * ca;
          const dx = cx - 100;
          const dy = cy - 100;
          const len = Math.hypot(dx, dy) || 1;
          const speed = 150 + rnd(k, 1) * 230;
          this.frags.push({
            block: bi,
            sx: col * src,
            sy: row * src,
            src,
            size: cell,
            x: cx,
            y: cy,
            rot: a,
            vx: (dx / len) * speed + (rnd(k, 2) * 2 - 1) * 34,
            vy: (dy / len) * speed - 70 - rnd(k, 3) * 60,
            spin: (rnd(k, 4) * 2 - 1) * 9,
            delay: rnd(k, 5) * 0.05,
            life: 1.05 + rnd(k, 6) * 0.4,
          });
        }
      }
    });

    const palette = [
      ...this.blocks.map((b) => b.base),
      "#FFF4D7",
      this.colours.accent,
    ];
    for (let i = 0; i < CHIP_COUNT; i++) {
      const b = this.blocks[i % this.blocks.length];
      const ang = rnd(i, 9) * Math.PI * 2;
      const speed = 170 + rnd(i, 10) * 260;
      this.chips.push({
        x: b.x + b.s / 2 + (rnd(i, 7) * 2 - 1) * b.s * 0.44,
        y: b.y + b.s / 2 + (rnd(i, 8) * 2 - 1) * b.s * 0.44,
        w: 0.7 + rnd(i, 11) * 1.3,
        h: 0.5 + rnd(i, 12) * 0.9,
        colour: palette[i % palette.length],
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 62,
        rot: rnd(i, 13) * Math.PI * 2,
        spin: (rnd(i, 14) * 2 - 1) * 15,
        delay: rnd(i, 15) * 0.07,
        life: 1.15 + rnd(i, 16) * 0.55,
      });
    }
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2 + 0.35;
      const speed = 230 + rnd(i, 17) * 150;
      this.sparks.push({
        r: 0.9 + (i % 3) * 0.5,
        cream: i % 3 === 0,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 0.5 + rnd(i, 18) * 0.22,
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

  private drawShatter(bt: number) {
    const { ctx } = this;
    for (const f of this.frags) {
      const lt = bt - f.delay;
      if (lt < 0) continue;
      const fade = 1 - clamp01(lt / f.life);
      if (fade <= 0) continue;
      const x = f.x + f.vx * lt;
      const y = f.y + f.vy * lt + 0.5 * GRAVITY * lt * lt;
      const scale = 1 - 0.5 * clamp01(lt / f.life);
      ctx.save();
      ctx.globalAlpha = fade < 0.35 ? fade / 0.35 : 1;
      ctx.translate(this.toX(x), this.toY(y));
      ctx.rotate(f.rot + f.spin * lt);
      const w = this.toPx(f.size) * scale;
      ctx.drawImage(
        this.bitmaps[f.block],
        f.sx,
        f.sy,
        f.src,
        f.src,
        -w / 2,
        -w / 2,
        w,
        w,
      );
      ctx.restore();
    }
    for (const c of this.chips) {
      const lt = bt - c.delay;
      if (lt < 0) continue;
      const fade = 1 - clamp01(lt / c.life);
      if (fade <= 0) continue;
      const x = c.x + c.vx * lt;
      const y = c.y + c.vy * lt + 0.5 * GRAVITY * 1.25 * lt * lt;
      ctx.save();
      ctx.globalAlpha = fade < 0.4 ? fade / 0.4 : 1;
      ctx.translate(this.toX(x), this.toY(y));
      ctx.rotate(c.rot + c.spin * lt);
      ctx.fillStyle = c.colour;
      const w = this.toPx(c.w);
      const h = this.toPx(c.h);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
    for (const s of this.sparks) {
      const fade = 1 - clamp01(bt / s.life);
      if (fade <= 0) continue;
      const x = 100 + s.vx * bt;
      const y = 100 + s.vy * bt + 0.5 * GRAVITY * 0.6 * bt * bt;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = s.cream ? "#FFF4D7" : this.colours.accent;
      ctx.beginPath();
      ctx.arc(
        this.toX(x),
        this.toY(y),
        this.toPx(s.r) * (1 - 0.5 * clamp01(bt / s.life)),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }
    // the burst
    const fl = clamp01(bt / 0.5);
    if (fl < 1) {
      const r = this.toPx(46) * (0.12 + 3 * fl);
      const cx = this.toX(100);
      const cy = this.toY(100);
      const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.42, `${lighten(this.colours.accent, 0.6)}d9`);
      grad.addColorStop(0.78, `${this.colours.accent}47`);
      grad.addColorStop(1, `${this.colours.accent}00`);
      ctx.save();
      ctx.globalAlpha = fl < 0.1 ? fl / 0.1 : 1 - (fl - 0.1) / 0.9;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
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
