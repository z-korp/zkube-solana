/**
 * Fixed palette shared across the Arcade economy components. The per-zone
 * accent comes from `useThemeColors().accent`; money gold is semantic and does
 * not change with the theme.
 */

/** Money and stars. */
export const MONEY_GOLD = "#FACC15";

/**
 * The crown-row plate: opaque block furniture, never glass blur.
 *
 * Shared because the plate is what makes a header row read as one row — Home
 * and Campaign wear the same chip beside the same 46px display title, so a
 * second definition would drift the two apart a shade at a time.
 */
export const PLATE_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, #101A2E 0%, #0A1120 100%)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow: "0 3px 0 #04070F, inset 0 1px 0 rgba(255,255,255,0.08)",
};

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
