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
            var layout = new BoardLayout(safe, density, 280 * density, 120 * density);
            foreach (var button in new[] { layout.GuardianButton, layout.RerollButton, layout.PauseButton })
            {
                Assert.GreaterOrEqual(button.width / density, 48); Assert.GreaterOrEqual(button.height / density, 48);
                Assert.IsTrue(safe.Contains(button.min)); Assert.IsTrue(safe.Contains(button.max));
            }
            Assert.IsFalse(layout.GuardianButton.Overlaps(layout.RerollButton));
            Assert.IsFalse(layout.RerollButton.Overlaps(layout.PauseButton));
            Assert.GreaterOrEqual(layout.Tray.yMin, safe.yMin + layout.Footer);
            Assert.LessOrEqual(layout.Rim.yMax, safe.yMax - layout.Header);
        }
        [Test] public void TheSeekerDrawingHasItsApprovedGeometry()
        {
            // The approved HUD is drawn at 400 x 890 dp: 47 dp cells, the frame
            // at 8, 174 (384 x 478), the tray at 700 (59 dp) and the tablets at 778.
            var layout = new BoardLayout(new Rect(0, 0, 1200, 2670), 3);
            float Top(float y) => (2670 - y) / 3;
            Assert.IsFalse(layout.Compact);
            Assert.AreEqual(47, layout.Cell / 3, .001f);
            Assert.AreEqual(new Rect(8, 174, 384, 478), new Rect(layout.Rim.x / 3, Top(layout.Rim.yMax), layout.Rim.width / 3, layout.Rim.height / 3));
            Assert.AreEqual(700, Top(layout.Tray.yMax), .001f); Assert.AreEqual(59, layout.Tray.height / 3, .001f);
            Assert.AreEqual(new Rect(170, 778, 64, 64), new Rect(layout.GuardianButton.x / 3, Top(layout.GuardianButton.yMax), 64, layout.GuardianButton.height / 3));
            Assert.AreEqual(252, layout.RerollButton.x / 3, .001f); Assert.AreEqual(new Vector2(336, 786),
                new Vector2(layout.PauseButton.x / 3, Top(layout.PauseButton.yMax)));
            Assert.AreEqual(new Rect(12, 178, 376, 470), new Rect(layout.Board.x / 3, Top(layout.Board.yMax), layout.Board.width / 3, layout.Board.height / 3));
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
