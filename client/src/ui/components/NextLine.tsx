import { useEffect, useMemo, useState } from "react";
import type { Block } from "@/types/types";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { getThemeColors, getThemeImages, type ThemeId } from "@/config/themes";
import { boardTone } from "@/ui/theme/boardTone";
import { useTintedBlocks } from "@/ui/theme/useTintedBlocks";

interface NextLineProps {
  nextLineData: Block[];
  gridSize: number;
  gridWidth: number;
  gridHeight: number;
  themeId?: ThemeId;
}

const NextLine = ({
  nextLineData,
  gridHeight,
  gridSize,
  gridWidth,
  themeId: themeIdOverride,
}: NextLineProps) => {
  const [blocks, setBlocks] = useState<Block[]>(nextLineData);
  const { themeTemplate } = useTheme();
  const activeThemeId = themeIdOverride ?? (themeTemplate as ThemeId);
  const themeImages = getThemeImages(activeThemeId);
  const tone = useMemo(
    () => boardTone(getThemeColors(activeThemeId)),
    [activeThemeId],
  );
  const tinted = useTintedBlocks(activeThemeId, tone.blockBacking);

  const blockImages = useMemo<Record<number, string>>(() => tinted ?? ({
    1: themeImages.block1,
    2: themeImages.block2,
    3: themeImages.block3,
    4: themeImages.block4,
  }), [themeImages, tinted]);

  useEffect(() => {
    setBlocks(nextLineData);
  }, [nextLineData]);

  const svgW = gridWidth * gridSize;
  const svgH = gridHeight * gridSize;

  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      width={svgW}
      height={svgH}
    >
      <defs>
        <linearGradient id="nl-cap" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone.capTop} />
          <stop offset="100%" stopColor={tone.capBottom} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={svgW} height={svgH} fill={tone.ground} />
      {Array.from({ length: gridWidth }, (_, column) => {
        const inset = Math.max(1.5, gridSize * 0.05);
        return (
          <rect
            key={`cap${column}`}
            x={column * gridSize + inset}
            y={inset}
            width={gridSize - inset * 2}
            height={gridSize - inset * 2}
            rx={Math.max(3, gridSize * 0.17)}
            ry={Math.max(3, gridSize * 0.17)}
            fill="url(#nl-cap)"
            stroke={tone.rim}
            strokeOpacity={0.1}
            strokeWidth={2}
          />
        );
      })}

      {/* Blocks */}
      {blocks.map((block) => {
        const x = block.x * gridSize;
        const y = block.y * gridSize;
        const w = block.width * gridSize;
        const h = gridSize;
        const imageUrl = blockImages[block.width] ?? "";
        return (
          <image
            key={block.id}
            href={imageUrl}
            x={x} y={y}
            width={w} height={h}
            preserveAspectRatio="none"
          />
        );
      })}
    </svg>
  );
};

export default NextLine;
