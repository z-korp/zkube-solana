using System.Collections.Generic;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The slide the guardian points at. Of every slide the drag allows (a block
    // moves along its row through empty cells, never over another block), the
    // one the core scores highest, then the one leaving the lowest stack. Each
    // slide is played on the accepted state through the native engine and
    // thrown away: the core alone judges, and nothing is saved.
    public static class BoardHint
    {
        public readonly struct Slide
        {
            public readonly byte Row, Start, Destination, Width;
            public Slide(byte row, byte start, byte destination, byte width) { Row = row; Start = start; Destination = destination; Width = width; }
            public override string ToString() => "row " + Row + ": " + Start + " to " + Destination;
        }

        public static Slide? Best(CoreRunToken accepted)
        {
            var before = NativeEngine.Summary(accepted);
            if (before.Phase != (byte)CorePhase.Playing) return null;
            Slide? best = null; long bestGain = -1; int bestHeight = int.MaxValue;
            foreach (var slide in Slides(before.Grid))
            {
                RunSummary after;
                try
                {
                    after = NativeEngine.Summary(NativeEngine.PlayMove(accepted, before.ActionCounter, before.Moves, slide.Row, slide.Start, slide.Destination).Token);
                }
                catch (NativeEngineException) { continue; }
                long gain = (long)after.Score - before.Score; int height = Height(after.Grid);
                if (gain > bestGain || gain == bestGain && height < bestHeight) { best = slide; bestGain = gain; bestHeight = height; }
            }
            return best;
        }

        // Every slide a drag can make: each block, to each start its row's empty
        // cells let it reach on either side.
        public static IEnumerable<Slide> Slides(byte[] grid)
        {
            for (int row = 0; row < 10; row++)
            {
                int at = row * 8;
                for (int column = 0; column < 8;)
                {
                    byte width = grid[at + column];
                    if (width == 0) { column++; continue; }
                    for (int left = column - 1; left >= 0 && grid[at + left] == 0; left--)
                        yield return new Slide((byte)row, (byte)column, (byte)left, width);
                    for (int right = column + 1; right + width - 1 < 8 && grid[at + right + width - 1] == 0; right++)
                        yield return new Slide((byte)row, (byte)column, (byte)right, width);
                    column += width;
                }
            }
        }

        private static int Height(byte[] grid)
        {
            for (int row = 9; row >= 0; row--)
                for (int column = 0; column < 8; column++) if (grid[row * 8 + column] != 0) return row + 1;
            return 0;
        }
    }
}
