import React, { useMemo } from "react";

import { ZONE_GUARDIANS, getGuardianPortrait } from "@/config/bossCharacters";
import {
  getThemeColors,
  getThemeImages,
  type ThemeId,
} from "@/config/themes";
// The falling-block and guardian-pulse keyframes live in grid.css, which is
// otherwise only loaded by the game surfaces.
import "../../grid.css";

const GRID_CELLS = 8;

interface FallingBlock {
  size: number;
  cellX: number;
  speed: number;
}

interface FallingLine {
  blocks: FallingBlock[];
  delay: number;
  totalCycle: number;
}

/**
 * Disconnected-home hero, ported from the original zkube client: a rotating
 * guardian portrait, its catchphrase, and lines of falling blocks.
 */
const CtaGuardian: React.FC = () => {
  const guardianIds = Object.keys(ZONE_GUARDIANS).map(Number);
  const guardianId =
    guardianIds[Math.floor(Date.now() / 60_000) % guardianIds.length];
  const guardian = ZONE_GUARDIANS[guardianId];
  const guardianTheme = `theme-${guardianId}` as ThemeId;
  const guardianImages = getThemeImages(guardianTheme);
  const guardianColors = getThemeColors(guardianTheme);
  const fallingLines = useMemo(() => buildFallingLines(), []);

  return (
    <div className="relative mx-auto mt-2 flex w-full max-w-[360px] flex-1 flex-col items-center gap-4">
      <div
        className="guardian-pulse relative h-36 w-36 shrink-0 overflow-hidden rounded-full"
        style={{
          border: `3px solid ${guardianColors.accent}44`,
          boxShadow: `0 0 30px ${guardianColors.accent}22`,
        }}
      >
        <img
          src={getGuardianPortrait(guardianId)}
          alt={guardian.name}
          className="h-full w-full object-cover"
          draggable={false}
        />
      </div>

      <p className="text-center font-sans text-[14px] italic text-white/50">
        “{guardian.greeting}”
      </p>

      <div
        aria-hidden="true"
        className="relative min-h-[140px] w-full flex-1 overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to bottom, black 0%, black 55%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0%, black 55%, transparent 100%)",
        }}
      >
        {fallingLines.flatMap((line, lineIndex) =>
          line.blocks.map((block, blockIndex) => (
            <img
              key={`${lineIndex}-${blockIndex}`}
              src={
                guardianImages[`block${block.size}` as keyof typeof guardianImages]
              }
              alt=""
              className="absolute top-0"
              style={{
                left: `${block.cellX * (100 / GRID_CELLS)}%`,
                width: `${block.size * (100 / GRID_CELLS)}%`,
                aspectRatio: `${block.size} / 1`,
                animation: `fallingBlock ${line.totalCycle / block.speed}s ease-in ${line.delay}s infinite backwards`,
              }}
              draggable={false}
            />
          )),
        )}
      </div>
    </div>
  );
};

function buildFallingLines(): FallingLine[] {
  const lineSpacing = 2.2;
  const totalCycle = 6 * lineSpacing;
  const patterns = [
    [1, 3, 2, 2],
    [2, 1, 4, 1],
    [3, 2, 1, 2],
    [4, 1, 1, 2],
    [2, 2, 3, 1],
  ];
  const speedPool = [0.85, 0.95, 1, 1.1, 1.2, 1.3, 1.15, 1.05];
  return patterns.map((sizes, lineIndex) => {
    let cellX = 0;
    const blocks = sizes.map((size, blockIndex) => {
      const block = {
        size,
        cellX,
        speed: speedPool[(blockIndex + lineIndex * 3) % speedPool.length],
      };
      cellX += size;
      return block;
    });
    return { blocks, delay: (lineIndex + 1) * lineSpacing, totalCycle };
  });
}

export default CtaGuardian;
