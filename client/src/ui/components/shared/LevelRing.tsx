import React from "react";

import type { ThemeColors } from "@/config/themes";

/**
 * The player-level badge wrapped in an XP progress arc: the ring fills as the
 * current level's XP bar does. Shared by the Home identity chip and the
 * Profile header so the level always reads the same everywhere.
 */
const LevelRing: React.FC<{
  level: number;
  /** 0..1 progress through the current level. */
  progress: number;
  colors: ThemeColors;
  size?: number;
}> = ({ level, progress, colors, size = 60 }) => {
  const strokeWidth = Math.max(3, Math.round(size * 0.07));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));
  const inner = size - strokeWidth * 4;

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Level ${level}, ${Math.round(clamped * 100)}% to next level`}
    >
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.accent}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <div
        className="flex items-center justify-center rounded-full font-sans font-black"
        style={{
          width: inner,
          height: inner,
          fontSize: inner * 0.45,
          background: `linear-gradient(135deg, ${colors.accent}, ${colors.accent2})`,
          color: colors.background,
          boxShadow: colors.glow,
        }}
      >
        {level}
      </div>
    </div>
  );
};

export default LevelRing;
