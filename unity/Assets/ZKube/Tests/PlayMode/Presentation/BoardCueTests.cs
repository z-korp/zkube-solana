using System;
using System.Collections;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Core;
using ZKube.Presentation.Evidence;

namespace ZKube.Presentation.Tests
{
    public sealed class BoardCueTests
    {
        private GameObject root;
        private BoardController board;
        private BoardEvidenceHarness evidence;

        [UnitySetUp] public IEnumerator SetUp()
        {
            root = new GameObject("Native accepted cue tests");
            board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardEvidenceHarness>(); evidence.AutoStart = false;
            evidence.Load("realm-8-daily");
            yield return Wait(() => board.Ready && !board.Busy);
            board.SetMuted(true);
        }
        [UnityTearDown] public IEnumerator TearDown()
        { UnityEngine.Object.Destroy(root); yield return null; }
        private IEnumerator Wait(Func<bool> predicate)
        {
            float deadline = Time.realtimeSinceStartup + 20;
            while (!predicate())
            {
                if (Time.realtimeSinceStartup > deadline) Assert.Fail("Accepted cue timed out: " + board.ReadinessIssue);
                yield return null;
            }
        }
        private IEnumerator Load(string name, bool reduced)
        {
            board.SetReducedMotion(reduced); evidence.Load(name);
            yield return Wait(() => board.Ready && !board.Busy);
        }
        private TMP_Text Label(string name) => board.View.GetComponentsInChildren<TMP_Text>().SingleOrDefault(t => t.name == name);
        private static Rect Bounds(TMP_Text label)
        {
            var corners = new Vector3[4]; label.rectTransform.GetWorldCorners(corners);
            return Rect.MinMaxRect(corners[0].x, corners[0].y, corners[2].x, corners[2].y);
        }
        private static void InsideBoard(BoardView view, TMP_Text label)
        {
            var rect = Bounds(label);
            Assert.GreaterOrEqual(rect.xMin, view.Layout.Board.xMin);
            Assert.LessOrEqual(rect.xMax, view.Layout.Board.xMax);
            Assert.GreaterOrEqual(rect.yMin, view.Layout.Board.yMin);
            Assert.LessOrEqual(rect.yMax, view.Layout.Board.yMax);
            foreach (var name in new[] { "Score", "Theme", "Guardian action label", "Reroll action label" })
            {
                var readout = view.GetComponentsInChildren<TMP_Text>().Single(t => t.name == name);
                Assert.IsFalse(rect.Overlaps(Bounds(readout)), label.name + " covers " + name);
            }
            Assert.IsFalse(rect.Overlaps(view.Layout.GuardianButton));
            Assert.IsFalse(rect.Overlaps(view.Layout.RerollButton));
            Assert.IsFalse(rect.Overlaps(view.Layout.PauseButton));
        }
        private IEnumerator InputWhileCueAppears()
        {
            var input = evidence.PlayNextInput();
            while (input.MoveNext())
            {
                yield return input.Current;
                if (Label("Accepted perfect clear") != null) yield break;
            }
            Assert.Fail("Native perfect-clear action did not expose its cue");
        }

