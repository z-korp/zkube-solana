// Quadratic curve: threshold(L) = 16 * L²
// L1 = 0, L2 = 64, L10 = 1600, L50 = 40 000, L100 = 160 000.
// Formula picked so the early game (L1–L10) keeps roughly the previous
// pace post-XP-nerf, while the long tail gives endgame players a real
// goal to chase.
export const LEVEL_THRESHOLDS: number[] = Array.from({ length: 100 }, (_, i) =>
  i === 0 ? 0 : 16 * (i + 1) * (i + 1),
);

// Titles spread across the 100-level ladder. Levels not listed inherit
// the most recent earlier title.
const PLAYER_TITLES: Record<number, string> = {
  1: "Novice",
  5: "Apprentice",
  10: "Initiate",
  15: "Block Tinker",
  20: "Block Master",
  25: "Cascade Adept",
  30: "Grid Sage",
  40: "Combo Weaver",
  50: "Spirit Caller",
  60: "Mutator Bender",
  70: "Guardian Ally",
  80: "Zone Legend",
  90: "Eternal",
  100: "Ascended",
};

export const ZONE_EMOJIS: Record<number, string> = {
  1: "🌊",
  2: "🏛️",
  3: "❄️",
  4: "🏺",
  5: "🐉",
  6: "🕌",
  7: "⛩️",
  8: "🌿",
  9: "🥁",
  10: "⛰️",
};

export const ZONE_NAMES: Record<number, string> = {
  1: "Tiki",
  2: "Egypt",
  3: "Norse",
  4: "Greece",
  5: "China",
  6: "Persia",
  7: "Japan",
  8: "Mayan",
  9: "Tribal",
  10: "Inca",
};

export const getLevelFromXp = (xp: number): number => {
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  return level;
};

export const getTitleForLevel = (level: number): string => {
  const unlockLevels = Object.keys(PLAYER_TITLES)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((l) => l <= level);
  const key = unlockLevels[unlockLevels.length - 1] ?? 1;
  return PLAYER_TITLES[key] ?? "Novice";
};

// The level ring's color IS the visible rank — the cosmetic title moves to the
// ring's tooltip. Ocean → Ember across levels 1–100: on-brand cyan early,
// warming through teal and gold to ember at the cap.
type Rgb = [number, number, number];
const LEVEL_RAMP: Array<{ level: number; rgb: Rgb }> = [
  { level: 1, rgb: [0x38, 0xbd, 0xf8] }, // sky cyan
  { level: 25, rgb: [0x22, 0xd3, 0xee] }, // bright cyan
  { level: 50, rgb: [0x34, 0xd3, 0x99] }, // teal-green
  { level: 75, rgb: [0xfa, 0xcc, 0x15] }, // gold
  { level: 100, rgb: [0xfb, 0x92, 0x3c] }, // ember orange
];

const toHex = (rgb: Rgb): string =>
  `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

const mixToward = (rgb: Rgb, target: Rgb, amount: number): Rgb =>
  rgb.map((v, i) => v + (target[i] - v) * amount) as Rgb;

const rampRgb = (level: number): Rgb => {
  const clamped = Math.min(100, Math.max(1, level));
  let lo = LEVEL_RAMP[0];
  let hi = LEVEL_RAMP[LEVEL_RAMP.length - 1];
  for (let i = 0; i < LEVEL_RAMP.length - 1; i += 1) {
    if (clamped >= LEVEL_RAMP[i].level && clamped <= LEVEL_RAMP[i + 1].level) {
      lo = LEVEL_RAMP[i];
      hi = LEVEL_RAMP[i + 1];
      break;
    }
  }
  const span = hi.level - lo.level || 1;
  return mixToward(lo.rgb, hi.rgb, (clamped - lo.level) / span);
};

export interface LevelRingPalette {
  ring: string; // arc stroke + badge base
  badgeTop: string; // lighter badge-gradient stop
  glow: string; // soft drop shadow
  text: string; // badge number color
}

export const getLevelRingPalette = (level: number): LevelRingPalette => {
  const rgb = rampRgb(level);
  return {
    ring: toHex(rgb),
    badgeTop: toHex(mixToward(rgb, [255, 255, 255], 0.35)),
    glow: `0 0 16px ${toHex(rgb)}66`,
    text: "#0a0f1a",
  };
};

export interface ZoneProgressData {
  zoneId: number;
  themeId?: number;
  settingsId: number;
  name: string;
  emoji: string;
  stars: number;
  maxStars: number;
  unlocked: boolean;
  cleared: boolean;
  isFree: boolean;
  starCost?: number;
  currentStars?: number;
  levelStars?: number[];
  highestCleared?: number;
  bossCleared?: boolean;
  perfectionClaimed?: boolean;
}
