import { darken, lighten, withAlpha } from "@/utils/colour";

export const THEME_IDS = [
  "theme-1",
  "theme-2",
  "theme-3",
  "theme-4",
  "theme-5",
  "theme-6",
  "theme-7",
  "theme-8",
  "theme-9",
  "theme-10",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type MusicContext = "main" | "level" | "boss";

export interface ThemeMeta {
  name: string;
  description: string;
}

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  "theme-1": {
    name: "Tiki",
    description:
      "Moonlit coast in deep cobalt tones, silver surf, and quiet lunar haze with tiki presence",
  },
  "theme-2": {
    name: "Ancient Egypt",
    description:
      "Golden pyramids at dusk with hieroglyph-covered obelisks and sun-drenched sandstone",
  },
  "theme-3": {
    name: "Norse",
    description:
      "Frost-covered viking realm with heavy rune stones, iron-clad shields, and aurora-lit skies",
  },
  "theme-4": {
    name: "Ancient Greece",
    description:
      "White marble temples overlooking the Aegean Sea with elegant Greek-key borders and clean architecture",
  },
  "theme-5": {
    name: "Ancient China",
    description:
      "Imperial jade palace with dragon-scale overlays, golden calligraphy, and mystical mist",
  },
  "theme-6": {
    name: "Ancient Persia",
    description:
      "Regal Persian palace with blue geometric tile mosaics, golden relief carvings, and luminous symmetry",
  },
  "theme-7": {
    name: "Feudal Japan",
    description:
      "Black lacquer dojo with red trim, brushstroke calligraphy, and cherry blossom petals",
  },
  "theme-8": {
    name: "Mayan",
    description:
      "Dense jungle temple ruins with carved stone, calendar glyphs, and moss-covered ancient masonry",
  },
  "theme-9": {
    name: "Tribal",
    description:
      "Earthy savanna ritual grounds with painted patterns, drums, feathers, and tribal symbols",
  },
  "theme-10": {
    name: "Inca",
    description:
      "Mountainous stone citadel with interlocking polygonal masonry, sun-god gold highlights, and rope textile accents",
  },
};

interface BlockColors {
  fill: string;
  glow: string;
  highlight: string;
}

export interface ThemeColors {
  background: string;
  backgroundGradientStart: string;
  backgroundGradientEnd: string;
  gridLines: string;
  gridLinesAlpha: number;
  gridBg: string;
  gridCellAlt: string;
  frameBorder: string;
  hudBar: string;
  hudBarBorder: string;
  actionBarBg: string;
  dangerZone: string;
  dangerZoneAlpha: number;
  accent: string;
  accent2: string;
  text: string;
  textMuted: string;
  surface: string;
  border: string;
  glow: string;
  blocks: Record<1 | 2 | 3 | 4, BlockColors>;
  particles: {
    primary: string[];
    explosion: string[];
  };
}

function uiColors(
  accent: string,
  accent2: string,
): Pick<
  ThemeColors,
  "accent2" | "text" | "textMuted" | "surface" | "border" | "glow"
> {
  return {
    accent2,
    text: "#ffffff",
    textMuted: "rgba(255,255,255,0.5)",
    surface: "rgba(255,255,255,0.04)",
    border: "rgba(255,255,255,0.08)",
    glow: `0 0 16px ${accent}40`,
  };
}

