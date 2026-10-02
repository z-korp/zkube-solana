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
using ZKube.Core.Generated;

namespace ZKube.Presentation.Tests
{
    public sealed class BoardCueTests
    {
        private GameObject root;
        private BoardController board;
        private BoardHarness evidence;

        [UnitySetUp] public IEnumerator SetUp()
        {
            root = new GameObject("Native accepted cue tests");
            board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardHarness>(); evidence.AutoStart = false;
            evidence.Load("realm-8-daily");
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy);
            board.SetMuted(true);
        }
        [UnityTearDown] public IEnumerator TearDown()
        { UnityEngine.Object.Destroy(root); yield return null; }
        private IEnumerator Wait(Func<bool> predicate)
        {
            float deadline = Time.realtimeSinceStartup + 20;
            while (!predicate())
            {
                if (Time.realtimeSinceStartup > deadline) Assert.Fail("Accepted cue timed out: " + "Board is still busy or loading");
                yield return null;
            }
        }
        private IEnumerator Load(string name, bool reduced)
        {
            board.SetReducedMotion(reduced); evidence.Load(name);
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy);
        }
        private TMP_Text Label(string name) => board.View.GetComponentsInChildren<TMP_Text>().SingleOrDefault(t => t.name == name);
        private static Rect Bounds(TMP_Text label)
        {
            var corners = new Vector3[4]; label.rectTransform.GetWorldCorners(corners);
            return Rect.MinMaxRect(corners[0].x, corners[0].y, corners[2].x, corners[2].y);
        }
        // The cue stays in the safe area and clear of the board's cells.
        private static void AbovePlate(BoardView view, TMP_Text label, Rect plate, string at)
        {
            var rect = Bounds(label); var frame = view.Layout.Frame;
            Assert.IsTrue(rect.xMin >= frame.xMin - .5f && rect.xMax <= frame.xMax + .5f && rect.yMin >= frame.yMin - .5f && rect.yMax <= frame.yMax + .5f,
                at + ": " + label.name + " " + rect + " stays in the safe area " + frame);
            Assert.IsFalse(rect.Overlaps(view.Layout.Board), at + ": " + label.name + " is not inside the board");
            Assert.Less(Mathf.Abs(rect.center.x - plate.center.x), plate.width, at + ": " + label.name + " rises by its plate");
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
        private IEnumerator Gone(params string[] names)
        {
            yield return Wait(() => names.All(name => Label(name) == null));
        }

        // A perfect clear by a move or a bonus shouts PERFECT once the board has
        // settled; its reroll rises from the reroll tablet, or the tablet says it
        // is full when three are held.
        [UnityTest] public IEnumerator PerfectClearsShoutAfterTheBoardSettlesAndTheRerollRisesOrTheTabletSaysFull()
        {
            foreach (bool reduced in new[] { false, true })
            foreach (var scenario in new[] {
                ("move-perfect-clear-grant", true), ("move-perfect-clear-cap", false),
                ("Hammer-perfect-clear-continuation", true), ("Hammer-perfect-clear-cap", false)
            })
            {
                string at = scenario.Item1 + (reduced ? " (reduced motion)" : "");
                yield return Load(scenario.Item1, reduced);
                Assert.IsNull(Label("Accepted perfect clear"));
                yield return InputWhileCueAppears();
                Assert.IsTrue(ZKube.Tests.Presentation.BoardTestState.Settled(board.View, board.State.Grid), at + ": the callout follows the blocks");
                Assert.AreEqual("PERFECT", Label("Accepted perfect clear").text);
                Assert.IsFalse(Label("Accepted perfect clear").raycastTarget);
                Assert.AreEqual(scenario.Item2 ? 2 : 3, board.State.RerollCharges);
                var chip = Label("Accepted reroll chip"); var full = Label("Accepted reroll cap");
                Assert.AreEqual(scenario.Item2, chip != null, at); Assert.AreEqual(!scenario.Item2, full != null, at);
                var note = chip ?? full;
                Assert.AreEqual(scenario.Item2 ? "+1" : BoardView.FullNote, note.text);
                Assert.IsFalse(note.raycastTarget);
                var tablet = board.View.Layout.RerollButton;
                Assert.GreaterOrEqual(Bounds(note).yMin, tablet.yMax - 1, at + ": the note stands over the reroll tablet");
                Assert.Less(Mathf.Abs(Bounds(note).center.x - tablet.center.x), tablet.width / 2, at);
                var start = note.rectTransform.anchoredPosition;
                yield return new WaitForSecondsRealtime(.35f);
                Assert.AreEqual(reduced, Vector2.Distance(start, note.rectTransform.anchoredPosition) < .01f, at + ": only normal motion rises");
                Assert.IsFalse(root.GetComponentsInChildren<AudioSource>().Any(s => s.isPlaying), "Mute applies to accepted effects");
                yield return Wait(() => !board.Busy);
                yield return Gone("Accepted perfect clear", "Accepted reroll chip", "Accepted reroll cap");
            }
        }

        // "+N" rises from just above the score plate, and the objective's gain
        // beside its plate: neither is inside the board. Reduced motion shows them
        // in place.
        [UnityTest] public IEnumerator GainsRiseByTheirPlatesNotInsideTheBoard()
        {
            foreach (bool reduced in new[] { false, true })
            {
                string at = reduced ? "reduced motion" : "motion";
                yield return Load("Hammer-perfect-clear-continuation", reduced);
                var input = evidence.PlayNextInput();
                while (input.MoveNext())
                {
                    yield return input.Current;
                    if (Label("Accepted score chip") != null) break;
                }
                var gold = Label("Accepted score chip"); var cyan = Label("Accepted theme chip");
                Assert.IsNotNull(gold); Assert.IsNotNull(cyan);
                Assert.IsTrue(ZKube.Tests.Presentation.BoardTestState.Settled(board.View, board.State.Grid), at + ": the gains follow the blocks");
                Assert.AreEqual("+1", gold.text); Assert.AreEqual("+1", cyan.text);
                Assert.IsFalse(gold.raycastTarget); Assert.IsFalse(cyan.raycastTarget);
                var hud = board.View.Hud; var scorePlate = hud.Campaign ? hud.Plates[0] : hud.Crown;
                AbovePlate(board.View, gold, scorePlate, at); AbovePlate(board.View, cyan, hud.Plates[1], at);
                Assert.GreaterOrEqual(Bounds(gold).yMin, scorePlate.yMax - 1, at + ": the score's gain starts just above its plate");
                Assert.LessOrEqual(Bounds(cyan).xMax, hud.Plates[1].xMin + 1, at + ": the objective's gain rises beside its plate");
                var left = gold.rectTransform.anchoredPosition; var right = cyan.rectTransform.anchoredPosition;
                yield return new WaitForSecondsRealtime(.4f);
                Assert.AreEqual(reduced, Vector2.Distance(left, gold.rectTransform.anchoredPosition) < .01f);
                Assert.AreEqual(reduced, Vector2.Distance(right, cyan.rectTransform.anchoredPosition) < .01f);
                if (!reduced) Assert.Greater(gold.rectTransform.anchoredPosition.y, left.y, "The gain rises");
                while (gold != null || cyan != null)
                {
                    if (gold != null) AbovePlate(board.View, gold, scorePlate, at);
                    if (cyan != null) AbovePlate(board.View, cyan, hud.Plates[1], at);
                    yield return null;
                }
                yield return Wait(() => !board.Busy);
                yield return Gone("Accepted perfect clear", "Accepted reroll chip", "Accepted reroll cap");
            }
        }

        // "COMBO ×N" is this move's lines, as the core's trace lists them, by the
        // old client's rule: two or more lines shout their count and one line
        // shouts nothing, through whole native trajectories.
        [UnityTest] public IEnumerator ComboIsThisMovesLinesAndOneLineShowsNone()
        {
            Assert.IsNull(BoardView.ComboText(0)); Assert.IsNull(BoardView.ComboText(1));
            Assert.AreEqual("COMBO ×2", BoardView.ComboText(2)); Assert.AreEqual("COMBO ×7", BoardView.ComboText(7));
            int single = 0, several = 0;
            foreach (string fixture in new[] { "balam-combo-2", "daily-pressure-crossing", "move-perfect-clear-grant", "Wave-perfect-clear-continuation",
                "blocked-eleventh-row", "move-budget-exhaustion", "balam-earned-totem" })
            {
                yield return Load(fixture, true); yield return null;
                int index = 0;
                foreach (var step in evidence.Current.steps.Where(step => step.operation != NativeOperation.ApplyVrf))
                {
                    var state = board.State; var token = board.Session.Accepted;
                    if (state.Phase != (byte)CorePhase.Playing || step.operation == NativeOperation.Finish) break;
                    if (step.operation == NativeOperation.PlayMove && board.View.DisplayGrid[step.row * 8 + step.start] == 0) break;
                    int lines = step.operation == NativeOperation.RequestReroll ? 0 : PresentationTrace.LinesCleared((step.operation == NativeOperation.PlayMove
                        ? NativeEngine.PlayMove(token, state.ActionCounter, state.Moves, step.row, step.start, step.destination)
                        : NativeEngine.ApplyBonus(token, state.ActionCounter, step.row, step.column)).Events);
                    string at = fixture + " action " + index++ + " (" + lines + " lines)";
                    yield return evidence.PlayNextInput(); yield return Wait(() => !board.Busy);
                    if (board.State.ActionCounter == state.ActionCounter) break;
                    var combo = Label("Accepted combo");
                    if (lines < 2) { Assert.IsNull(combo, at + ": no combo is shouted"); if (lines == 1) single++; }
                    else { Assert.IsNotNull(combo, at); Assert.AreEqual("COMBO ×" + lines, combo.text, at); several++; }
                    yield return Gone("Accepted combo", "Accepted perfect clear", "Accepted score chip", "Accepted theme chip", "Accepted reroll chip", "Accepted reroll cap");
                }
            }
            Assert.Greater(single, 0, "A trajectory clears one line"); Assert.Greater(several, 0, "A trajectory clears several lines");
        }

        // The callouts: big, in the display face, centred over the board, PERFECT
        // above the combo. They punch in past their size, hold, and leave; reduced
        // motion fades them in and out without scale or movement. On the compact
        // phone, the emulator's default and the Seeker, at both text sizes.
        [UnityTest] public IEnumerator CalloutsAreBigAnimatedAndCentredOnEveryPhone()
        {
            yield return Load("realm-8-daily", false);
            var art = (BoardArt)typeof(BoardController).GetField("art", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).GetValue(board);
            board.View.gameObject.SetActive(false);
            var phones = new[] { ("compact", ZKube.Tests.Presentation.Phones.CompactScreen, ZKube.Tests.Presentation.Phones.CompactTopInsetDp, 0f),
                ("emulator", ZKube.Tests.Presentation.Phones.EmulatorScreen, ZKube.Tests.Presentation.Phones.EmulatorTopInsetDp, ZKube.Tests.Presentation.Phones.EmulatorBottomInsetDp),
                ("seeker", ZKube.Tests.Presentation.Phones.SeekerScreen, ZKube.Tests.Presentation.Phones.SeekerTopInsetDp, 0f) };
            foreach (var (phone, screen, top, bottom) in phones)
                foreach (float text in new[] { 1f, 1.3f })
                    foreach (bool reduced in new[] { false, true })
                    {
                        string at = phone + " at " + text + (reduced ? " (reduced motion)" : "");
                        var ui = new SkinUi(art, 1, text);
                        var plan = HudLayout.Build(ui, board.State, board.Session, new Rect(0, bottom, screen.width, screen.height - top - bottom), 1, screen);
                        var child = new GameObject("Callout measurement"); child.transform.SetParent(root.transform);
                        var view = child.AddComponent<BoardView>(); view.Create(board, art, plan, ui);
                        view.SetBoard(board.State.Grid); view.Summary(board.State, board.Session, false);
                        view.ShowGains(12, 3, 4, reduced, true, true);
                        var perfect = view.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Accepted perfect clear");
                        var combo = view.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Accepted combo");
                        Assert.AreEqual("PERFECT", perfect.text); Assert.AreEqual("COMBO ×4", combo.text);
                        var boardRect = view.Layout.Board; float peak = 0, shown = 0;
                        var places = new[] { perfect.rectTransform.anchoredPosition, combo.rectTransform.anchoredPosition };
                        bool captured = false;
                        for (float began = Time.realtimeSinceStartup; perfect != null || combo != null;)
                        {
                            Assert.Less(Time.realtimeSinceStartup - began, BoardView.PerfectSeconds + BoardView.PerfectDelay + 1, at + ": the callouts leave");
                            foreach (var cue in new[] { perfect, combo }.Where(t => t != null))
                            {
                                StringAssert.Contains("LilitaOne", cue.font.name, at + ": the display face");
                                Assert.GreaterOrEqual(cue.fontSize, 30 * text * Mathf.Min(1, boardRect.width / 320), at + ": " + cue.name + " is big");
                                Assert.AreEqual(boardRect.center.x, cue.rectTransform.position.x, 1, at + ": centred over the board");
                                Assert.IsTrue(cue.rectTransform.position.y > boardRect.yMin && cue.rectTransform.position.y < boardRect.yMax, at + ": over the board");
                                cue.ForceMeshUpdate();
                                Assert.LessOrEqual(cue.GetPreferredValues(cue.text, float.PositiveInfinity, float.PositiveInfinity).x * 1.4f, boardRect.width, at + ": " + cue.name + " fits the board at its largest");
                                Assert.IsFalse(cue.raycastTarget);
                                if (reduced)
                                {
                                    Assert.AreEqual(Vector3.one, cue.rectTransform.localScale, at + ": no scale");
                                    Assert.AreEqual(Quaternion.identity, cue.rectTransform.localRotation, at + ": no turn");
                                    Assert.AreEqual(places[cue == perfect ? 0 : 1], cue.rectTransform.anchoredPosition, at + ": no movement");
                                }
                            }
                            if (perfect != null && combo != null) Assert.Greater(perfect.rectTransform.position.y, combo.rectTransform.position.y, at + ": PERFECT stands over the combo");
                            if (combo != null) { peak = Mathf.Max(peak, combo.rectTransform.localScale.x); shown = Mathf.Max(shown, combo.alpha); }
                            if (!captured && text == 1 && Time.realtimeSinceStartup - began > .6f)
                            {
                                captured = true;
                                yield return ZKube.Tests.Presentation.Captures.Snap(screen, "callouts-" + phone + (reduced ? "-reduced" : ""));
                            }
                            yield return null;
                        }
                        Assert.AreEqual(1, shown, .05f, at + ": the callout shows fully");
                        if (!reduced) Assert.Greater(peak, 1.25f, at + ": the callout punches in past its size");
                        UnityEngine.Object.Destroy(child); yield return null;
                    }
            board.View.gameObject.SetActive(true);
        }

        // Presentation field-boundary test: the largest amounts still rise by
        // their plates in the safe area, whole, on a 360 x 640 phone at larger text.
        [UnityTest] public IEnumerator LongGainsAt360WithLargerTextStayWholeInTheSafeArea()
        {
            yield return Load("realm-8-daily", false);
            var art = (BoardArt)typeof(BoardController).GetField("art", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).GetValue(board);
            var ui = new SkinUi(art, 1, 1.3f); var plan = HudLayout.Build(ui, board.State, board.Session, new Rect(0, 0, 360, 572), 1, new Rect(0, 0, 360, 640));
            var child = new GameObject("Narrow cue measurement"); child.transform.SetParent(root.transform);
            var view = child.AddComponent<BoardView>(); view.Create(board, art, plan, ui);
            view.Summary(board.State, board.Session, false);
            foreach (bool reduced in new[] { false, true })
            {
                view.ShowGains(uint.MaxValue, ulong.MaxValue, 0, reduced);
                var cues = view.GetComponentsInChildren<TMP_Text>().Where(t => t.name == "Accepted score chip" || t.name == "Accepted theme chip").ToArray();
                Assert.AreEqual(2, cues.Length);
                while (cues.Any(t => t != null))
                {
                    foreach (var cue in cues.Where(t => t != null))
                    {
                        var rect = Bounds(cue); var frame = view.Layout.Frame;
                        Assert.IsTrue(rect.xMin >= frame.xMin - .5f && rect.xMax <= frame.xMax + .5f && rect.yMax <= frame.yMax + .5f, cue.name + " " + rect + " stays in the safe area");
                        Assert.IsFalse(rect.Overlaps(view.Layout.Board), cue.name + " is not inside the board");
                        Assert.IsFalse(cue.enableAutoSizing); Assert.IsFalse(cue.isTextTruncated);
                        Assert.LessOrEqual(cue.GetPreferredValues(cue.text, float.PositiveInfinity, float.PositiveInfinity).x, rect.width + .5f, cue.name + " is whole");
                    }
                    yield return null;
                }
            }
            UnityEngine.Object.Destroy(child);
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
            int notifications = 0; board.Host.Accepted += _ => notifications++;
            var first = (Task)present.Invoke(board, new object[] { (BoardActionResult)accepted });
            yield return Wait(() => first.IsCompleted);
            Assert.IsFalse(first.IsFaulted, first.Exception?.ToString());
            Assert.IsNotNull(Label("Accepted perfect clear"));
            yield return new WaitForSecondsRealtime(BoardView.PerfectSeconds + BoardView.PerfectDelay + .3f);
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
            board.Bind(new BoardSession(initial, rules, pending, board.Session.RealmId));
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
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
