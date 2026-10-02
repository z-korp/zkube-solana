using UnityEngine;

namespace ZKube.Presentation
{
    // All rectangles are real screen pixels, y up. The board is the largest
    // square-celled 8 x 10 grid that fits the safe area under the header, over
    // the next-row tray and the thumb row. Lengths follow the Lumen HUD
    // wireframes, drawn at 400 x 890 dp; compact screens (under 780 dp of safe
    // height) use the tighter header, label gap and margins.
    public readonly struct BoardLayout
    {
        public const float MinimumTouchDp = 48, CompactHeightDp = 780;
        // The board frame's rim, the tray's inset around its row and the space
        // between the frame and the tray, which holds the NEXT ROW label.
        public const float RimDp = 4;
        private static float TrayInsetDp(bool compact) => compact ? 4 : 6;
        private static float LabelGapDp(bool compact) => compact ? 16 : 26;
        public static float DefaultHeaderDp(bool compact) => compact ? 156 : 222;
        // The frame stands this far in from each side of the safe area.
        public const float SideDp = 4;
        // The largest cell a width allows: the frame and its side margins, at most 96 dp.
        public static float WidestCellDp(float widthDp) => Mathf.Min(96, (widthDp - 2 * SideDp - 2 * RimDp) / 8);
        private static float BottomDp(bool compact) => compact ? 4 : 16;
        // The thumb row hangs 14 dp under the tray, 4 dp on a compact screen.
        private static float RowGapDp(bool compact, float k) => compact ? 4 : 14 * k;
        // The thumb row is drawn 382.7 dp wide: 14 dp under the tray, pause at 2,
        // the Earn panel at 54 and the power and reroll tablets at 234 and 306.
        public const float RowDp = 382.7f, EarnDp = 50, TabletDp = 60, PauseDp = 44;
        public static float CanvasTouchSize(float preferred, float density, float canvasScale)
        {
            if (float.IsNaN(density) || float.IsInfinity(density) || density <= 0 || float.IsNaN(canvasScale) || float.IsInfinity(canvasScale) || canvasScale <= 0)
                throw new System.ArgumentOutOfRangeException("display metrics");
            return Mathf.Max(preferred, MinimumTouchDp * density / canvasScale);
        }
        // Frame is the safe area; Rim is the board frame around the cells; Tray
        // holds the next row, whose cells are Preview. PauseButton, GuardianButton
        // and RerollButton are touch areas of at least 48 dp; PauseFace is the
        // pause plate as drawn.
        public readonly Rect Frame, Rim, Board, Tray, Preview, EarnPanel, PauseFace, PauseButton, GuardianButton, RerollButton;
        public readonly float Cell, Density, Header, Footer, TrayInset, RowScale;
        // Everything under the header except the board's cells and the tray's row.
        public readonly float BelowHeader;
        public readonly bool Compact;
        // earnPixels is the Earn panel's height when its caption needs more than
        // drawn; labelPixels the NEXT ROW label's, when larger text needs more gap.
        public BoardLayout(Rect safeArea, float density, float headerPixels = 0, float earnPixels = 0, float labelPixels = 0)
        {
            Density = Mathf.Max(.5f, density);
            float d = Density;
            Frame = safeArea;
            Compact = safeArea.height / d < CompactHeightDp;
            Header = headerPixels > 0 ? headerPixels : DefaultHeaderDp(Compact) * d;
            // The row scales with the width it spans, up to its drawn width.
            float row = Mathf.Min(safeArea.width / d - 16, RowDp);
            RowScale = row / RowDp;
            float k = RowScale, earn = Mathf.Max(EarnDp * k * d, earnPixels);
            // The tablets stand 5 dp proud of the row, level with it on a compact screen.
            float lift = Compact ? 0 : -5;
            Footer = RowGapDp(Compact, k) * d + Mathf.Max((TabletDp + lift) * k * d, earn) + BottomDp(Compact) * d;
            TrayInset = TrayInsetDp(Compact) * d;
            float rim = RimDp * d;
            float label = Mathf.Max(LabelGapDp(Compact) * d, labelPixels);
            BelowHeader = Footer + 2 * rim + label + 2 * TrayInset;
            float stack = Header + BelowHeader;
            Cell = Mathf.Max(1, Mathf.Floor(Mathf.Min(WidestCellDp(safeArea.width / d) * d, (safeArea.height - stack) / 11)));
            float top = safeArea.yMax - Header - rim;
            Board = new Rect(safeArea.center.x - 4 * Cell, top - 10 * Cell, 8 * Cell, 10 * Cell);
            Rim = new Rect(Board.x - rim, Board.y - rim, Board.width + 2 * rim, Board.height + 2 * rim);
            Tray = new Rect(Rim.x, Rim.y - label - Cell - 2 * TrayInset, Rim.width, Cell + 2 * TrayInset);
            Preview = new Rect(Board.x, Tray.y + TrayInset, 8 * Cell, Cell);
            // The row hangs under the tray, spread over the frame or its own width.
            float width = Mathf.Max(Rim.width, row * d), left = safeArea.center.x - width / 2, rowTop = Tray.y - RowGapDp(Compact, k) * d;
            float X(float dp) => left + dp * width / RowDp;
            Rect Square(float x, float fromRowTop, float size) => new Rect(x, rowTop - (fromRowTop + size) * k * d, size * k * d, size * k * d);
            Rect Touch(Rect face)
            {
                float size = Mathf.Max(face.width, MinimumTouchDp * d);
                return new Rect(face.center.x - size / 2, face.center.y - size / 2, size, size);
            }
            PauseFace = Square(X(2), 3, PauseDp); PauseButton = Touch(PauseFace);
            GuardianButton = Touch(Square(X(234), lift, TabletDp)); RerollButton = Touch(Square(X(306), lift, TabletDp));
            // On a narrow row the pause's 48 dp touch area pushes the panel's left edge.
            float earnLeft = Mathf.Max(X(54), PauseButton.xMax);
            EarnPanel = new Rect(earnLeft, rowTop - earn, X(54) + 170 * k * d - earnLeft, earn);
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