const POLYNESIAN_COLORS: ThemeColors = {
  background: "#041A44",
  backgroundGradientStart: lighten("#041A44", 0.06),
  backgroundGradientEnd: darken("#041A44", 0.12),
  gridLines: darken("#A9D8FF", 0.25),
  gridLinesAlpha: 0.3,
  gridBg: lighten("#041A44", 0.04),
  gridCellAlt: lighten("#041A44", 0.07),
  frameBorder: "#A9D8FF",
  hudBar: darken("#041A44", 0.2),
  hudBarBorder: darken("#A9D8FF", 0.35),
  actionBarBg: darken("#041A44", 0.2),
  dangerZone: "#ff4444",
  dangerZoneAlpha: 0.25,
  accent: "#A9D8FF",
  ...uiColors("#A9D8FF", "#7EC8E3"),
  blocks: {
    1: {
      fill: "#B9C9D1",
      glow: darken("#B9C9D1", 0.18),
      highlight: lighten("#B9C9D1", 0.18),
    },
    2: {
      fill: "#58A4BE",
      glow: darken("#58A4BE", 0.18),
      highlight: lighten("#58A4BE", 0.18),
    },
    3: {
      fill: "#A6BAF6",
      glow: darken("#A6BAF6", 0.18),
      highlight: lighten("#A6BAF6", 0.18),
    },
    4: {
      fill: "#2DEDB3",
      glow: darken("#2DEDB3", 0.18),
      highlight: lighten("#2DEDB3", 0.18),
    },
  },
  particles: {
    primary: ["#B9C9D1", "#58A4BE", "#A6BAF6", "#2DEDB3", "#A9D8FF"],
    explosion: ["#ffffff", "#A9D8FF", "#B9C9D1", "#58A4BE", "#A6BAF6"],
  },
};

const ANCIENT_EGYPT_COLORS: ThemeColors = {
  background: "#120C08",
  backgroundGradientStart: lighten("#120C08", 0.06),
  backgroundGradientEnd: darken("#120C08", 0.12),
  gridLines: darken("#D4AF37", 0.25),
  gridLinesAlpha: 0.3,
  gridBg: lighten("#120C08", 0.04),
  gridCellAlt: lighten("#120C08", 0.07),
  frameBorder: "#D4AF37",
  hudBar: darken("#120C08", 0.2),
  hudBarBorder: darken("#D4AF37", 0.35),
  actionBarBg: darken("#120C08", 0.2),
  dangerZone: "#ff4444",
  dangerZoneAlpha: 0.25,
  accent: "#D4AF37",
  ...uiColors("#D4AF37", "#F0CF7A"),
  blocks: {
    1: {
      fill: "#B7B4AA",
      glow: darken("#B7B4AA", 0.18),
      highlight: lighten("#B7B4AA", 0.18),
    },
    2: {
      fill: "#DF9C6E",
      glow: darken("#DF9C6E", 0.18),
      highlight: lighten("#DF9C6E", 0.18),
    },
    3: {
      fill: "#78ABE9",
      glow: darken("#78ABE9", 0.18),
      highlight: lighten("#78ABE9", 0.18),
    },
    4: {
      fill: "#F5D12A",
      glow: darken("#F5D12A", 0.18),
      highlight: lighten("#F5D12A", 0.18),
    },
  },
  particles: {
    primary: ["#B7B4AA", "#DF9C6E", "#78ABE9", "#F5D12A", "#D4AF37"],
    explosion: ["#ffffff", "#D4AF37", "#B7B4AA", "#DF9C6E", "#78ABE9"],
  },
};

const NORSE_COLORS: ThemeColors = {
  background: "#0A1520",
  backgroundGradientStart: lighten("#0A1520", 0.06),
  backgroundGradientEnd: darken("#0A1520", 0.12),
  gridLines: darken("#7EB8DA", 0.25),
  gridLinesAlpha: 0.3,
  gridBg: lighten("#0A1520", 0.04),
  gridCellAlt: lighten("#0A1520", 0.07),
  frameBorder: "#7EB8DA",
  hudBar: darken("#0A1520", 0.2),
  hudBarBorder: darken("#7EB8DA", 0.35),
  actionBarBg: darken("#0A1520", 0.2),
  dangerZone: "#ff4444",
  dangerZoneAlpha: 0.25,
  accent: "#7EB8DA",
  ...uiColors("#7EB8DA", "#A9C4DF"),
  blocks: {
    1: {
      fill: "#9AA1A7",
      glow: darken("#9AA1A7", 0.18),
      highlight: lighten("#9AA1A7", 0.18),
    },
    2: {
      fill: "#C89B51",
      glow: darken("#C89B51", 0.18),
      highlight: lighten("#C89B51", 0.18),
    },
    3: {
      fill: "#4BA6E0",
      glow: darken("#4BA6E0", 0.18),
      highlight: lighten("#4BA6E0", 0.18),
    },
    4: {
      fill: "#2AE59E",
      glow: darken("#2AE59E", 0.18),
      highlight: lighten("#2AE59E", 0.18),
    },
  },
  particles: {
    primary: ["#9AA1A7", "#C89B51", "#4BA6E0", "#2AE59E", "#7EB8DA"],
    explosion: ["#ffffff", "#7EB8DA", "#9AA1A7", "#C89B51", "#4BA6E0"],
  },
};

