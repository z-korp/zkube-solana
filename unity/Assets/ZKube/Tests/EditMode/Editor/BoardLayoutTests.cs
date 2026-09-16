using NUnit.Framework;
using UnityEngine;
using ZKube.Presentation;

namespace ZKube.Editor.Tests
{
    public sealed class BoardLayoutTests
    {
        [TestCase(320, 568, 1)] [TestCase(430, 932, 1)] [TestCase(1536, 2048, 2)]
        public void TallerTextRailsKeepSeparateActionsInsideTheSafeFrame(float width, float height, float density)
        {
            // The font-backed tests above validate the content; this isolates
            // safe-area/control geometry with the additional measured rails.
            var safe = new Rect(0, 34 * density, width, height - 78 * density);
            var layout = new BoardLayout(safe, density, 280 * density, 120 * density, true);
            foreach (var button in new[] { layout.GuardianButton, layout.RerollButton, layout.PauseButton })
            {
                Assert.GreaterOrEqual(button.width / density, 48); Assert.GreaterOrEqual(button.height / density, 48);
                Assert.IsTrue(safe.Contains(button.min)); Assert.IsTrue(safe.Contains(button.max));
            }
            Assert.IsFalse(layout.GuardianButton.Overlaps(layout.RerollButton));
            Assert.IsFalse(layout.RerollButton.Overlaps(layout.PauseButton));
            Assert.GreaterOrEqual(layout.Board.yMin, safe.yMin + layout.Footer);
            Assert.LessOrEqual(layout.Board.yMax, safe.yMax - layout.Header);
        }
        [TestCase(320, 568, 1)] [TestCase(430, 854, 1)] [TestCase(1080, 2262, 3)] [TestCase(1024, 768, 1)]
        public void LayoutFitsSafeAreaAndSeparates48DpControls(int width, int height, float density)
        {
            var safe = new Rect(0, 34 * density, width, height);
            var layout = new BoardLayout(safe, density);
            Assert.Greater(layout.Cell, 0);
            Assert.IsTrue(safe.Contains(layout.Board.min)); Assert.IsTrue(safe.Contains(layout.Board.max - Vector2.one));
            foreach (var rect in new[] { layout.GuardianButton, layout.RerollButton, layout.PauseButton })
            {
                Assert.GreaterOrEqual(rect.width / density, 48); Assert.GreaterOrEqual(rect.height / density, 48);
                Assert.IsTrue(safe.Contains(rect.min)); Assert.IsTrue(safe.Contains(rect.max - Vector2.one));
                Assert.IsFalse(rect.Overlaps(layout.Board));
            }
            Assert.IsFalse(layout.GuardianButton.Overlaps(layout.RerollButton));
            Assert.IsFalse(layout.RerollButton.Overlaps(layout.PauseButton));
        }
    }
}
