using NUnit.Framework;
using ZKube.Presentation;

namespace ZKube.Editor.Tests
{
    public sealed class ResultWordsTests
    {
        private static (string, string, string, bool) Words(byte reason, byte stars, uint moves, bool? nextOpen = false, byte realm = 1, byte level = 1) =>
            PageViews.ResultWords(new ResultPageView { EndReason = reason, StarSources = stars, MovesLeft = moves, NextOpen = nextOpen, Realm = realm, Level = level });

        // Every title and line comes from the run's real end and the stars it kept.
        [Test] public void EveryResultSaysHowTheRunEndedAndWhatItOpened()
        {
            Assert.AreEqual(("Level cleared!", "Level 2 is open", (string)null, true), Words(1, 7, 3));
            Assert.AreEqual(("Out of moves", "2 stars kept · Level 2 is open", "icon-hourglass-empty", true), Words(2, 3, 0));
            Assert.AreEqual(("Out of moves", "1 star kept · Level 2 is open", "icon-hourglass-empty", true), Words(2, 4, 0));
            Assert.AreEqual(("Out of moves", "No stars kept · earn one to open Level 2", "icon-hourglass-empty", false), Words(2, 0, 0));
            Assert.AreEqual(("Board full", "1 star kept · Level 2 is open", "icon-board-full", true), Words(2, 2, 4));
            Assert.AreEqual(("Board full", "No stars kept · earn one to open Level 2", "icon-board-full", false), Words(2, 0, 4));
            Assert.AreEqual(("Run ended", "An ended run keeps no stars.", "icon-flag", false), Words(3, 0, 5));
        }
        // The day closes and the next Daily opens at 00:00 UTC: no day clock,
        // the pages' or the HUD's, reads 24 hours.
        [Test] public void EveryDayCountdownReadsAtMostOneSecondUnderADay()
        {
            Assert.AreEqual("23:59", HudLayout.TimeLeft(24 * 3600));
            Assert.AreEqual("0:00", HudLayout.TimeLeft(-1));
            Assert.AreEqual("23:59:59", PageViews.DayClock(24 * 3600));
            Assert.AreEqual("23:59:59", PageViews.DayClock(24 * 3600 - 1));
            Assert.AreEqual("00:00:01", PageViews.DayClock(1));
            Assert.AreEqual("00:00:00", PageViews.DayClock(0));
            Assert.AreEqual("00:00:00", PageViews.DayClock(-5));
        }
        [Test] public void AStarlessRunNeverClaimsTheNextLevelIsShutWhenItIsOpenOrUnknown()
        {
            Assert.AreEqual("No stars kept", Words(2, 0, 0, nextOpen: true).Item2);
            Assert.AreEqual("No stars kept", Words(2, 0, 0, nextOpen: null).Item2);
            // Levels are numbered across realms: the guardian's level opens the next realm's first.
            Assert.AreEqual("1 star kept · Level 11 is open", Words(2, 1, 0, level: 10).Item2);
            // The tenth realm's tenth level is the last.
            byte last = 10, top = 10;
            Assert.AreEqual("Every level is cleared", Words(1, 7, 0, realm: last, level: top).Item2);
            Assert.AreEqual("2 stars kept", Words(2, 3, 0, realm: last, level: top).Item2);
        }
    }
}