const ANCIENT_GREECE_COLORS: ThemeColors = {
  background: "#1A2030",
  backgroundGradientStart: lighten("#1A2030", 0.06),
  backgroundGradientEnd: darken("#1A2030", 0.12),
  gridLines: darken("#3B6FA0", 0.25),
  gridLinesAlpha: 0.3,
  gridBg: lighten("#1A2030", 0.04),
  gridCellAlt: lighten("#1A2030", 0.07),
  frameBorder: "#3B6FA0",
  hudBar: darken("#1A2030", 0.2),
  hudBarBorder: darken("#3B6FA0", 0.35),
  actionBarBg: darken("#1A2030", 0.2),
  dangerZone: "#ff4444",
  dangerZoneAlpha: 0.25,
  accent: "#3B6FA0",
  ...uiColors("#3B6FA0", "#BFD5E8"),
  blocks: {
    1: {
      fill: "#A1936C",
      glow: darken("#A1936C", 0.18),
      highlight: lighten("#A1936C", 0.18),
    },
    2: {
      fill: "#6392C8",
      glow: darken("#6392C8", 0.18),
      highlight: lighten("#6392C8", 0.18),
    },
    3: {
      fill: "#DE7829",
      glow: darken("#DE7829", 0.18),
      highlight: lighten("#DE7829", 0.18),
    },
    4: {
      fill: "#DEC21A",
      glow: darken("#DEC21A", 0.18),
      highlight: lighten("#DEC21A", 0.18),
    },
  },
  particles: {
    primary: ["#A1936C", "#6392C8", "#DE7829", "#DEC21A", "#3B6FA0"],
    explosion: ["#ffffff", "#3B6FA0", "#A1936C", "#6392C8", "#DE7829"],
  },
};

const FEUDAL_JAPAN_COLORS: ThemeColors = {
  background: "#0D0D12",
  backgroundGradientStart: lighten("#0D0D12", 0.06),
  backgroundGradientEnd: darken("#0D0D12", 0.12),
  gridLines: darken("#C41E3A", 0.25),
  gridLinesAlpha: 0.3,
  gridBg: lighten("#0D0D12", 0.04),
  gridCellAlt: lighten("#0D0D12", 0.07),
  frameBorder: "#C41E3A",
  hudBar: darken("#0D0D12", 0.2),
  hudBarBorder: darken("#C41E3A", 0.35),
  actionBarBg: darken("#0D0D12", 0.2),
  dangerZone: "#ff4444",
  dangerZoneAlpha: 0.25,
  accent: "#C41E3A",
  ...uiColors("#C41E3A", "#E19AA3"),
  blocks: {
    1: {
      fill: "#EBE8E2",
      glow: darken("#EBE8E2", 0.18),
      highlight: lighten("#EBE8E2", 0.18),
    },
    2: {
      fill: "#7591D0",
      glow: darken("#7591D0", 0.18),
      highlight: lighten("#7591D0", 0.18),
    },
    3: {
      fill: "#D492D7",
      glow: darken("#D492D7", 0.18),
      highlight: lighten("#D492D7", 0.18),
    },
    4: {
      fill: "#FED53E",
      glow: darken("#FED53E", 0.18),
      highlight: lighten("#FED53E", 0.18),
    },
  },
  particles: {
    primary: ["#EBE8E2", "#7591D0", "#D492D7", "#FED53E", "#C41E3A"],
    explosion: ["#ffffff", "#C41E3A", "#EBE8E2", "#7591D0", "#D492D7"],
  },
};

