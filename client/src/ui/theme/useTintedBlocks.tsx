/**
 * Block art with its backing recoloured to the cell's own face.
 *
 * The authored PNGs are opaque to their corners, so on a coloured board they
 * read as black tiles with a motif printed on them. Replacing that backing with
 * the cap's face makes a filled cell read as the same tile carrying a motif,
 * and the rack stays continuous across full and empty cells.
 *
 * The replacement floods IN FROM THE EDGES rather than keying on darkness: the
 * motif's own outlines are black too, and keying would dissolve them. Only the
 * connected region touching the border is the backing.
 *
 * Done once per realm on a canvas and cached for the session — four images of
 * a few hundred kilopixels each, so it lands well inside a frame and never runs
 * again. Until it resolves, callers keep the untinted art, which is exactly
 * what ships today.
 */
import { useEffect, useState } from "react";

import { getThemeImages, type ThemeId } from "@/config/themes";
import type { RGB } from "./boardTone";

export type BlockImages = Record<number, string>;

/** Anything at or under this in every channel is backing, not artwork. */
const BACKING_CEILING = 34;

const cache = new Map<string, BlockImages>();
const inFlight = new Map<string, Promise<BlockImages>>();

function retint(image: HTMLImageElement, [tr, tg, tb]: RGB): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return image.src;
  context.drawImage(image, 0, 0);

  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height);
  const data = pixels.data;
  const seen = new Uint8Array(width * height);
  // A flat queue of indices; a recursive fill would blow the stack on a
  // 1024-wide sprite.
  const queue: number[] = [];
  for (let x = 0; x < width; x += 1) {
    queue.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    queue.push(y * width, y * width + width - 1);
  }

  while (queue.length > 0) {
    const index = queue.pop()!;
    if (seen[index]) continue;
    const offset = index * 4;
    if (
      data[offset] > BACKING_CEILING ||
      data[offset + 1] > BACKING_CEILING ||
      data[offset + 2] > BACKING_CEILING
    ) {
      continue;
    }
    seen[index] = 1;
    data[offset] = tr;
    data[offset + 1] = tg;
    data[offset + 2] = tb;

    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) queue.push(index - 1);
    if (x < width - 1) queue.push(index + 1);
    if (y > 0) queue.push(index - width);
    if (y < height - 1) queue.push(index + width);
  }

  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function build(themeId: ThemeId, backing: RGB): Promise<BlockImages> {
  const images = getThemeImages(themeId);
  const sources: BlockImages = {
    1: images.block1,
    2: images.block2,
    3: images.block3,
    4: images.block4,
  };
  const entries = await Promise.all(
    ([1, 2, 3, 4] as const).map(async (width) => {
      const element = await load(sources[width]!);
      return [width, retint(element, backing)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Tinted block art for a realm, or `null` while it is being prepared. The
 * caller falls back to the untinted images, so a slow first frame shows the
 * board rather than nothing.
 */
export function useTintedBlocks(
  themeId: ThemeId,
  backing: RGB,
): BlockImages | null {
  const key = `${themeId}:${backing.join(",")}`;
  const [images, setImages] = useState<BlockImages | null>(
    () => cache.get(key) ?? null,
  );

  useEffect(() => {
    const cached = cache.get(key);
    if (cached) {
      setImages(cached);
      return;
    }
    let live = true;
    // Canvas is unavailable in jsdom and in any SSR pass; the untinted art is
    // a complete fallback, so a failure here is silent by design.
    const pending =
      inFlight.get(key) ??
      build(themeId, backing)
        .then((built) => {
          cache.set(key, built);
          return built;
        })
        .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    pending
      .then((built) => {
        if (live) setImages(built);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key, themeId, backing]);

  return images;
}
