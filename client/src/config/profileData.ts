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
  levelStars?: number[];
  highestCleared?: number;
  bossCleared?: boolean;
  perfectionClaimed?: boolean;
}
