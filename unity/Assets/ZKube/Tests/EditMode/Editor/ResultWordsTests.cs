using System.Linq;
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
        // The day closes and the next Daily opens at 07:00 UTC: no day clock,
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

        // A Daily result speaks of the run itself in both products: its finest,
        // a scoring run, or one that scored nothing; never the day's greeting.
        [Test] public void ADailyResultSpeaksOfTheRunItself()
        {
            foreach (var (score, beats, best, moment, stars) in new[] {
                (120UL, true, true, TalkMoment.NewBest, 2), (120UL, false, false, TalkMoment.Win, 2), (0UL, true, false, TalkMoment.Win, 1), (0UL, false, false, TalkMoment.Win, 1) })
            {
                var result = new ResultPageView { Score = score }; result.DailyOutcome(beats);
                Assert.AreEqual(best, result.NewBest, score + " " + beats);
                Assert.AreEqual(moment, result.Speaks); Assert.AreEqual(stars, result.SpeaksStars);
            }
        }

        // A player appears once in a board's column: among the rows shown their
        // row is lit in place and nothing is pinned; only a line that is not one
        // of them is pinned under.
        [Test] public void APlayersLineIsPinnedOnlyWhenItIsNotAmongTheRowsShown()
        {
            BoardColumnView Column(int? rank, BoardRowView other = null)
            {
                var rows = System.Linq.Enumerable.Range(1, 10).Select(place => new BoardRowView { Rank = place.ToString(), Yours = place == rank }).ToArray();
                return new BoardColumnView { Rows = rows, Yours = rank.HasValue && rank <= 10 ? rows[rank.Value - 1] : other };
            }
            foreach (int shown in new[] { 5, 10 })
            {
                Assert.IsNull(Column(1).Pinned(shown), "Rank 1"); Assert.IsNull(Column(3).Pinned(shown), "Inside the rows shown");
                Assert.IsNull(Column(shown).Pinned(shown), "The last row shown");
                Assert.IsNull(Column(null).Pinned(shown), "No result");
            }
            Assert.AreEqual("6", Column(6).Pinned(5).Rank, "One below five shown rows");
            var eleventh = new BoardRowView { Rank = "11", Yours = true };
            Assert.AreSame(eleventh, Column(null, eleventh).Pinned(10), "One below ten shown rows");
            var unscored = new BoardRowView { Player = "You", Note = "No score yet", Yours = true };
            Assert.AreSame(unscored, Column(null, unscored).Pinned(5)); Assert.AreSame(unscored, new BoardColumnView { Yours = unscored }.Pinned(5), "Alone on a board without rows");
        }
    }
}
