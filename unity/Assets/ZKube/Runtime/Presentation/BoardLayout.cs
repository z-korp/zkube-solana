using UnityEngine;

namespace ZKube.Presentation
{
    // All rectangles are real screen pixels, y up. The board is the largest
    // square-celled 8 x 10 grid that fits the safe area under the header, over
    // the next-row tray and the footer's tablets. Lengths follow the Lumen HUD
    // geometry, drawn at 400 x 890 dp; compact screens (under 780 dp of safe
    // height) use the tighter header, tray and footer.
    public readonly struct BoardLayout
    {
        public const float MinimumTouchDp = 48, CompactHeightDp = 780;
        // The board frame's rim, the tray's inset around its row and the space
        // between the frame and the tray, which holds the NEXT ROW label.
        public const float RimDp = 4;
        private static float TrayInsetDp(bool compact) => compact ? 4 : 6;
        private static float LabelGapDp(bool compact) => compact ? 24 : 48;
        private static float TrayGapDp(bool compact) => compact ? 8 : 19;
        public static float DefaultHeaderDp(bool compact) => compact ? 126 : 174;
        public static float TabletDp(bool compact) => compact ? 52 : 64;
        private static float BottomDp(bool compact) => compact ? 8 : 16;
        public static float DefaultFooterDp(bool compact) => TabletDp(compact) + BottomDp(compact);
        public static float CanvasTouchSize(float preferred, float density, float canvasScale)
        {
            if (float.IsNaN(density) || float.IsInfinity(density) || density <= 0 || float.IsNaN(canvasScale) || float.IsInfinity(canvasScale) || canvasScale <= 0)
                throw new System.ArgumentOutOfRangeException("display metrics");
            return Mathf.Max(preferred, MinimumTouchDp * density / canvasScale);
        }
        // Frame is the safe area; Rim is the board frame around the cells; Tray
        // holds the next row, whose cells are Preview.
        public readonly Rect Frame, Rim, Board, Tray, Preview, FooterColumn, GuardianButton, RerollButton, PauseButton;
        public readonly float Cell, Density, Header, Footer, TrayInset;
        public readonly bool Compact;
        public BoardLayout(Rect safeArea, float density, float headerPixels = 0, float footerPixels = 0)
        {
            Density = Mathf.Max(.5f, density);
            float d = Density;
            Frame = safeArea;
            Compact = safeArea.height / d < CompactHeightDp;
            Header = Mathf.Max(DefaultHeaderDp(Compact) * d, headerPixels);
            Footer = Mathf.Max(DefaultFooterDp(Compact) * d, footerPixels);
            TrayInset = TrayInsetDp(Compact) * d;
            float rim = RimDp * d, stack = Header + Footer + 2 * rim + LabelGapDp(Compact) * d + 2 * TrayInset + TrayGapDp(Compact) * d;
            Cell = Mathf.Max(1, Mathf.Floor(Mathf.Min(96 * d, (safeArea.width - 16 * d - 2 * rim) / 8, (safeArea.height - stack) / 11)));
            float top = safeArea.yMax - Header - rim;
            Board = new Rect(safeArea.center.x - 4 * Cell, top - 10 * Cell, 8 * Cell, 10 * Cell);
            Rim = new Rect(Board.x - rim, Board.y - rim, Board.width + 2 * rim, Board.height + 2 * rim);
            Tray = new Rect(Rim.x, Rim.y - LabelGapDp(Compact) * d - Cell - 2 * TrayInset, Rim.width, Cell + 2 * TrayInset);
            Preview = new Rect(Board.x, Tray.y + TrayInset, 8 * Cell, Cell);
            // Tablets hang under the tray, pause at the right edge, then reroll and
            // the power; spare height stays below them.
            float tablet = Mathf.Max(MinimumTouchDp, TabletDp(Compact)) * d, pause = MinimumTouchDp * d;
            float bottom = Mathf.Max(safeArea.y + BottomDp(Compact) * d, Tray.y - TrayGapDp(Compact) * d - tablet);
            // The footer spans the frame, or its own contents when a board is narrower.
            float footerWidth = Mathf.Max(Rim.width, Mathf.Min(safeArea.width - 16 * d, 480 * d));
            FooterColumn = new Rect(safeArea.center.x - footerWidth / 2, safeArea.y, footerWidth, 0);
            PauseButton = new Rect(FooterColumn.xMax - 8 * d - pause, bottom + (tablet - pause) / 2, pause, pause);
            RerollButton = new Rect(PauseButton.x - (Compact ? 12 : 20) * d - tablet, bottom, tablet, tablet);
            GuardianButton = new Rect(RerollButton.x - (Compact ? 12 : 18) * d - tablet, bottom, tablet, tablet);
        }
        public Vector2 CellCenter(int row, int start, int width = 1)
            => new Vector2(Board.x + (start + width * .5f) * Cell, Board.y + (row + .5f) * Cell);
        // Blocks sit 3% of a cell inside their cells, as the art is drawn.
        public Rect BlockRect(float x, float y, int width) =>
            new Rect(x + .03f * Cell, y + .03f * Cell, width * Cell - .06f * Cell, .94f * Cell);
        public bool TryCell(Vector2 screen, out int row, out int column)
        {
            row = Mathf.FloorToInt((screen.y - Board.y) / Cell);
            column = Mathf.FloorToInt((screen.x - Board.x) / Cell);
            return Board.Contains(screen) && row >= 0 && row < 10 && column >= 0 && column < 8;
        }
    }
}