const ANCIENT_CHINA_COLORS: ThemeColors = {
  background: "#0A1A0A",
  backgroundGradientStart: lighten("#0A1A0A", 0.06),
  backgroundGradientEnd: darken("#0A1A0A", 0.12),
  gridLines: darken("#50C878", 0.25),
  gridLinesAlpha: 0.3,
  gridBg: lighten("#0A1A0A", 0.04),
  gridCellAlt: lighten("#0A1A0A", 0.07),
  frameBorder: "#50C878",
  hudBar: darken("#0A1A0A", 0.2),
  hudBarBorder: darken("#50C878", 0.35),
  actionBarBg: darken("#0A1A0A", 0.2),
  dangerZone: "#ff4444",
  dangerZoneAlpha: 0.25,
  accent: "#50C878",
  ...uiColors("#50C878", "#9CD8B6"),
  blocks: {
    1: {
      fill: "#EBE8E2",
      glow: darken("#EBE8E2", 0.18),
      highlight: lighten("#EBE8E2", 0.18),
    },
    2: {
      fill: "#628EC8",
      glow: darken("#628EC8", 0.18),
      highlight: lighten("#628EC8", 0.18),
    },
    3: {
      fill: "#D0B339",
      glow: darken("#D0B339", 0.18),
      highlight: lighten("#D0B339", 0.18),
    },
    4: {
      fill: "#27D987",
      glow: darken("#27D987", 0.18),
      highlight: lighten("#27D987", 0.18),
    },
  },
  particles: {
    primary: ["#EBE8E2", "#628EC8", "#D0B339", "#27D987", "#50C878"],
    explosion: ["#ffffff", "#50C878", "#EBE8E2", "#628EC8", "#D0B339"],
  },
};

const ANCIENT_PERSIA_COLORS: ThemeColors = {
  background: "#0A0F2A",
  backgroundGradientStart: lighten("#0A0F2A", 0.06),
  backgroundGradientEnd: darken("#0A0F2A", 0.12),
  gridLines: darken("#1E90FF", 0.25),
  gridLinesAlpha: 0.3,
  gridBg: lighten("#0A0F2A", 0.04),
  gridCellAlt: lighten("#0A0F2A", 0.07),
  frameBorder: "#1E90FF",
  hudBar: darken("#0A0F2A", 0.2),
  hudBarBorder: darken("#1E90FF", 0.35),
  actionBarBg: darken("#0A0F2A", 0.2),
  dangerZone: "#ff4444",
  dangerZoneAlpha: 0.25,
  accent: "#1E90FF",
  ...uiColors("#1E90FF", "#9EB7DF"),
  blocks: {
    1: {
      fill: "#B4A17B",
      glow: darken("#B4A17B", 0.18),
      highlight: lighten("#B4A17B", 0.18),
    },
    2: {
      fill: "#8FA4D8",
      glow: darken("#8FA4D8", 0.18),
      highlight: lighten("#8FA4D8", 0.18),
    },
    3: {
      fill: "#EC8A9F",
      glow: darken("#EC8A9F", 0.18),
      highlight: lighten("#EC8A9F", 0.18),
    },
    4: {
      fill: "#3BE1E6",
      glow: darken("#3BE1E6", 0.18),
      highlight: lighten("#3BE1E6", 0.18),
    },
  },
  particles: {
    primary: ["#B4A17B", "#8FA4D8", "#EC8A9F", "#3BE1E6", "#1E90FF"],
    explosion: ["#ffffff", "#1E90FF", "#B4A17B", "#8FA4D8", "#EC8A9F"],
  },
};

