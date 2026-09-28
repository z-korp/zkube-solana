using UnityEngine;

namespace ZKube.Presentation
{
    // All rectangles are real screen pixels. Only density converts independent
    // controls to dp; board cells are fitted separately and may be smaller.
    public readonly struct BoardLayout
    {
        // The Jelly board frame's gold bar ends 24 dp inside its edge; compact screens draw it slimmer.
        public const float MinimumTouchDp = 48, TrayInset = 6;
        public float FrameInset => (Compact ? 14 : 22) * Density;
        public float FrameScale => Compact ? 14f / 22f : 1;
        public static float CanvasTouchSize(float preferred, float density, float canvasScale)
        {
            if (float.IsNaN(density) || float.IsInfinity(density) || density <= 0 || float.IsNaN(canvasScale) || float.IsInfinity(canvasScale) || canvasScale <= 0)
                throw new System.ArgumentOutOfRangeException("display metrics");
            return Mathf.Max(preferred, MinimumTouchDp * density / canvasScale);
        }
        public readonly Rect Frame, Board, Preview, GuardianButton, RerollButton, PauseButton;
        public readonly float Cell, Density, Header, Footer;
        public readonly bool Compact;
        public BoardLayout(Rect safeArea, float density, float headerPixels = 0, float footerPixels = 0, bool ruleAbove = false)
        {
            Density = Mathf.Max(.5f, density);
            float width = Mathf.Min(safeArea.width, safeArea.height * .72f);
            Frame = new Rect(safeArea.center.x - width / 2, safeArea.y, width, safeArea.height);
            Compact = safeArea.height / Density < 780;
            Header = Mathf.Max((Compact ? 104 : 150) * Density, headerPixels);
            Footer = Mathf.Max((Compact ? 68 : 96) * Density, footerPixels);
            // The board frame and the next-row tray need room around the cells.
            float inset = (Compact ? 14 : 22) * Density, previewGap = (Compact ? 22 : 32) * Density;
            Cell = Mathf.Max(1, Mathf.Min(96 * Density, Mathf.Floor((width - 2 * inset) / 8),
                Mathf.Floor((Frame.height - Header - Footer - previewGap - inset - TrayInset * Density) / 11)));
            float available = Frame.height - Header - Footer - inset - TrayInset * Density;
            float bottom = Frame.y + Footer + TrayInset * Density + (available - 11 * Cell - previewGap) / 2;
            Preview = new Rect(Frame.center.x - 4 * Cell, bottom, Cell * 8, Cell);
            Board = new Rect(Preview.x, Preview.yMax + previewGap, Cell * 8, Cell * 10);
            float button = Mathf.Max(MinimumTouchDp * Density, (Compact ? 52 : 64) * Density);
            float gap = 16 * Density;
            GuardianButton = new Rect(Frame.center.x - button - gap / 2, Frame.y + (ruleAbove ? 8 * Density : (Footer - button) / 2), button, button);
            RerollButton = new Rect(Frame.center.x + gap / 2, GuardianButton.y, button, button);
            PauseButton = new Rect(Frame.xMax - 52 * Density, GuardianButton.center.y - MinimumTouchDp / 2 * Density, MinimumTouchDp * Density, MinimumTouchDp * Density);
        }
        public Vector2 CellCenter(int row, int start, int width = 1)
            => new Vector2(Board.x + (start + width * .5f) * Cell, Board.y + (row + .5f) * Cell);
        public bool TryCell(Vector2 screen, out int row, out int column)
        {
            row = Mathf.FloorToInt((screen.y - Board.y) / Cell);
            column = Mathf.FloorToInt((screen.x - Board.x) / Cell);
            return Board.Contains(screen) && row >= 0 && row < 10 && column >= 0 && column < 8;
        }
    }
}
