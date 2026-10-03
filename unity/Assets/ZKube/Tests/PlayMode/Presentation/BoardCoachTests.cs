using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Tests
{
    // The board's moments on real Campaign runs (build/tutorial/design.txt 2.2):
    // each taught the first time it happens, never on a Daily. BoardHarness
    // draws a Campaign level's rows from its name, so the run that playing the
    // guardian's best slide each move makes is found natively, then played on
    // the board by drag.
    public sealed class BoardCoachTests
    {
        private GameObject root;
        private BoardController board;
        private BoardHarness evidence;
        private BoardCoach coach;

        [UnitySetUp] public IEnumerator SetUp()
        {
            Lessons.Device = Lessons.Memory();
            root = new GameObject("Board coach tests");
            board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardHarness>(); evidence.AutoStart = false;
            coach = root.AddComponent<BoardCoach>(); coach.Initialize(board);
            board.SetMuted(true); board.SetReducedMotion(true);
            yield return null;
        }
        [UnityTearDown] public IEnumerator TearDown()
        { UnityEngine.Object.Destroy(root); yield return null; Lessons.Device = Lessons.Memory(taught: true); }
        private IEnumerator Wait(Func<bool> predicate, string reason)
        {
            float deadline = Time.realtimeSinceStartup + 20;
            while (!predicate()) { if (Time.realtimeSinceStartup > deadline) Assert.Fail(reason); yield return null; }
        }

        // The harness's rows for a Campaign level: a hash of its name and the counter.
        private static CoreRunToken Rows(CoreRunToken token, string seed)
        {
            while (NativeEngine.Summary(token).Phase == (byte)CorePhase.AwaitingVrf)
            {
                var state = NativeEngine.Summary(token);
                using (var hash = SHA256.Create())
                    token = NativeEngine.ApplyVrf(token, state.LastVrfCounter + 1, hash.ComputeHash(Encoding.UTF8.GetBytes(seed + ":" + state.LastVrfCounter))).Token;
            }
            return token;
        }
        // The first Campaign level whose best-slide run brings happens, with its slides.
        private static (byte realm, byte level, List<BoardHint.Slide> slides) Find(Func<RunSummary, RunSummary, bool> happens)
        {
            for (byte realm = 1; realm <= Protocol.Realms.Length; realm++)
                for (byte level = 1; level <= 3; level++)
                {
                    string seed = "campaign-" + realm + "-" + level;
                    var token = Rows(NativeEngine.Initialize(NativeEngine.CampaignRules(realm, level)), seed);
                    var slides = new List<BoardHint.Slide>();
                    for (int move = 0; move < 30; move++)
                    {
                        var before = NativeEngine.Summary(token); var best = BoardHint.Best(token);
                        if (before.Phase != (byte)CorePhase.Playing || best == null) break;
                        token = Rows(NativeEngine.PlayMove(token, before.ActionCounter, before.Moves, best.Value.Row, best.Value.Start, best.Value.Destination).Token, seed);
                        slides.Add(best.Value);
                        if (happens(before, NativeEngine.Summary(token))) return (realm, level, slides);
                    }
                }
            Assert.Fail("No Campaign level's best-slide run brings this moment");
            return default;
        }
        private IEnumerator Play(byte realm, byte level, List<BoardHint.Slide> slides)
        {
            evidence.LoadCampaign(realm, level);
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy, "The board did not settle");
            Assert.That(board.Session.Daily, Is.False, "A Campaign run");
            coach.Begin(firstRun: false); yield return null;
            foreach (var slide in slides)
            {
                var layout = board.View.Layout; float cell = layout.Cell; uint before = board.State.ActionCounter;
                var from = new Vector2(layout.Board.x + (slide.Start + slide.Width / 2f) * cell, layout.Board.y + (slide.Row + .5f) * cell);
                yield return evidence.Drag(from, from + new Vector2((slide.Destination - slide.Start) * cell, 0));
                yield return Wait(() => board.State.ActionCounter == before + 1 && !board.Busy && ZKube.Tests.Presentation.BoardTestState.Idle(board),
                    "The slide was accepted: " + slide);
                yield return null; yield return null;
            }
        }

        [UnityTest] public IEnumerator AFirstChargeIsTaughtOnceInItsBonusesWords()
        {
            var run = Find((before, after) => before.ChargesEarned == 0 && after.ChargesEarned > 0);
            Lessons.Device.Teach(Lesson.Star);
            yield return Play(run.realm, run.level, run.slides);
            byte bonus = board.State.BonusType;
            Assert.That(coach.Said, Does.Contain(Lessons.Charge(bonus)), "Realm " + run.realm + " level " + run.level);
            Assert.That(Lessons.Device.Taught(Lessons.ChargeLesson(bonus)), Is.True);
            Assert.That(root.GetComponentsInChildren<UnityEngine.UI.Image>().Any(image => image.name == "Lesson card" && image.sprite.name.StartsWith(Lessons.ChargeCard(bonus))),
                Is.True, "The bubble shows the bonus's card");
            yield return ZKube.Tests.Presentation.Captures.Snap(new Rect(0, 0, Screen.width, Screen.height), "board first charge");
            // Taught once: the same run again says nothing of it.
            yield return Play(run.realm, run.level, run.slides);
            Assert.That(coach.Said, Does.Not.Contain(Lessons.Charge(bonus)));
        }

        [UnityTest] public IEnumerator TheFirstStarIsTaughtOnce()
        {
            var run = Find((before, after) => before.LatchedStarSources == 0 && after.LatchedStarSources != 0 && after.ChargesEarned == before.ChargesEarned);
            yield return Play(run.realm, run.level, run.slides);
            Assert.That(coach.Said, Does.Contain(Lessons.Star)); Assert.That(Lessons.Device.Taught(Lesson.Star), Is.True);
            yield return ZKube.Tests.Presentation.Captures.Snap(new Rect(0, 0, Screen.width, Screen.height), "board first star");
            yield return Play(run.realm, run.level, run.slides);
            Assert.That(coach.Said, Does.Not.Contain(Lessons.Star));
        }

        [UnityTest] public IEnumerator NoLessonAppearsOnADailyRun()
        {
            evidence.Load("realm-8-daily");
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy, "The board did not settle");
            Assert.That(board.Session.Daily, Is.True);
            coach.Begin(firstRun: true); yield return null;
            Assert.That(coach.Guiding, Is.False);
            for (int i = 0; i < 4; i++)
            {
                var input = evidence.PlayNextInput(); while (input.MoveNext()) yield return input.Current;
                yield return Wait(() => !board.Busy, "The input did not settle"); yield return null;
                Assert.That(coach.Said, Is.Empty);
            }
            Assert.That(Enum.GetValues(typeof(Lesson)).Cast<Lesson>().Any(Lessons.Device.Taught), Is.False, "A Daily teaches nothing");
        }
    }
}