const MAYAN_COLORS: ThemeColors = {
  background: "#0A1A0A",
  backgroundGradientStart: lighten("#0A1A0A", 0.06),
  backgroundGradientEnd: darken("#0A1A0A", 0.12),
  gridLines: darken("#4CAF50", 0.25),
  gridLinesAlpha: 0.3,
  gridBg: lighten("#0A1A0A", 0.04),
  gridCellAlt: lighten("#0A1A0A", 0.07),
  frameBorder: "#4CAF50",
  hudBar: darken("#0A1A0A", 0.2),
  hudBarBorder: darken("#4CAF50", 0.35),
  actionBarBg: darken("#0A1A0A", 0.2),
  dangerZone: "#ff4444",
  dangerZoneAlpha: 0.25,
  accent: "#4CAF50",
  ...uiColors("#4CAF50", "#A9BE72"),
  blocks: {
    1: {
      fill: "#BFC5B8",
      glow: darken("#BFC5B8", 0.18),
      highlight: lighten("#BFC5B8", 0.18),
    },
    2: {
      fill: "#7CCAE5",
      glow: darken("#7CCAE5", 0.18),
      highlight: lighten("#7CCAE5", 0.18),
    },
    3: {
      fill: "#F2CB43",
      glow: darken("#F2CB43", 0.18),
      highlight: lighten("#F2CB43", 0.18),
    },
    4: {
      fill: "#3AFE74",
      glow: darken("#3AFE74", 0.18),
      highlight: lighten("#3AFE74", 0.18),
    },
  },
  particles: {
    primary: ["#BFC5B8", "#7CCAE5", "#F2CB43", "#3AFE74", "#4CAF50"],
    explosion: ["#ffffff", "#4CAF50", "#BFC5B8", "#7CCAE5", "#F2CB43"],
  },
};

const PUEBLO_COLORS: ThemeColors = {
  background: "#2A1F14",
  backgroundGradientStart: lighten("#2A1F14", 0.06),
  backgroundGradientEnd: darken("#2A1F14", 0.12),
  gridLines: darken("#40C8B8", 0.25),
  gridLinesAlpha: 0.3,
  gridBg: lighten("#2A1F14", 0.04),
  gridCellAlt: lighten("#2A1F14", 0.07),
  frameBorder: "#40C8B8",
  hudBar: darken("#2A1F14", 0.2),
  hudBarBorder: darken("#40C8B8", 0.35),
  actionBarBg: darken("#2A1F14", 0.2),
  dangerZone: "#ff4444",
  dangerZoneAlpha: 0.25,
  accent: "#40C8B8",
  ...uiColors("#40C8B8", "#E0A07A"),
  blocks: {
    1: {
      fill: "#E0CAC5",
      glow: darken("#E0CAC5", 0.18),
      highlight: lighten("#E0CAC5", 0.18),
    },
    2: {
      fill: "#74D18F",
      glow: darken("#74D18F", 0.18),
      highlight: lighten("#74D18F", 0.18),
    },
    3: {
      fill: "#56D2E5",
      glow: darken("#56D2E5", 0.18),
      highlight: lighten("#56D2E5", 0.18),
    },
    4: {
      fill: "#FED78A",
      glow: darken("#FED78A", 0.18),
      highlight: lighten("#FED78A", 0.18),
    },
  },
  particles: {
    primary: ["#E0CAC5", "#74D18F", "#56D2E5", "#FED78A", "#40C8B8"],
    explosion: ["#ffffff", "#40C8B8", "#E0CAC5", "#74D18F", "#56D2E5"],
  },
};

