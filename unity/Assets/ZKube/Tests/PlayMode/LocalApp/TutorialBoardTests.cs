using System.Collections;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Local.App;
using ZKube.Presentation;
using ZKube.Presentation.Tests;

namespace ZKube.Tests
{
    // The tutorial on the Realms board (build/tutorial/design.txt): the guided
    // first run, Skip tips and the hand under reduced motion.
    public sealed partial class StoreAppPageJourneyTests
    {
        private BoardCoach Coach => app.GetComponent<RunBoard>().Coach;
        private static Lessons AllBut(params Lesson[] untaught)
        {
            int bits = ~untaught.Aggregate(0, (mask, lesson) => mask | 1 << (int)lesson);
            return new Lessons(() => bits, value => bits = value);
        }
        private IEnumerator OpenTikiOne()
        {
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Click(app, "Trial 1"); yield return Page(StorePage.Level);
            Click(app, "Play"); yield return BoardReady();
        }
        // Plays slide by dragging its block from its middle to its new place.
        private IEnumerator Play(BoardHint.Slide slide)
        {
            var layout = board.View.Layout; float cell = layout.Cell;
            var from = new Vector2(layout.Board.x + (slide.Start + slide.Width / 2f) * cell, layout.Board.y + (slide.Row + .5f) * cell);
            uint before = board.State.ActionCounter;
            yield return TestBoardPointer.Drag(from, from + new Vector2((slide.Destination - slide.Start) * cell, 0));
            yield return Wait(() => board.State.ActionCounter == before + 1 && !board.Busy && ZKube.Tests.Presentation.BoardTestState.Idle(board), "The slide was accepted: " + slide);
            yield return null;
        }

        [UnityTest] public IEnumerator TheGuidedFirstRunPointsAtTheBestSlideAndLetsGoAfterThreeMoves()
        {
            Lessons.Device = AllBut(Lesson.GuidedRun);
            yield return OpenTikiOne();
            yield return Wait(() => Coach.Said.Count > 0, "The guardian speaks before the first move");
            Assert.That(Coach.Said, Is.EqualTo(new[] { Lessons.Slide }));
            Assert.That(Coach.Pointing.HasValue, Is.True, "The guardian points at a slide");
            var best = Coach.Pointing.Value;
            Assert.That(best.ToString(), Is.EqualTo(BoardHint.Best(board.Session.Accepted).Value.ToString()), "It is the core's best slide");
            Assert.That(Buttons().Any(button => button.name == Lessons.Skip), Is.True, "The guide can be skipped");
            yield return Play(best);
            Assert.That(Coach.Said.Count, Is.EqualTo(2));
            Assert.That(new[] { Lessons.Clears, Lessons.Falls }, Does.Contain(Coach.Said[0])); Assert.That(Coach.Said[1], Is.EqualTo(Lessons.Rises));
            // The board never waits for the hint: any slide a drag can make is accepted.
            var hint = BoardHint.Best(board.Session.Accepted).Value;
            var other = BoardHint.Slides(board.State.Grid).FirstOrDefault(slide => slide.ToString() != hint.ToString());
            Assert.That(other.Width, Is.GreaterThan(0), "This board has another slide");
            yield return Play(other);
            Assert.That(Coach.Said, Is.EqualTo(new[] { Lessons.MovesLeft(board.Session.Rules.MaxMoves - board.State.Moves), Lessons.TapGoal }));
            yield return Play(BoardHint.Best(board.Session.Accepted).Value);
            Assert.That(Coach.Said, Is.EqualTo(new[] { Lessons.Reroll }));
            Assert.That(Lessons.Device.Taught(Lesson.GuidedRun), Is.True); Assert.That(Coach.Guiding, Is.False);
            yield return Play(BoardHint.Best(board.Session.Accepted).Value);
            Assert.That(Coach.Said.Intersect(new[] { Lessons.Slide, Lessons.Clears, Lessons.Falls, Lessons.Rises, Lessons.TapGoal, Lessons.Reroll }), Is.Empty,
                "The guide has let go");
        }

        [UnityTest] public IEnumerator SkippingTipsTeachesEveryBoardLessonAndTheRunPlaysOn()
        {
            Lessons.Device = AllBut(Lesson.GuidedRun, Lesson.Wave, Lesson.Star, Lesson.EmptyBoard);
            yield return OpenTikiOne();
            yield return Wait(() => Coach.Said.Count > 0, "The guardian speaks");
            Click(app, Lessons.Skip); yield return null;
            Assert.That(Coach.Said, Is.Empty); Assert.That(Coach.Pointing.HasValue, Is.False); Assert.That(Coach.Guiding, Is.False);
            foreach (var lesson in new[] { Lesson.GuidedRun, Lesson.Wave, Lesson.Star, Lesson.EmptyBoard })
                Assert.That(Lessons.Device.Taught(lesson), Is.True, lesson.ToString());
            yield return Play(BoardHint.Best(board.Session.Accepted).Value);
            Assert.That(Coach.Said, Is.Empty, "Nothing more is taught on the board");
        }

        [UnityTest] public IEnumerator ReducedMotionHoldsTheHandStillAndMotionSlidesIt()
        {
            foreach (bool still in new[] { true, false })
            {
                Lessons.Device = AllBut(Lesson.GuidedRun);
                typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, still);
                yield return OpenTikiOne();
                yield return Wait(() => Coach.Pointing.HasValue, "The guardian points");
                var hand = app.GetComponentsInChildren<Image>().Single(image => image.name == "Guardian hand").rectTransform;
                var first = SkinUi.ScreenRect(hand).center;
                yield return new WaitForSecondsRealtime(BoardCoach.HandSeconds / 2);
                var later = SkinUi.ScreenRect(hand).center;
                if (still) Assert.That(later, Is.EqualTo(first), "Reduced motion holds the hand on its block");
                else Assert.That(Vector2.Distance(later, first), Is.GreaterThan(1), "The hand slides along the row");
                yield return EndRun(); yield return Page(StorePage.Result);
                Click(app, "Map"); yield return Page(StorePage.Campaign);
                app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
            }
        }
    }
}