        [UnityTest] public IEnumerator MoveAndBonusPerfectClearsKeepCapDiscardDistinctFromEarnedReroll()
        {
            foreach (bool reduced in new[] { false, true })
            foreach (var scenario in new[] {
                ("move-perfect-clear-grant", true), ("move-perfect-clear-cap", false),
                ("Hammer-perfect-clear-continuation", true), ("Hammer-perfect-clear-cap", false)
            })
            {
                yield return Load(scenario.Item1, reduced);
                Assert.IsNull(Label("Accepted perfect clear"));
                yield return InputWhileCueAppears();
                Assert.AreEqual("PERFECT CLEAR", Label("Accepted perfect clear").text);
                Assert.IsFalse(Label("Accepted perfect clear").raycastTarget);
                Assert.AreEqual(scenario.Item2 ? 2 : 3, board.State.RerollCharges);
                var chip = Label("Accepted reroll chip");
                Assert.AreEqual(scenario.Item2, chip != null);
                Assert.AreEqual(!scenario.Item2, Label("Accepted reroll cap") != null);
                if (chip != null)
                {
                    Assert.AreEqual("+1 REROLL", chip.text); Assert.IsFalse(chip.raycastTarget);
                    InsideBoard(board.View, chip);
                    var start = chip.rectTransform.anchoredPosition;
                    yield return new WaitForSecondsRealtime(.35f);
                    Assert.AreEqual(reduced, Vector2.Distance(start, chip.rectTransform.anchoredPosition) < .01f,
                        "Only normal motion travels toward the accepted reroll inventory");
                    while (chip != null) { InsideBoard(board.View, chip); yield return null; }
                }
                Assert.IsFalse(root.GetComponentsInChildren<AudioSource>().Any(s => s.isPlaying), "Mute applies to accepted effects");
                yield return Wait(() => !board.Busy);
                yield return new WaitForSecondsRealtime(1.2f);
                Assert.IsNull(Label("Accepted perfect clear"));
                Assert.IsNull(Label("Accepted reroll chip"));
            }
        }

        [UnityTest] public IEnumerator GoldAndCyanEarnedChipsTravelToSeparateNativeReadouts()
        {
            foreach (bool reduced in new[] { false, true })
            {
                yield return Load("Hammer-perfect-clear-continuation", reduced);
                var input = evidence.PlayNextInput();
                while (input.MoveNext())
                {
                    yield return input.Current;
                    if (Label("Accepted score chip") != null) break;
                }
                var gold = Label("Accepted score chip"); var cyan = Label("Accepted theme chip");
                Assert.IsNotNull(gold); Assert.IsNotNull(cyan);
                Assert.AreEqual("+1", gold.text); Assert.AreEqual("+1 THEME", cyan.text);
                Assert.IsFalse(gold.raycastTarget); Assert.IsFalse(cyan.raycastTarget);
                InsideBoard(board.View, gold); InsideBoard(board.View, cyan);
                var left = gold.rectTransform.anchoredPosition; var right = cyan.rectTransform.anchoredPosition;
                yield return new WaitForSecondsRealtime(.4f);
                Assert.AreEqual(reduced, Vector2.Distance(left, gold.rectTransform.anchoredPosition) < .01f);
                Assert.AreEqual(reduced, Vector2.Distance(right, cyan.rectTransform.anchoredPosition) < .01f);
                Assert.Less(gold.rectTransform.anchoredPosition.x, cyan.rectTransform.anchoredPosition.x);
                while (gold != null || cyan != null)
                {
                    if (gold != null) InsideBoard(board.View, gold);
                    if (cyan != null) InsideBoard(board.View, cyan);
                    yield return null;
                }
                yield return Wait(() => !board.Busy);
            }
        }