const INCA_COLORS: ThemeColors = {
  background: "#1A1A2A",
  backgroundGradientStart: lighten("#1A1A2A", 0.06),
  backgroundGradientEnd: darken("#1A1A2A", 0.12),
  gridLines: darken("#D4AF37", 0.25),
  gridLinesAlpha: 0.3,
  gridBg: lighten("#1A1A2A", 0.04),
  gridCellAlt: lighten("#1A1A2A", 0.07),
  frameBorder: "#D4AF37",
  hudBar: darken("#1A1A2A", 0.2),
  hudBarBorder: darken("#D4AF37", 0.35),
  actionBarBg: darken("#1A1A2A", 0.2),
  dangerZone: "#ff4444",
  dangerZoneAlpha: 0.25,
  accent: "#D4AF37",
  ...uiColors("#D4AF37", "#C7BCA9"),
  blocks: {
    1: {
      fill: "#A2A095",
      glow: darken("#A2A095", 0.18),
      highlight: lighten("#A2A095", 0.18),
    },
    2: {
      fill: "#62B37A",
      glow: darken("#62B37A", 0.18),
      highlight: lighten("#62B37A", 0.18),
    },
    3: {
      fill: "#DA9769",
      glow: darken("#DA9769", 0.18),
      highlight: lighten("#DA9769", 0.18),
    },
    4: {
      fill: "#F5D11E",
      glow: darken("#F5D11E", 0.18),
      highlight: lighten("#F5D11E", 0.18),
    },
  },
  particles: {
    primary: ["#A2A095", "#62B37A", "#DA9769", "#F5D11E", "#D4AF37"],
    explosion: ["#ffffff", "#D4AF37", "#A2A095", "#62B37A", "#DA9769"],
  },
};

const THEME_COLORS: Record<ThemeId, ThemeColors> = {
  "theme-1": POLYNESIAN_COLORS,
  "theme-2": ANCIENT_EGYPT_COLORS,
  "theme-3": NORSE_COLORS,
  "theme-4": ANCIENT_GREECE_COLORS,
  "theme-5": ANCIENT_CHINA_COLORS,
  "theme-6": ANCIENT_PERSIA_COLORS,
  "theme-7": FEUDAL_JAPAN_COLORS,
  "theme-8": MAYAN_COLORS,
  "theme-9": PUEBLO_COLORS,
  "theme-10": INCA_COLORS,
};

export function getThemeColors(themeId: ThemeId): ThemeColors {
  return THEME_COLORS[themeId] ?? POLYNESIAN_COLORS;
}

export const THEME_MUSIC: Record<ThemeId, Record<MusicContext, string>> = {
  "theme-1": {
    main: "/assets/theme-1/sounds/musics/main.mp3",
    level: "/assets/theme-1/sounds/musics/level.mp3",
    boss: "/assets/theme-1/sounds/musics/boss.mp3",
  },
  "theme-2": {
    main: "/assets/theme-2/sounds/musics/main.mp3",
    level: "/assets/theme-2/sounds/musics/level.mp3",
    boss: "/assets/theme-2/sounds/musics/boss.mp3",
  },
  "theme-3": {
    main: "/assets/theme-3/sounds/musics/main.mp3",
    level: "/assets/theme-3/sounds/musics/level.mp3",
    boss: "/assets/theme-3/sounds/musics/boss.mp3",
  },
  "theme-4": {
    main: "/assets/theme-4/sounds/musics/main.mp3",
    level: "/assets/theme-4/sounds/musics/level.mp3",
    boss: "/assets/theme-4/sounds/musics/boss.mp3",
  },
  "theme-5": {
    main: "/assets/theme-5/sounds/musics/main.mp3",
    level: "/assets/theme-5/sounds/musics/level.mp3",
    boss: "/assets/theme-5/sounds/musics/boss.mp3",
  },
  "theme-6": {
    main: "/assets/theme-6/sounds/musics/main.mp3",
    level: "/assets/theme-6/sounds/musics/level.mp3",
    boss: "/assets/theme-6/sounds/musics/boss.mp3",
  },
  "theme-7": {
    main: "/assets/theme-7/sounds/musics/main.mp3",
    level: "/assets/theme-7/sounds/musics/level.mp3",
    boss: "/assets/theme-7/sounds/musics/boss.mp3",
  },
  "theme-8": {
    main: "/assets/theme-8/sounds/musics/main.mp3",
    level: "/assets/theme-8/sounds/musics/level.mp3",
    boss: "/assets/theme-8/sounds/musics/boss.mp3",
  },
  "theme-9": {
    main: "/assets/theme-9/sounds/musics/main.mp3",
    level: "/assets/theme-9/sounds/musics/level.mp3",
    boss: "/assets/theme-9/sounds/musics/boss.mp3",
  },
  "theme-10": {
    main: "/assets/theme-10/sounds/musics/main.mp3",
    level: "/assets/theme-10/sounds/musics/level.mp3",
    boss: "/assets/theme-10/sounds/musics/boss.mp3",
  },
};

