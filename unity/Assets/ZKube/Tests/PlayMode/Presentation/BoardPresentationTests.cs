using System;
using System.Collections;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.TestTools;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Tests
{
    public sealed class BoardPresentationTests
    {
        private GameObject root;
        private BoardController board;
        private BoardHarness evidence;

        [UnitySetUp] public IEnumerator SetUp()
        {
            root = new GameObject("Presentation test board"); board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardHarness>(); evidence.AutoStart = false;
            evidence.Load("realm-8-daily");
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy);
            board.SetMuted(true); board.SetReducedMotion(true);
        }
        [UnityTearDown] public IEnumerator TearDown()
        { UnityEngine.Object.Destroy(root); yield return null; }
        private IEnumerator Wait(Func<bool> condition)
        {
            float deadline = Time.realtimeSinceStartup + 20;
            while (!condition())
            {
                if (Time.realtimeSinceStartup > deadline) Assert.Fail("Timed out waiting for native board readiness: " + "Board is still busy or loading");
                yield return null;
            }
        }
        private IEnumerator Load(string name)
        {
            evidence.Load(name); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy);
            CollectionAssert.AreEqual(NativeEngine.Summary(board.Session.Accepted).Grid, board.View.DisplayGrid);
        }
        [UnityTest] public IEnumerator ReadinessRequiresBoundStateAndAValidRenderedView()
        {
            var empty = new GameObject("Unbound board"); var unbound = empty.AddComponent<BoardController>();
            yield return null;
            Assert.IsFalse(ZKube.Tests.Presentation.BoardTestState.Idle(unbound), "An unbound board selects no implicit realm");
            Assert.IsFalse(unbound.PresentationInitialized); Assert.That(unbound.Session, Is.Null);
            UnityEngine.Object.Destroy(empty); yield return null;
            yield return Load("realm-8-daily");
            Assert.IsTrue(ZKube.Tests.Presentation.BoardTestState.Idle(board));
            board.RefreshLayout(); yield return null; yield return null;
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            UnityEngine.Object.Destroy(board.View.gameObject); yield return null;
            Assert.IsFalse(ZKube.Tests.Presentation.BoardTestState.Idle(board), "A stale controller flag cannot outlive its view");
        }

        [UnityTest] public IEnumerator EmptyGuardianCannotBeSpentAndRerollHasAnAcceptanceBoundary()
        {
            yield return Load("realm-8-daily");
            Assert.AreEqual(0, board.State.BonusCharges); Assert.IsFalse(board.View.GuardianEnabled);
            Assert.AreEqual(1, board.State.RerollCharges);
            uint before = board.State.ActionCounter;
            evidence.Click("Reroll action");
            Assert.IsTrue(board.Busy);
            Assert.AreEqual(before, board.State.ActionCounter, "A clicked intent has not yet been accepted");
            StringAssert.Contains("Pending", board.View.StatusText);
            Assert.IsFalse(board.View.RerollEnabled);
            yield return Wait(() => !board.Busy);
            Assert.AreEqual(before + 1, board.State.ActionCounter);
            Assert.AreEqual(0, board.State.RerollCharges);
            Assert.AreEqual(0, board.State.Moves, "Reroll is accepted independently of a move");
            Assert.AreEqual((byte)CorePhase.Playing, board.State.Phase);
        }

        [UnityTest] public IEnumerator NativeFixtureJourneyUsesRealDragAndOrderedTrace()
        {
            yield return Load("realm-8-daily");
            yield return evidence.PlayNextInput(); // universal reroll
            ushort before = board.State.Moves;
            yield return evidence.PlayNextInput(); // actual EventSystem drag
            Assert.AreEqual(before + 1, board.State.Moves);
            CollectionAssert.AreEqual(NativeEngine.Summary(board.Session.Accepted).Grid, board.View.DisplayGrid);
            Assert.IsFalse(board.Busy);
        }

        [UnityTest] public IEnumerator CampaignStarsComeFromNativeMomentAndCumulativeLatches()
        {
            foreach (var expected in new[] { ("score-latch", 1), ("shape-latch", 2), ("blow-latch", 4), ("all-star-completion", 7) })
            {
                yield return Load(expected.Item1);
                Assert.AreEqual(0, board.State.LatchedStarSources);
                yield return evidence.PlayNextInput(); // real guardian key and board tap
                Assert.AreEqual(expected.Item2, board.State.LatchedStarSources);
                CollectionAssert.AreEqual(board.State.Grid, board.View.DisplayGrid);
            }
            Assert.AreEqual((byte)CorePhase.LevelComplete, board.State.Phase);
        }

        [UnityTest] public IEnumerator BonusFamiliesUseTheirNativeRemovalMasks()
        {
            foreach (string family in new[] { "Hammer", "Totem", "Wave" })
            {
                yield return Load(family + "-perfect-clear-continuation");
                Assert.IsTrue(board.View.GuardianEnabled);
                uint action = board.State.ActionCounter;
                yield return evidence.PlayNextInput();
                Assert.AreEqual(action + 1, board.State.ActionCounter);
                Assert.AreEqual(0, board.State.BonusCharges);
                CollectionAssert.AreEqual(board.State.Grid, board.View.DisplayGrid);
            }
        }

        [UnityTest] public IEnumerator PauseControlsPreserveAcceptedState()
        {
            yield return Load("realm-8-campaign");
            byte[] before = (byte[])board.Session.Accepted.State.Clone();
            evidence.Click("Pause"); Assert.IsTrue(board.Paused);
            // A human's next tap arrives after a rendered frame. The persistent
            // shield must block the board even in the opening frame itself.
            var hit = new PointerEventData(EventSystem.current) { position = board.View.Layout.Board.center };
            var hits = new System.Collections.Generic.List<RaycastResult>(); EventSystem.current.RaycastAll(hit, hits);
            Assert.AreEqual("Modal input shield", hits[0].gameObject.name);
            yield return null;
            evidence.Click("Dialog Sound: off"); Assert.IsFalse(board.Muted);
            yield return null;
            evidence.Click("Dialog Sound: on"); Assert.IsTrue(board.Muted);
            yield return null;
            evidence.Click("Dialog Reduced motion: on"); Assert.IsFalse(board.ReducedMotion);
            yield return null;
            evidence.Click("Dialog Resume"); Assert.IsFalse(board.Paused);
            CollectionAssert.AreEqual(before, board.Session.Accepted.State);
        }

        [UnityTest] public IEnumerator ExplicitSnapshotsRebindWithoutTraceAndNotifyAcceptanceOnlyOnce()
        {
            yield return Load("realm-8-daily");
            var initial = board.Session.Accepted;
            var reroll = NativeEngine.RequestReroll(initial, board.State.ActionCounter);
            var arrived = NativeEngine.ApplyVrf(reroll.Token, board.State.LastVrfCounter + 1, Enumerable.Repeat((byte)9, 32).ToArray());
            var result = BoardActionResult.Snapshot(arrived.Token);
            int notifications = 0; board.Accepted += _ => notifications++;
            var present = typeof(BoardController).GetMethod("PresentAccepted", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            var first = (Task)present.Invoke(board, new object[] { result });
            yield return Wait(() => first.IsCompleted);
            Assert.IsFalse(first.IsFaulted, first.Exception?.ToString());
            CollectionAssert.AreEqual(arrived.Token.State, board.Session.Accepted.State);
            CollectionAssert.AreEqual(NativeEngine.Summary(arrived.Token).Grid, board.View.DisplayGrid);
            Assert.IsNull(result.Transition); Assert.AreEqual(1, notifications);
            var repeated = (Task)present.Invoke(board, new object[] { result });
            yield return Wait(() => repeated.IsCompleted);
            Assert.IsFalse(repeated.IsFaulted, repeated.Exception?.ToString());
            Assert.AreEqual(1, notifications, "An identical recovered snapshot is not a second accepted action");
        }

        private sealed class UncertainProvider : IBoardActionProvider, IBoardRecoveryProvider
        {
            public readonly TaskCompletionSource<BoardActionResult> Result = new TaskCompletionSource<BoardActionResult>();
            public int Submits, Recoveries;
            public Task<BoardActionResult> Submit(CoreRunToken accepted, BoardAction action, CancellationToken cancellation)
            { Submits++; return Task.FromException<BoardActionResult>(new TimeoutException("Synthetic uncertain submission")); }
            public Task<BoardActionResult> ResolveVrf(CoreRunToken accepted, CancellationToken cancellation)
                => Task.FromException<BoardActionResult>(new InvalidOperationException("Unexpected randomness request"));
            public Task<BoardActionResult> Recover(CancellationToken cancellation) { Recoveries++; return Result.Task; }
        }
        [UnityTest] public IEnumerator RecoveryRemainsUsableAfterReflowAndOnlyOneCheckCanRun()
        {
            yield return Load("realm-8-daily"); var original = board.Session;
            var provider = new UncertainProvider();
            board.Bind(new BoardSession(original.Accepted, original.Rules, provider, "Daily", original.RealmId));
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board)); evidence.Click("Reroll action");
            yield return Wait(() => !board.Busy); Assert.IsTrue(board.RecoveryRequired);
            board.SetTextScale(1.3f); yield return null;
            Assert.IsTrue(board.View.GetComponentsInChildren<TMP_Text>().Any(text => text.text == "RECOVER RUN"));
            evidence.Click("Dialog Recover run"); board.Recover();
            Assert.AreEqual(1, provider.Recoveries); Assert.IsTrue(board.Busy); Assert.IsFalse(ZKube.Tests.Presentation.BoardTestState.Idle(board));
            board.Reroll(); Assert.AreEqual(1, provider.Submits);
            provider.Result.SetResult(BoardActionResult.Snapshot(original.Accepted));
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            Assert.AreEqual(1, provider.Submits); Assert.IsFalse(board.RecoveryRequired);
            CollectionAssert.AreEqual(original.Accepted.State, board.Session.Accepted.State);
        }
        [UnityTest] public IEnumerator ReplacedRunRecoveryOffersExitWithoutReplacingAcceptedState()
        {
            yield return Load("realm-8-daily"); var original = board.Session;
            var provider = new UncertainProvider();
            board.Bind(new BoardSession(original.Accepted, original.Rules, provider, "Daily", original.RealmId));
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board)); evidence.Click("Reroll action");
            yield return Wait(() => !board.Busy); yield return null;
            evidence.Click("Dialog Recover run"); provider.Result.SetResult(null);
            yield return Wait(() => !board.Busy); yield return null;
            Assert.IsTrue(board.RecoveryRequired); Assert.IsFalse(ZKube.Tests.Presentation.BoardTestState.Idle(board));
            int exits = 0; board.ExitRequested += () => exits++;
            evidence.Click("Dialog Back to my runs");
            Assert.AreEqual(1, exits); Assert.AreEqual(1, provider.Recoveries);
            CollectionAssert.AreEqual(original.Accepted.State, board.Session.Accepted.State);
        }

        private sealed class CrossedResponse : IBoardActionProvider
        {
            public Task<BoardActionResult> Submit(CoreRunToken accepted, BoardAction action, CancellationToken cancellation)
            {
                var foreign = BoardHarness.Fixtures.Single(f => f.name == "realm-8-campaign");
                var token = new CoreRunToken(BoardHarness.Hex(foreign.configHex), BoardHarness.Hex(foreign.initialStateHex));
                return Task.FromResult<BoardActionResult>(NativeEngine.ApplyVrf(token, 1, Enumerable.Repeat((byte)8, 32).ToArray()));
            }
            public Task<BoardActionResult> ResolveVrf(CoreRunToken accepted, CancellationToken cancellation)
                => throw new InvalidOperationException("Unexpected randomness request");
        }
        [UnityTest] public IEnumerator CrossedProviderResponseCannotReplaceTheAcceptedRun()
        {
            yield return Load("realm-8-daily");
            var accepted = board.Session.Accepted;
            board.Bind(new BoardSession(accepted, board.Session.Rules, new CrossedResponse(), "Daily", board.Session.RealmId));
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            evidence.Click("Reroll action"); yield return Wait(() => !board.Busy);
            CollectionAssert.AreEqual(accepted.Config, board.Session.Accepted.Config);
            CollectionAssert.AreEqual(accepted.State, board.Session.Accepted.State);
            Assert.IsFalse(board.View.RerollEnabled, "Unknown crossed acceptance must recover before retrying");
            StringAssert.Contains("recover", board.View.StatusText);
        }

        private sealed class HeldAction : IBoardActionProvider
        {
            private readonly IBoardActionProvider inner;
            public readonly TaskCompletionSource<bool> Release = new TaskCompletionSource<bool>();
            public HeldAction(IBoardActionProvider inner) { this.inner = inner; }
            public async Task<BoardActionResult> Submit(CoreRunToken accepted, BoardAction action, CancellationToken cancellation)
            { await Release.Task; return await inner.Submit(accepted, action, cancellation); }
            public Task<BoardActionResult> ResolveVrf(CoreRunToken accepted, CancellationToken cancellation)
                => inner.ResolveVrf(accepted, cancellation);
        }
        [UnityTest] public IEnumerator ChangedBoardDiscardsTheDragQueuedBeforeAcceptance()
        {
            yield return Load("realm-8-daily"); yield return evidence.PlayNextInput();
            var held = new HeldAction(board.Session.Actions);
            board.Bind(new BoardSession(board.Session.Accepted, board.Session.Rules, held, "Balam Daily", board.Session.RealmId));
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            var move = evidence.Current.steps.First(s => s.operation == PlayMoveRequest.Operation);
            int width = board.State.Grid[move.row * 8 + move.start];
            var from = board.View.Layout.CellCenter(move.row, move.start, width);
            var to = board.View.Layout.CellCenter(move.row, move.destination, width);
            uint action = board.State.ActionCounter; ushort moves = board.State.Moves;
            yield return evidence.Drag(from, to); Assert.IsTrue(board.Busy);
            yield return evidence.Drag(from, to);
            StringAssert.Contains("queued", board.View.StatusText);
            Assert.AreEqual(action, board.State.ActionCounter);
            held.Release.SetResult(true); yield return Wait(() => !board.Busy);
            Assert.AreEqual(action + 1, board.State.ActionCounter);
            Assert.AreEqual(moves + 1, board.State.Moves);
            StringAssert.Contains("Board changed", board.View.StatusText);
            Assert.IsTrue(ZKube.Tests.Presentation.BoardTestState.Settled(board.View, board.State.Grid));
        }
        [UnityTest] public IEnumerator AnimationEnabledEndsWithEverySpriteAtItsNativeCell()
        {
            yield return Load("realm-8-daily"); board.SetReducedMotion(false);
            yield return evidence.PlayNextInput(); yield return evidence.PlayNextInput();
            Assert.Greater(board.State.Moves, 0);
            Assert.IsTrue(ZKube.Tests.Presentation.BoardTestState.Settled(board.View, NativeEngine.Summary(board.Session.Accepted).Grid));
        }
        [UnityTest] public IEnumerator VisibleGlyphsPauseGeometryAndSessionAudioAreAvailable()
        {
            yield return Load("realm-8-daily");
            Assert.AreEqual(1, UnityEngine.Object.FindObjectsByType<AudioListener>(FindObjectsSortMode.None).Count(l => l.enabled && l.gameObject.activeInHierarchy));
            foreach (var label in board.View.GetComponentsInChildren<TMP_Text>())
            {
                string printable = new string(label.text.Where(c => !char.IsControl(c)).ToArray());
                Assert.IsTrue(label.font.HasCharacters(printable, out uint[] missing, true, true), label.name + " missing " + string.Join(",", missing ?? Array.Empty<uint>()));
            }
            var icons = board.View.GetComponentsInChildren<BoardActionIcon>();
            CollectionAssert.AreEquivalent(new[] { BoardActionIcon.Symbol.Totem, BoardActionIcon.Symbol.Reroll, BoardActionIcon.Symbol.Pause }, icons.Select(i => i.Shape));
            foreach (var icon in icons)
            {
                Assert.IsFalse(icon.raycastTarget, icon.name + " must use its enclosing button hit target");
                Assert.IsNotNull(icon.GetComponentInParent<UnityEngine.UI.Button>());
                var mesh = icon.canvasRenderer.GetMesh();
                Assert.IsNotNull(mesh, icon.name + " must have rendered geometry");
                Assert.Greater(mesh.vertexCount, 0, icon.name + " must have rendered geometry");
            }
            Assert.IsNull(board.View.GetComponentInChildren<Camera>().GetComponent<AudioListener>(), "Camera/view recreation must not duplicate the session listener");
        }
        [UnityTest] public IEnumerator ReflowPreservesInputAndOneAudioListenerAfterTheOldViewIsDestroyed()
        {
            yield return Load("realm-8-daily");
            var events = EventSystem.current;
            board.RefreshLayout(); yield return null;
            Assert.AreSame(events, EventSystem.current);
            Assert.AreEqual(1, UnityEngine.Object.FindObjectsByType<AudioListener>(FindObjectsSortMode.None).Count(l => l.enabled && l.gameObject.activeInHierarchy));
            evidence.Click("Reroll action"); yield return Wait(() => !board.Busy);
            Assert.AreEqual(0, board.State.RerollCharges);
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
