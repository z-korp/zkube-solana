using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using UnityEngine;
using ZKube.Presentation;

namespace ZKube.Tests.Presentation
{
    public static class BoardTestState
    {
        private const BindingFlags Fields = BindingFlags.Instance | BindingFlags.NonPublic;
        public static BoardArt Art(BoardController board) => (BoardArt)typeof(BoardController).GetField("art", Fields).GetValue(board);
        public static bool Idle(BoardController board) => board != null && board.PresentationInitialized &&
            !board.Busy && !board.RecoveryRequired && board.Session != null && board.State != null &&
            !board.View.NeedsTextReflow && board.View.TextScale == board.TextScale && Settled(board.View, board.State.Grid);

        public static bool Settled(BoardView view, byte[] grid)
        {
            if (!view.DisplayGrid.SequenceEqual(grid)) return false;
            var blocks = (Dictionary<int, SpriteRenderer>)typeof(BoardView).GetField("blocks", Fields).GetValue(view);
            int count = 0;
            for (int row = 0; row < 10; row++) for (int column = 0; column < 8;)
            {
                int width = grid[row * 8 + column];
                if (width == 0) { column++; continue; }
                if (!blocks.TryGetValue(row * 8 + column, out var sprite) ||
                    Vector2.Distance(sprite.transform.position, view.Layout.CellCenter(row, column, width)) > .01f) return false;
                count++; column += width;
            }
            return count == blocks.Count;
        }
    }
}