export const SFX_PATHS = {
  // Core gameplay
  move: "/assets/common/sounds/effects/move.mp3",
  swipe: "/assets/common/sounds/effects/swipe.mp3",
  break: "/assets/common/sounds/effects/break.mp3",
  explode: "/assets/common/sounds/effects/explode.mp3",
  new: "/assets/common/sounds/effects/new.mp3",
  // Game flow
  start: "/assets/common/sounds/effects/start.mp3",
  over: "/assets/common/sounds/effects/over.mp3",
  levelup: "/assets/common/sounds/effects/levelup.mp3",
  victory: "/assets/common/sounds/effects/victory.mp3",
  // Boss
  "boss-intro": "/assets/common/sounds/effects/boss-intro.mp3",
  "boss-defeat": "/assets/common/sounds/effects/boss-defeat.mp3",
  // UI interaction
  click: "/assets/common/sounds/effects/click.mp3",
  coin: "/assets/common/sounds/effects/coin.mp3",
  star: "/assets/common/sounds/effects/star.mp3",
  // Bonus and loadout
  "bonus-activate": "/assets/common/sounds/effects/bonus-activate.mp3",
  equip: "/assets/common/sounds/effects/equip.mp3",
  unequip: "/assets/common/sounds/effects/unequip.mp3",
  "constraint-complete":
    "/assets/common/sounds/effects/constraint-complete.mp3",
} as const;

export type SfxName = keyof typeof SFX_PATHS;

export function getCommonAssetPath(path: string): string {
  return `/assets/common/${path}`;
}

export function getThemeImages(themeId: ThemeId) {
  const base = `/assets/${themeId}`;

  return {
    block1: `${base}/block-1.png`,
    block2: `${base}/block-2.png`,
    block3: `${base}/block-3.png`,
    block4: `${base}/block-4.png`,
    loadingBg: `${base}/loading-bg.png`,
    background: `${base}/background.png`,
    gridBg: `${base}/grid-bg.png`,
    mapBg: `${base}/map-bg.png`,
    mapNodeLevel: `${base}/map-node-level.png`,
    mapNodeBoss: `${base}/map-node-boss.png`,
    mapNodeCompleted: `${base}/map-node-completed.png`,
    themeIcon: `${base}/theme-icon.png`,
  };
}

const AUDIO_STORAGE_KEY = "zkube-audio-settings";
const THEME_STORAGE_KEY = "zkube-theme-template";

export interface AudioSettings {
  musicVolume: number;
  effectsVolume: number;
}

const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  musicVolume: 0.2,
  effectsVolume: 0.4,
};

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) return DEFAULT_AUDIO_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      musicVolume: clamp(
        parsed.musicVolume ?? DEFAULT_AUDIO_SETTINGS.musicVolume,
        0,
        1,
      ),
      effectsVolume: clamp(
        parsed.effectsVolume ?? DEFAULT_AUDIO_SETTINGS.effectsVolume,
        0,
        1,
      ),
    };
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings));
}

export function loadThemeTemplate(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && THEME_IDS.includes(stored as ThemeId)) {
      return stored as ThemeId;
    }
    return "theme-1";
  } catch {
    return "theme-1";
  }
}

