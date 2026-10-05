using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Presentation;

namespace ZKube.Local.Tests
{
    public sealed class LessonTests
    {
        // Every drag-legal slide judged by the core: each row, start and place the
        // native engine accepts, kept when the cells it passes are empty (a drag
        // cannot carry a block over another).
        private static List<(byte row, byte start, byte destination, long gain, int height)> Oracle(CoreRunToken token)
        {
            var before = NativeEngine.Summary(token); var found = new List<(byte, byte, byte, long, int)>();
            for (byte row = 0; row < 10; row++)
                for (byte start = 0; start < 8; start++)
                    for (byte destination = 0; destination < 8; destination++)
                    {
                        if (start == destination) continue;
                        byte width = before.Grid[row * 8 + start];
                        if (width == 0) continue;
                        int low = Math.Min(start + width, destination), high = Math.Max(start, destination + width);
                        bool clear = Enumerable.Range(low, high - low).All(column => column >= start && column < start + width || before.Grid[row * 8 + column] == 0);
                        if (!clear) continue;
                        RunSummary after;
                        try { after = NativeEngine.Summary(NativeEngine.PlayMove(token, before.ActionCounter, before.Moves, row, start, destination).Token); }
                        catch (NativeEngineException) { continue; }
                        int height = 0;
                        for (int r = 9; r >= 0 && height == 0; r--) if (Enumerable.Range(0, 8).Any(c => after.Grid[r * 8 + c] != 0)) height = r + 1;
                        found.Add((row, start, destination, (long)after.Score - before.Score, height));
                    }
            return found;
        }

        [Test] public void TheHintIsTheSlideClearingTheMostLinesThenTheLowestStack()
        {
            int compared = 0;
            for (int seed = 1; seed <= 24; seed++)
            {
                var product = new LocalProductStore(_ => null, (_, __) => { });
                var runs = new LocalRunClient(product, campaignSeed: () => Enumerable.Repeat((byte)seed, 32).ToArray());
                var view = runs.StartCampaign(1, 1).View;
                for (int move = 0; move < 5; move++)
                {
                    var token = view.Token;
                    if (NativeEngine.Summary(token).Phase != (byte)CorePhase.Playing) break;
                    var legal = Oracle(token);
                    var drags = BoardHint.Slides(NativeEngine.Summary(token).Grid).Select(slide => (slide.Row, slide.Start, slide.Destination)).ToList();
                    CollectionAssert.AreEquivalent(legal.Select(slide => (slide.row, slide.start, slide.destination)), drags,
                        "The hint considers exactly the slides a drag can make (seed " + seed + ")");
                    var hint = BoardHint.Best(token);
                    if (legal.Count == 0) { Assert.That(hint, Is.Null); break; }
                    var top = legal.OrderByDescending(slide => slide.gain).ThenBy(slide => slide.height).First();
                    var chosen = legal.Single(slide => slide.row == hint.Value.Row && slide.start == hint.Value.Start && slide.destination == hint.Value.Destination);
                    Assert.That((chosen.gain, chosen.height), Is.EqualTo((top.gain, top.height)), "seed " + seed + ", move " + move);
                    compared++;
                    view = runs.Act(view.RunId, new LocalRunAction(LocalActionKind.Move, hint.Value.Row, hint.Value.Start, hint.Value.Destination)).View;
                }
            }
            Assert.That(compared, Is.GreaterThan(48), "The hint was judged on many boards");
        }

        [Test] public void EachLessonIsTaughtOnceAndSkipTipsTeachesOnlyTheBoard()
        {
            var lessons = Lessons.Memory();
            Assert.That(Enum.GetValues(typeof(Lesson)).Cast<Lesson>().Any(lessons.Taught), Is.False);
            lessons.Teach(Lesson.Stars);
            Assert.That(lessons.Taught(Lesson.Stars), Is.True); Assert.That(lessons.Taught(Lesson.GuidedRun), Is.False);
            lessons.TeachTheBoard();
            foreach (var lesson in new[] { Lesson.GuidedRun, Lesson.Wave, Lesson.Hammer, Lesson.Totem, Lesson.Star, Lesson.EmptyBoard })
                Assert.That(lessons.Taught(lesson), Is.True, lesson.ToString());
            Assert.That(lessons.Taught(Lesson.RealmsDaily) || lessons.Taught(Lesson.ArenaDaily), Is.False, "Skip tips leaves the pages' lessons");
            Assert.That(Lessons.Memory(taught: true).Taught(Lesson.ArenaDaily), Is.True);
        }

