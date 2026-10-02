using NUnit.Framework;
using UnityEngine;
using ZKube.Presentation;

namespace ZKube.Editor.Tests
{
    public sealed class BoardLayoutTests
    {
        [TestCase(320, 568, 1)] [TestCase(430, 932, 1)] [TestCase(1536, 2048, 2)]
        public void ATallHeaderAndEarnPanelKeepSeparateActionsInsideTheSafeFrame(float width, float height, float density)
        {
            // The font-backed tests validate the content; this isolates safe-area
            // and control geometry under a tall header and a three-line Earn panel.
            var safe = new Rect(0, 34 * density, width, height - 78 * density);
            var layout = new BoardLayout(safe, density, 280 * density, 90 * density);
            foreach (var button in new[] { layout.GuardianButton, layout.RerollButton, layout.PauseButton })
            {
                Assert.GreaterOrEqual(button.width / density, 48); Assert.GreaterOrEqual(button.height / density, 48);
                Assert.IsTrue(safe.Contains(button.min)); Assert.IsTrue(safe.Contains(button.max));
            }
            Assert.AreEqual(90 * density, layout.EarnPanel.height, .01f);
            Assert.IsTrue(safe.Contains(layout.EarnPanel.min));
            Assert.IsFalse(layout.PauseButton.Overlaps(layout.EarnPanel)); Assert.IsFalse(layout.EarnPanel.Overlaps(layout.GuardianButton));
            Assert.IsFalse(layout.GuardianButton.Overlaps(layout.RerollButton));
            Assert.GreaterOrEqual(layout.Tray.yMin, safe.yMin + layout.Footer - .01f);
            Assert.LessOrEqual(layout.Rim.yMax, safe.yMax - layout.Header);
        }
        [Test] public void TheSeekerDrawingHasItsApprovedGeometry()
        {
            // At 400 x 890 dp under the default 222 dp header the cells take the
            // width (DECISIONS 2026-10-02): 48 dp cells, the frame 4 dp in from each
            // side at 4, 222 (392 x 488), the tray 26 dp under it (60 dp) and the
            // thumb row 14 dp under the tray, spread over the frame's 392 dp.
            var layout = new BoardLayout(new Rect(0, 0, 1200, 2670), 3);
            float Top(float y) => (2670 - y) / 3;
            Rect Dp(Rect r) => new Rect(r.x / 3, Top(r.yMax), r.width / 3, r.height / 3);
            void Near(Rect expected, Rect actual)
            {
                Assert.AreEqual(expected.x, actual.x, .05f, "x " + actual); Assert.AreEqual(expected.y, actual.y, .05f, "y " + actual);
                Assert.AreEqual(expected.width, actual.width, .05f, "width " + actual); Assert.AreEqual(expected.height, actual.height, .05f, "height " + actual);
            }
            float X(float dp) => 4 + dp * 392 / BoardLayout.RowDp;
            Assert.IsFalse(layout.Compact);
            Assert.AreEqual(48, layout.Cell / 3, .001f);
            Near(new Rect(4, 222, 392, 488), Dp(layout.Rim));
            Near(new Rect(4, 736, 392, 60), Dp(layout.Tray));
            Near(new Rect(X(2), 813, 44, 44), Dp(layout.PauseFace));
            Near(new Rect(X(54), 810, 170, 50), Dp(layout.EarnPanel));
            Near(new Rect(X(234), 805, 60, 60), Dp(layout.GuardianButton));
            Near(new Rect(X(306), 805, 60, 60), Dp(layout.RerollButton));
            Near(new Rect(8, 226, 384, 480), Dp(layout.Board));
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