        [UnityTest] public IEnumerator LongGainsAt320WithLargerTextHaveMeasuredNonoverlappingBoardBounds()
        {
            yield return Load("realm-8-daily", false);
            var art = (BoardArt)typeof(BoardController).GetField("art", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).GetValue(board);
            var plan = BoardTypography.Build(art, board.State, board.Session, new Rect(0, 0, 320, 568), 1, 1.3f);
            var child = new GameObject("Narrow cue measurement"); child.transform.SetParent(root.transform);
            var view = child.AddComponent<BoardView>(); view.Create(board, art, plan.Layout, plan);
            view.Summary(board.State, board.Session, false);
            foreach (bool reduced in new[] { false, true })
            {
                // Presentation field-boundary test, without altering a native
                // accepted token or claiming these amounts form a reachable run.
                view.ShowGains(uint.MaxValue, ulong.MaxValue, 0, reduced);
                var cues = view.GetComponentsInChildren<TMP_Text>().Where(t => t.name == "Accepted score chip" || t.name == "Accepted theme chip").ToArray();
                Assert.AreEqual(2, cues.Length);
                Assert.IsFalse(Bounds(cues[0]).Overlaps(Bounds(cues[1])));
                foreach (var cue in cues)
                {
                    cue.ForceMeshUpdate(); InsideBoard(view, cue);
                    Assert.IsFalse(cue.enableAutoSizing); Assert.IsFalse(cue.isTextTruncated);
                    Assert.LessOrEqual(cue.GetPreferredValues(cue.text, cue.rectTransform.rect.width, float.PositiveInfinity).y,
                        cue.rectTransform.rect.height);
                    foreach (var character in cue.textInfo.characterInfo.Take(cue.textInfo.characterCount).Where(c => c.isVisible))
                    {
                        var min = cue.rectTransform.TransformPoint(character.bottomLeft);
                        var max = cue.rectTransform.TransformPoint(character.topRight);
                        Assert.IsTrue(Bounds(cue).Contains((Vector2)min), "Measured allowance contains each visible glyph");
                        Assert.IsTrue(Bounds(cue).Contains((Vector2)max), "Long native-width amount must not overflow");
                    }
                }
                while (cues.Any(t => t != null))
                {
                    foreach (var cue in cues.Where(t => t != null)) InsideBoard(view, cue);
                    if (cues.All(t => t != null)) Assert.IsFalse(Bounds(cues[0]).Overlaps(Bounds(cues[1])));
                    yield return null;
                }
            }
            UnityEngine.Object.Destroy(child);
        }

        [UnityTest] public IEnumerator SimultaneousGainsComboAndNativePerfectClearUseSeparateMeasuredRowsAt320()
        {
            yield return Load("realm-8-daily", false);
            var art = (BoardArt)typeof(BoardController).GetField("art", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).GetValue(board);
            var plan = BoardTypography.Build(art, board.State, board.Session, new Rect(0, 0, 320, 568), 1, 1.3f);
            var source = BoardEvidenceHarness.Fixtures.Single(f => f.name == "Hammer-perfect-clear-continuation");
            var token = new CoreRunToken(BoardEvidenceHarness.Hex(source.configHex), BoardEvidenceHarness.Hex(source.initialStateHex));
            var fact = NativeEngine.ApplyBonus(token, NativeEngine.Summary(token).ActionCounter, 1, 0).Events
                .Single(e => e.Kind == ZKube.Core.Generated.PresentationKind.PerfectClear);
            foreach (bool reduced in new[] { false, true })
            {
                var child = new GameObject("Simultaneous cue measurement"); child.transform.SetParent(root.transform);
                var view = child.AddComponent<BoardView>(); view.Create(board, art, plan.Layout, plan);
                view.Summary(board.State, board.Session, false);
                // Component layout combination: a real native perfect-clear
                // fact plus nonzero gain/combination display inputs. This does
                // not claim this combined input is a reachable run trajectory.
                view.ShowGains(1, 1, 2, reduced);
                var trace = view.Trace(new[] { fact }, reduced, _ => Assert.Fail("No added audio"));
                while (trace.MoveNext()) yield return trace.Current;
                var names = new[] { "Accepted score chip", "Accepted theme chip", "Accepted combo", "Accepted perfect clear", "Accepted reroll chip" };
                var cues = view.GetComponentsInChildren<TMP_Text>().Where(t => names.Contains(t.name)).ToArray();
                Assert.AreEqual(5, cues.Length);
                do
                {
                    var visible = cues.Where(t => t != null).ToArray();
                    foreach (var cue in visible)
                    {
                        InsideBoard(view, cue); cue.ForceMeshUpdate();
                        Assert.IsFalse(cue.isTextTruncated); Assert.IsFalse(cue.enableAutoSizing);
                        Assert.LessOrEqual(cue.GetPreferredValues(cue.text, cue.rectTransform.rect.width, float.PositiveInfinity).y,
                            cue.rectTransform.rect.height);
                    }
                    for (int i = 0; i < visible.Length; i++) for (int j = i + 1; j < visible.Length; j++)
                        Assert.IsFalse(Bounds(visible[i]).Overlaps(Bounds(visible[j])), visible[i].name + " covers " + visible[j].name);
                    yield return null;
                } while (cues.Any(t => t != null));
                UnityEngine.Object.Destroy(child); yield return null;
            }
        }

