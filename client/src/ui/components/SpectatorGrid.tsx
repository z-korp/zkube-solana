import { useMemo } from "react";
import BlockContainer from "./Block";
import type { Block } from "@/types/types";
import { getThemeImages, type ThemeId } from "@/config/themes";

interface SpectatorGridProps {
  /** Display-oriented grid rows (top row first), cell = block size 0-4. */
  grid: number[][];
  gridSize: number;
  gridWidth: number;
  gridHeight: number;
  themeId: ThemeId;
}

/**
 * Stable per-origin-cell block IDs so BlockContainer's CSS transform
 * transition tweens movement between polls instead of remounting.
 */
function toStableBlocks(grid: number[][], gridWidth: number): Block[] {
  const blocks: Block[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const value = row[x];
      if (value > 0) {
        blocks.push({ id: y * gridWidth + x + 1, x, y, width: value });
        x += value;
      } else {
        x += 1;
      }
    }
  });
  return blocks;
}

export default function SpectatorGrid({
  grid,
  gridSize,
  gridWidth,
  gridHeight,
  themeId,
}: SpectatorGridProps) {
  const themeImages = getThemeImages(themeId);
  const blockImages = useMemo<Record<number, string>>(
    () => ({
      1: themeImages.block1,
      2: themeImages.block2,
      3: themeImages.block3,
      4: themeImages.block4,
    }),
    [themeImages],
  );
  const blocks = useMemo(() => toStableBlocks(grid, gridWidth), [grid, gridWidth]);

  const svgW = gridWidth * gridSize;
  const svgH = gridHeight * gridSize;
  const framePad = 9;
  const frameW = svgW + framePad * 2;
  const frameH = svgH + framePad * 2;

  return (
    <div className="relative" style={{ width: frameW, height: frameH }}>
      <svg viewBox={`0 0 ${frameW} ${frameH}`} width={frameW} height={frameH}>
        <defs>
          <linearGradient id="sgf-border" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C9A96E" stopOpacity="0.5" />
            <stop offset="50%" stopColor="#6B5B3E" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#C9A96E" stopOpacity="0.5" />
          </linearGradient>
          <clipPath id="spectator-grid-clip">
            <rect x={0} y={0} width={svgW} height={svgH} />
          </clipPath>
        </defs>

        <rect
          x={1}
          y={1}
          width={frameW - 2}
          height={frameH - 2}
          rx={8}
          ry={8}
          fill="none"
          stroke="url(#sgf-border)"
          strokeWidth={2}
        />

        <g
          transform={`translate(${framePad}, ${framePad})`}
          clipPath="url(#spectator-grid-clip)"
        >
          {Array.from({ length: gridWidth + 1 }, (_, i) => (
            <line
              key={`v${i}`}
              x1={i * gridSize}
              y1={0}
              x2={i * gridSize}
              y2={svgH}
              stroke="rgba(255,255,255,0.07)"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: gridHeight + 1 }, (_, i) => (
            <line
              key={`h${i}`}
              x1={0}
              y1={i * gridSize}
              x2={svgW}
              y2={i * gridSize}
              stroke="rgba(255,255,255,0.07)"
              strokeWidth={1}
            />
          ))}

          {blocks.map((block) => (
            <BlockContainer
              key={block.id}
              block={block}
              gridSize={gridSize}
              gridHeight={gridHeight}
              transitionDuration={300}
              isGravity
              blockImages={blockImages}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