        // How to play is every lesson card in order, then the product's Daily;
        // every line is the guardian's own words over a real skin slot.
        [Test] public void HowToPlayShowsEveryLessonCardThenTheProductsDaily()
        {
            string[] cards = { SkinSlots.LessonSlide, SkinSlots.LessonClear, SkinSlots.LessonNextRow, SkinSlots.LessonTop, SkinSlots.LessonStars,
                SkinSlots.LessonCharge, SkinSlots.LessonWave, SkinSlots.LessonHammer, SkinSlots.LessonTotem, SkinSlots.LessonReroll, SkinSlots.LessonGuardian };
            foreach (bool arena in new[] { false, true })
            {
                var pages = Lessons.HowToPlay(arena);
                var daily = arena ? Lessons.ArenaDaily : Lessons.RealmsDaily(false);
                Assert.That(pages.Length, Is.EqualTo(12 + daily.Length));
                CollectionAssert.AreEqual(cards, pages.Select(page => page.Picture).Distinct().Where(card => card != SkinSlots.LessonDaily));
                Assert.That(pages.Skip(12).Select(page => page.Line), Is.EqualTo(daily.Select(page => page.Line)));
                foreach (var page in pages)
                {
                    Assert.That(page.Picture, Is.Not.Null.And.StartsWith("lesson-"), page.Line);
                    Assert.That(new[] { "Shape", "Blow", "Theme", "UTC", "SOL" }.Any(page.Line.Contains), Is.False, page.Line);
                }
            }
            Assert.That(Lessons.RealmsDaily(true).Length, Is.EqualTo(3), "Signed in, the Realms Daily names its leaderboard");
            StringAssert.Contains(Protocol.DailyMaxMoves + " moves", Lessons.RealmsDaily(false)[1].Line);
        }

        // What a Daily run is, no stars and its move budget, is one lesson, taught
        // once in each product's first Daily between that product's entry and what
        // its scores are for; neither product loses its own lessons.
        [Test] public void BothProductsTeachTheSameDailyRunBetweenTheirOwnLessons()
        {
            string run = Lessons.DailyRun.Line;
            StringAssert.Contains("no stars", run); StringAssert.Contains(Protocol.DailyMaxMoves + " moves", run);
            foreach (var daily in new[] { Lessons.RealmsDaily(false), Lessons.RealmsDaily(true), Lessons.ArenaDaily })
            {
                Assert.That(daily.Count(page => page.Line == run), Is.EqualTo(1));
                Assert.That(daily[1].Line, Is.EqualTo(run), "After the product's own entry");
                Assert.That(daily.Select(page => page.Line).Distinct().Count(), Is.EqualTo(daily.Length));
            }
            StringAssert.Contains("One try a day", Lessons.RealmsDaily(true)[0].Line); StringAssert.Contains("leaderboard", Lessons.RealmsDaily(true)[2].Line);
            var arena = Lessons.ArenaDaily.Select(page => page.Line).ToArray();
            Assert.That(arena.Length, Is.EqualTo(5));
            StringAssert.Contains("Kredit", arena[0]); StringAssert.Contains("Two boards", arena[2]); StringAssert.Contains("prize", arena[3]); StringAssert.Contains("ladder", arena[4]);
            Assert.That(Lessons.RealmsDaily(true).Skip(2).Concat(Lessons.RealmsDaily(true).Take(1)).Any(page => arena.Contains(page.Line)), Is.False, "Only the run is shared");
        }

        // An action's moments: its bonus's first charge, the first star and the
        // first empty board, each while untaught, in that order.
        [Test] public void EachBoardMomentIsTaughtWhenItFirstHappensAndOnlyThen()
        {
            var before = new RunSummary { BonusType = 3, RerollCharges = 1 };
            var after = new RunSummary { BonusType = 3, ChargesEarned = 1, LatchedStarSources = 1, RerollCharges = 2 };
            var lessons = Lessons.Memory();
            CollectionAssert.AreEqual(new[] { Lesson.Wave, Lesson.Star, Lesson.EmptyBoard }, BoardCoach.Moments(before, after, lessons));
            lessons.Teach(Lesson.Wave); lessons.Teach(Lesson.EmptyBoard);
            CollectionAssert.AreEqual(new[] { Lesson.Star }, BoardCoach.Moments(before, after, lessons));
            Assert.That(BoardCoach.Moments(after, new RunSummary { BonusType = 3, ChargesEarned = 2, LatchedStarSources = 3, RerollCharges = 2 }, Lessons.Memory()),
                Is.Empty, "A second charge, another star or a held reroll is no first time");
            CollectionAssert.AreEqual(new[] { Lesson.Hammer }, BoardCoach.Moments(new RunSummary { BonusType = 1 }, new RunSummary { BonusType = 1, ChargesEarned = 1 }, Lessons.Memory()));
            CollectionAssert.AreEqual(new[] { Lesson.Totem }, BoardCoach.Moments(new RunSummary { BonusType = 2 }, new RunSummary { BonusType = 2, ChargesEarned = 1 }, Lessons.Memory()));
        }

        // Each bonus's first charge teaches that bonus, in its own words, with its own card.
        [Test] public void EachBonusHasItsOwnChargeLessonLineAndCard()
        {
            foreach (byte bonus in new byte[] { 1, 2, 3 })
            {
                string name = HudLayout.BonusName(bonus);
                StringAssert.Contains("You earned a " + name + "!", Lessons.Charge(bonus));
                Assert.That(Lessons.ChargeLesson(bonus).ToString(), Is.EqualTo(name));
                Assert.That(Lessons.ChargeCard(bonus), Is.EqualTo("lesson-" + name.ToLowerInvariant()));
            }
            StringAssert.Contains(" three.", Lessons.EmptyBoard, "The reroll cap is the core's");
            Assert.That(Protocol.ChargeCap, Is.EqualTo(3));
        }
    }
}