        private sealed class Pending : IBoardActionProvider
        {
            public readonly TaskCompletionSource<BoardActionResult> Completion = new TaskCompletionSource<BoardActionResult>();
            public Task<BoardActionResult> Submit(CoreRunToken accepted, BoardAction action, CancellationToken cancellation) => Completion.Task;
            public Task<BoardActionResult> ResolveVrf(CoreRunToken accepted, CancellationToken cancellation) => throw new InvalidOperationException("No VRF after rejected action");
        }
        [UnityTest] public IEnumerator RepeatedAcceptedTraceDoesNotCelebrateTheSameClearTwice()
        {
            yield return Load("Hammer-perfect-clear-continuation", true);
            var accepted = NativeEngine.ApplyBonus(board.Session.Accepted, board.State.ActionCounter, 1, 0);
            var present = typeof(BoardController).GetMethod("PresentAccepted", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            int notifications = 0; board.Accepted += _ => notifications++;
            var first = (Task)present.Invoke(board, new object[] { (BoardActionResult)accepted });
            yield return Wait(() => first.IsCompleted);
            Assert.IsFalse(first.IsFaulted, first.Exception?.ToString());
            Assert.IsNotNull(Label("Accepted perfect clear"));
            yield return new WaitForSecondsRealtime(1.2f);
            var duplicate = (Task)present.Invoke(board, new object[] { (BoardActionResult)accepted });
            yield return Wait(() => duplicate.IsCompleted);
            Assert.IsFalse(duplicate.IsFaulted, duplicate.Exception?.ToString());
            Assert.AreEqual(1, notifications);
            Assert.IsNull(Label("Accepted perfect clear")); Assert.IsNull(Label("Accepted reroll chip"));
        }
        [UnityTest] public IEnumerator PendingRejectedAndRecoveredSnapshotsNeverInventPerfectClearFeedback()
        {
            yield return Load("Hammer-perfect-clear-continuation", true);
            var initial = board.Session.Accepted; var rules = board.Session.Rules;
            var pending = new Pending();
            board.Bind(new BoardSession(initial, rules, pending, "Daily", board.Session.RealmId));
            yield return Wait(() => board.Ready);
            evidence.Click("Guardian action"); evidence.Tap(board.View.Layout.CellCenter(1, 0));
            yield return null;
            Assert.IsTrue(board.Busy); Assert.IsNull(Label("Accepted perfect clear"));
            Assert.IsNull(Label("Accepted reroll chip")); Assert.AreEqual(1, board.State.RerollCharges);
            pending.Completion.SetException(new InvalidOperationException("Offline rejected input"));
            yield return Wait(() => !board.Busy);
            Assert.IsNull(Label("Accepted perfect clear")); Assert.IsNull(Label("Accepted score chip"));
            CollectionAssert.AreEqual(initial.State, board.Session.Accepted.State);

            // A recovered token can include a past perfect clear, but it does
            // not prove an ordered action trace for this view to celebrate.
            var accepted = NativeEngine.ApplyBonus(initial, board.State.ActionCounter, 1, 0).Token;
            var present = typeof(BoardController).GetMethod("PresentAccepted", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            var task = (Task)present.Invoke(board, new object[] { BoardActionResult.Snapshot(accepted) });
            yield return Wait(() => task.IsCompleted);
            Assert.IsFalse(task.IsFaulted, task.Exception?.ToString());
            Assert.AreEqual(2, board.State.RerollCharges);
            Assert.IsNull(Label("Accepted perfect clear")); Assert.IsNull(Label("Accepted reroll chip"));
        }
    }
}
