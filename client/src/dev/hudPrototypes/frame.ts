/**
 * The pane frame, shared by the header and the tray.
 *
 * It is the grid's own frame — a 2px gold-stone stroke at low opacity over a
 * translucent stone fill — so header, board and tray read as three panes of
 * one tablet rather than three widgets that happen to be stacked. The heavy
 * full-opacity bezel this started as out-shouted the board it sat above.
 */
export const FRAME: React.CSSProperties = {
  padding: 2,
  borderRadius: 10,
  background:
    "linear-gradient(180deg, rgba(201,169,110,0.5) 0%, rgba(139,115,85,0.3) 20%, rgba(107,91,62,0.2) 50%, rgba(139,115,85,0.3) 80%, rgba(201,169,110,0.5) 100%)",
  boxShadow: "0 4px 14px -6px rgba(0,0,0,0.8)",
};

export const FRAME_INNER: React.CSSProperties = {
  borderRadius: 8,
  background: "rgba(8,12,20,0.55)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
};
