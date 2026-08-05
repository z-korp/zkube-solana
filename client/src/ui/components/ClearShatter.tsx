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

interface Flash {
  x: number;
  y: number;
  w: number;
  h: number;
  delay: number;
}

interface Burst {
  started: number;
  frags: Fragment[];
  chips: Chip[];
  flashes: Flash[];
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
      flashes.push({ ...rect, delay });
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
    });
  }, [rows, reduceMotion, gridWidth]);

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
          for (const flash of burst.flashes) {
            const age = t - flash.delay;
            if (age < 0 || age >= FLASH_LIFE) continue;
            alive = true;
            const k = age / FLASH_LIFE;
            ctx.save();
            ctx.globalAlpha = (k < 0.4 ? k / 0.4 : 1 - (k - 0.4) / 0.6) * 0.85;
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