export function saveThemeTemplate(themeId: ThemeId): void {
  localStorage.setItem(THEME_STORAGE_KEY, themeId);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type MapPathStyle = "solid" | "dashed" | "dotted" | "double";

export interface MapPathTheme {
  clearedColor: string;
  activeColor: string;
  lockedColor: string;
  branchColor: string;
  pathStyle: MapPathStyle;
  lockedDash: string;
  branchDash: string;
  strokeWidth: number;
  lockedStrokeWidth: number;
}

/**
 * Per-realm path STYLE only. Colour is derived in `getMapPathTheme` from the
 * realm's own palette, because hardcoding it here is what let the map drift:
 * the colour constants are declared in a different order than `THEME_COLORS`
 * maps them (Japan is declared fifth, China sixth, Persia seventh), so an
 * author walking declaration order gave China's map Japan's crimson, Persia's
 * China's jade and Japan's Persia's blue. Deriving cannot make that mistake.
 */
type MapPathStyleSpec = Pick<
  MapPathTheme,
  "pathStyle" | "lockedDash" | "branchDash" | "strokeWidth" | "lockedStrokeWidth"
>;

const MAP_PATH_STYLES: Record<ThemeId, MapPathStyleSpec> = {
  "theme-1": {
    pathStyle: "solid",
    lockedDash: "6 5",
    branchDash: "3 5",
    strokeWidth: 2.5,
    lockedStrokeWidth: 1.8,
  },
  "theme-2": {
    pathStyle: "dashed",
    lockedDash: "8 4",
    branchDash: "4 6",
    strokeWidth: 2.8,
    lockedStrokeWidth: 1.6,
  },
  "theme-3": {
    pathStyle: "solid",
    lockedDash: "2 4",
    branchDash: "2 5",
    strokeWidth: 2.2,
    lockedStrokeWidth: 1.4,
  },
  "theme-4": {
    pathStyle: "dotted",
    lockedDash: "6 4",
    branchDash: "3 4",
    strokeWidth: 2.5,
    lockedStrokeWidth: 1.6,
  },
  "theme-5": {
    pathStyle: "solid",
    lockedDash: "5 5",
    branchDash: "4 4",
    strokeWidth: 2.5,
    lockedStrokeWidth: 1.6,
  },
  "theme-6": {
    pathStyle: "solid",
    lockedDash: "7 5",
    branchDash: "4 5",
    strokeWidth: 3,
    lockedStrokeWidth: 1.8,
  },
  "theme-7": {
    pathStyle: "dashed",
    lockedDash: "3 4",
    branchDash: "2 4",
    strokeWidth: 2.2,
    lockedStrokeWidth: 1.4,
  },
  "theme-8": {
    pathStyle: "solid",
    lockedDash: "5 4",
    branchDash: "3 5",
    strokeWidth: 2.8,
    lockedStrokeWidth: 1.6,
  },
  "theme-9": {
    pathStyle: "dashed",
    lockedDash: "6 4",
    branchDash: "4 5",
    strokeWidth: 2.5,
    lockedStrokeWidth: 1.6,
  },
  "theme-10": {
    pathStyle: "solid",
    lockedDash: "7 4",
    branchDash: "4 4",
    strokeWidth: 2.8,
    lockedStrokeWidth: 1.8,
  },
};

export function getMapPathTheme(themeId: ThemeId): MapPathTheme {
  const colors = THEME_COLORS[themeId] ?? THEME_COLORS["theme-1"];
  const style = MAP_PATH_STYLES[themeId] ?? MAP_PATH_STYLES["theme-1"];
  return {
    // cleared path carries the realm's accent, the next step its companion, and
    // a locked step sinks into the realm's own background
    clearedColor: colors.accent,
    activeColor: colors.accent2,
    lockedColor: darken(colors.background, 0.45),
    branchColor: withAlpha(colors.accent, 0.22),
    ...style,
  };
}

/// Clamp a raw zone id to `[1, 10]` and return the corresponding ThemeId.
/// Missing or legacy snapshots may carry `zone_id = 0`; default to Tiki.
export const getThemeId = (zoneId: number): ThemeId => {
  const normalized = Math.min(10, Math.max(1, zoneId));
  return `theme-${normalized}` as ThemeId;
};
