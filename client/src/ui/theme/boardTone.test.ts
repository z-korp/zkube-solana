import { describe, expect, it } from "vitest";

import { THEME_IDS, getThemeColors } from "@/config/themes";
import { boardTone } from "./boardTone";

const luminance = (css: string) => {
  const [r, g, b] = css.match(/\d+/g)!.map(Number);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

describe("boardTone", () => {
  // The bug this exists to prevent: mixing toward white preserves saturation,
  // so the identical recipe made a saturated navy realm read bright and a
  // near-black brown one read dark. Value is fixed; only hue may move.
  it("lands every realm on the same ground and cap luminance", () => {
    const grounds = THEME_IDS.map((id) =>
      luminance(boardTone(getThemeColors(id)).ground),
    );
    const caps = THEME_IDS.map((id) =>
      luminance(boardTone(getThemeColors(id)).capTop),
    );
    expect(Math.max(...grounds) - Math.min(...grounds)).toBeLessThan(1.5);
    expect(Math.max(...caps) - Math.min(...caps)).toBeLessThan(1.5);
  });

  it("keeps a cap above its ground and a block backing between them", () => {
    for (const id of THEME_IDS) {
      const tone = boardTone(getThemeColors(id));
      const backing = 0.2126 * tone.blockBacking[0] +
        0.7152 * tone.blockBacking[1] +
        0.0722 * tone.blockBacking[2];
      expect(luminance(tone.capTop)).toBeGreaterThan(luminance(tone.ground));
      expect(backing).toBeGreaterThan(luminance(tone.ground));
      expect(backing).toBeLessThanOrEqual(luminance(tone.capTop));
    }
  });

  it("still tells realms apart by hue", () => {
    const polynesia = boardTone(getThemeColors("theme-1")).capTop;
    const egypt = boardTone(getThemeColors("theme-2")).capTop;
    expect(polynesia).not.toEqual(egypt);
  });
});
