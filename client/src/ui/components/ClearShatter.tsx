// React is imported explicitly: vitest transforms JSX with esbuild's classic
// runtime, so a component rendered in a test needs the namespace in scope.
import React, { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

import type { Block } from "@/types/types";
import {
  drawChip,
  drawFragment,
  spawnChips,
  spawnFragments,
  type Chip,
  type Fragment,
} from "@/ui/fx/shatter";

import "./clearShatter.css";

/**
 * The line clear, drawn on a canvas above the board.
 *
 * It speaks the boot reveal's vocabulary — a sprite sliced into fragments, each
 * thrown outward and pulled down, over a confetti of colour chips — so breaking
 * a line in play and breaking the icon on launch read as the same act.
 *
 * The layer owns nothing but pixels. It never inspects or advances game state:
 * it is handed the rows the board has already resolved as complete, and the
 * debris it spawns then outlives the board's own reflow, which is why it lives
 * on its own canvas rather than inside the SVG the blocks are drawn in.
 */

/** Fragment size as a fraction of one cell — four pieces across each cell. */
const CELL_DIVISOR = 4;
/** Chips per cleared cell. */
const CHIPS_PER_CELL = 7;
/**
 * How long the wipe takes to cross a full row. The board applies the same
 * value to each block's vanish, so a block disappears exactly as the wipe
 * reaches it and its fragments take over.
 */
export const CLEAR_SWEEP_SECONDS = 0.1;
/** The white flash over each cell as it goes. */
const FLASH_LIFE = 0.19;
/** Peak flash opacity for one cell, and for the whole board at once. */
const CELL_FLASH = 0.85;
const BOARD_FLASH = 0.3;
/** Confetti for a perfect clear, spread over the whole board. */
const PERFECT_CHIPS = 150;
/**
 * The perfect clear lands just after the rows have broken, so the board reads
 * as emptying first and being celebrated second.
 */
const PERFECT_DELAY = 0.16;

interface Flash {
  x: number;
  y: number;
  w: number;
  h: number;
  delay: number;
  /** Peak opacity. A single cell can take a hard white; the whole board can't. */
  strength: number;
}

interface Shock {
  x: number;
  y: number;
  maxRadius: number;
  colour: string;
  life: number;
}

interface Burst {
  started: number;
  frags: Fragment[];
  chips: Chip[];
  flashes: Flash[];
  shocks: Shock[];
}

export interface ClearShatterProps {
  /** Rows the board has resolved as complete; each new row set spawns a burst. */
  rows: readonly number[];
  /** Blocks present when those rows completed. */
  blocks: readonly Block[];
  /** Board geometry, in px. */
  gridSize: number;
  gridWidth: number;
  gridHeight: number;
  /** Offset of cell (0,0) inside the canvas, in px. */
  offsetX: number;
  offsetY: number;
  /** Block width (1-4) → sprite url, as the board uses. */
  blockImages: Record<number, string>;
  /** Tier colours of the active zone, for the confetti. */
  palette: readonly string[];
  /**
   * Bumped once each time the board is emptied. A perfect clear adds a
   * board-wide shockwave and a second wave of confetti on top of whatever the
   * rows themselves threw, because the reward is the empty board rather than
   * any one line.
   */
  perfect?: number;
}

export default function ClearShatter({
  rows,
  blocks,
  gridSize,
  gridWidth,
  gridHeight,
  offsetX,
  offsetY,
  blockImages,
  palette,
  perfect = 0,
}: ClearShatterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const burstsRef = useRef<Burst[]>([]);
  const rafRef = useRef(0);
  const spritesRef = useRef(new Map<string, HTMLImageElement>());
  const reduceMotion = useReducedMotion();
  // the board hands us the same rows repeatedly while the clear plays out
  const lastKeyRef = useRef("");

  // Latest geometry/blocks without restarting the loop each render.
  const live = useRef({
    blocks,
    gridSize,
    offsetX,
    offsetY,
    blockImages,
    palette,
  });
  live.current = { blocks, gridSize, offsetX, offsetY, blockImages, palette };

  const width = gridWidth * gridSize + offsetX * 2;
  const height = gridHeight * gridSize + offsetY * 2;

  // Decode each sprite once; fragments slice the decoded bitmap.
  useEffect(() => {
    for (const url of Object.values(blockImages)) {
      if (!url || spritesRef.current.has(url)) continue;
      const img = new Image();
      img.src = url;
      spritesRef.current.set(url, img);
    }
  }, [blockImages]);

  useEffect(() => {
    const key = rows.length ? [...rows].sort((a, b) => a - b).join(",") : "";
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    if (!key || reduceMotion) return;

    const {
      blocks: liveBlocks,
      gridSize: cellPx,
      offsetX: ox,
      offsetY: oy,
      blockImages: sprites,
      palette: colours,
    } = live.current;
    const cell = cellPx / CELL_DIVISOR;
    const cleared = new Set(rows);
    const frags: Fragment[] = [];
    const chips: Chip[] = [];
    const flashes: Flash[] = [];

    for (const block of liveBlocks) {
      if (!cleared.has(block.y)) continue;
      const img = sprites[block.width]
        ? spritesRef.current.get(sprites[block.width])
        : undefined;
      const rect = {
        x: ox + block.x * cellPx,
        y: oy + block.y * cellPx,
        w: block.width * cellPx,
        h: cellPx,
      };
      // the clear sweeps across the row rather than popping all at once
      const delay = (block.x / Math.max(1, gridWidth)) * CLEAR_SWEEP_SECONDS;
      flashes.push({ ...rect, delay, strength: CELL_FLASH });
      if (img?.complete && img.naturalWidth > 0) {
        frags.push(
          ...spawnFragments({
            bitmap: img,
            bitmapW: img.naturalWidth,
            bitmapH: img.naturalHeight,
            rect,
            cell,
            seed: block.y * 31 + block.x,
            delay,
          }),
        );
      }
      chips.push(
        ...spawnChips({
          rect,
          cell,
          count: CHIPS_PER_CELL * block.width,
          palette: [...colours],
          seed: block.y * 17 + block.x + 1,
          delay,
        }),
      );
    }
    if (!frags.length && !chips.length) return;
    burstsRef.current.push({
      started: performance.now(),
      frags,
      chips,
      flashes,
      shocks: [],
    });
  }, [rows, reduceMotion, gridWidth]);

  // A perfect clear: the board itself is the reward, so the burst covers all of
  // it rather than the rows that happened to complete.
  useEffect(() => {
    if (!perfect || reduceMotion) return;
    const {
      gridSize: cellPx,
      offsetX: ox,
      offsetY: oy,
      palette: colours,
    } = live.current;
    const board = {
      x: ox,
      y: oy,
      w: gridWidth * cellPx,
      h: gridHeight * cellPx,
    };
    burstsRef.current.push({
      started: performance.now(),
      frags: [],
      chips: spawnChips({
        rect: board,
        cell: cellPx / CELL_DIVISOR,
        count: PERFECT_CHIPS,
        palette: [...colours],
        seed: perfect * 7919,
        delay: PERFECT_DELAY,
      }),
      flashes: [{ ...board, delay: PERFECT_DELAY, strength: BOARD_FLASH }],
      shocks: [
        {
          x: board.x + board.w / 2,
          y: board.y + board.h / 2,
          maxRadius: Math.hypot(board.w, board.h) * 0.55,
          colour: colours[colours.length - 1] ?? "#FFF4D7",
          life: 0.62,
        },
      ],
    });
  }, [perfect, reduceMotion, gridWidth, gridHeight]);

  // One loop for the layer's whole life; it idles when nothing is in flight.
  useEffect(() => {
    if (reduceMotion) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let painted = false;

    const frame = () => {
      const now = performance.now();
      const bursts = burstsRef.current;
      if (bursts.length) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        painted = true;
        burstsRef.current = bursts.filter((burst) => {
          const t = (now - burst.started) / 1000;
          let alive = false;
          for (const f of burst.frags) alive = drawFragment(ctx, f, t) || alive;
          for (const c of burst.chips) alive = drawChip(ctx, c, t) || alive;
          for (const shock of burst.shocks) {
            const age = t;
            if (age >= shock.life) continue;
            alive = true;
            const k = age / shock.life;
            ctx.save();
            // eased so the ring leaps out and then slows, and drawn twice:
            // a bright core with a wide soft trail behind it
            const r = shock.maxRadius * (1 - (1 - k) * (1 - k));
            ctx.globalAlpha = (1 - k) * 0.32;
            ctx.strokeStyle = shock.colour;
            ctx.lineWidth = Math.max(3, 22 * (1 - k));
            ctx.beginPath();
            ctx.arc(shock.x, shock.y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = (1 - k) * 0.95;
            ctx.lineWidth = Math.max(1.5, 5 * (1 - k));
            ctx.beginPath();
            ctx.arc(shock.x, shock.y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
          for (const flash of burst.flashes) {
            const age = t - flash.delay;
            if (age < 0 || age >= FLASH_LIFE) continue;
            alive = true;
            const k = age / FLASH_LIFE;
            ctx.save();
            ctx.globalAlpha =
              (k < 0.4 ? k / 0.4 : 1 - (k - 0.4) / 0.6) * flash.strength;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(flash.x, flash.y, flash.w, flash.h);
            ctx.restore();
          }
          return alive;
        });
      } else if (painted) {
        // nothing left in flight — clear once, then stay idle
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        painted = false;
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [reduceMotion]);

  // Keep the backing store in step with the board's size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }, [width, height]);

  if (reduceMotion) return null;
  // The CSS size is the board's; the backing store is scaled by DPR above.
  const style: React.CSSProperties = { width, height };
  return (
    <canvas
      ref={canvasRef}
      className="clear-shatter"
      style={style}
      aria-hidden
    />
  );
}
