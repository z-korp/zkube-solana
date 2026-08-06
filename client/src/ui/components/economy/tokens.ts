/**
 * Fixed palette shared across the Arcade economy components. The per-zone
 * accent comes from `useThemeColors().accent`; these three are semantic and do
 * not change with the theme.
 */

/** Money and stars. */
export const MONEY_GOLD = "#FACC15";
/** Danger / expiry / loss. */
export const DANGER_RED = "#ff5470";
/** "Building tomorrow" — entries funding the following competitions. */
export const BUILDING_GREEN = "#4ade80";

/**
 * Mix a `#rrggbb` colour toward a grey level (0 black … 255 white). Every
 * chunky key derives its light edge, body, and undershadow from one accent
 * through this, so gold and accent keys share the same material.
 */
export function mixHex(hex: string, target: number, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (target - c) * amount);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
