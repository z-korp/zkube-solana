using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Core.Generated;
using ZKube.Core;
using ZKube.Presentation.Evidence;

namespace ZKube.Presentation.Tests
{
    public sealed class BoardInputJourneyTests
    {
        [Serializable] private sealed class Accepted { public uint actionCounter; }
        [Serializable] private sealed class Snapshot { public bool ready, busy; public int width, height; public Accepted accepted; public string stateSha256; }
        [Serializable] private sealed class Input { public string phase, status; public int unityFrame; public bool previewRendererPresent; }
        [Serializable] private sealed class Frame { public string png; public int unityFrame; public float elapsedSeconds; public Snapshot snapshot; public Input[] inputs; }
        [Serializable] private sealed class Report
        {
            public string outcome, error;
            public bool initialReady, finalReady, muted, reducedMotion;
            public int completedInputs;
            public Frame[] frames;
            public string scenario;
            public Fault fault;
        }
        [Serializable] private sealed class Fault
        {
            public int providerSubmits, providerRecoveries, acceptedNotifications, rejectedNotifications, dispatchedGestures;
            public bool pendingObserved, queuedObserved, recoveryObserved, expectedOutcomeObserved;
            public bool pausedAfterInterruption;
            public string nativeRejection;
            public Snapshot before, after;
        }
        private GameObject root;
        private BoardController board;
        private BoardEvidenceHarness evidence;
        private string directory;
        [Serializable] private sealed class MemoryReport { public int sampleCount; public long[] unityAllocatedBytes; public float[] frameMilliseconds; }
        [Serializable] private sealed class Region { public string name; public Rect pixels; public float widthDp, heightDp; }
        [Serializable] private sealed class Geometry { public Region[] buttons; }
        [UnitySetUp] public IEnumerator SetUp()
        {
            root = new GameObject("Journey evidence test board"); board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardEvidenceHarness>(); evidence.AutoStart = false;
            evidence.Load("realm-8-daily");
            yield return Wait(() => board.Ready && !board.Busy);
            board.SetMuted(true); board.SetReducedMotion(false);
            evidence.Load("realm-8-daily"); yield return Wait(() => board.Ready);
            directory = Path.Combine(Application.temporaryCachePath, "zkube-journey-test-" + Guid.NewGuid().ToString("N"));
        }
        [UnityTearDown] public IEnumerator TearDown()
        {
            UnityEngine.Object.Destroy(root); yield return null;
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
        private IEnumerator Wait(Func<bool> condition)
        {
            float deadline = Time.realtimeSinceStartup + 20;
            while (!condition())
            {
                if (Time.realtimeSinceStartup > deadline) Assert.Fail("Timed out waiting for native board readiness: " + board?.ReadinessIssue);
                yield return null;
            }
        }
        [UnityTest] public IEnumerator LegalEvidenceInputUsesAcceptedPathAndReportsMeasuredMemoryAndButtonGeometry()
        {
            var before = board.State.ActionCounter;
            evidence.BeginFrameSample(300);
            yield return evidence.PlayLegalInput();
            yield return evidence.PlayLegalInput();
            Assert.AreEqual(before + 2, board.State.ActionCounter);
            Assert.IsFalse(board.RecoveryRequired);
            var sample = JsonUtility.FromJson<MemoryReport>(evidence.EndFrameSample());
            Assert.Greater(sample.sampleCount, 1);
            Assert.AreEqual(sample.sampleCount, sample.unityAllocatedBytes.Length);
            Assert.AreEqual(sample.sampleCount, sample.frameMilliseconds.Length);
            Assert.IsTrue(sample.unityAllocatedBytes.All(value => value > 0));
            var geometry = JsonUtility.FromJson<Geometry>(evidence.ReadinessJson());
            Assert.IsTrue(geometry.buttons.Any(button => button.name == "Pause"));
            foreach (var button in geometry.buttons)
            {
                Assert.GreaterOrEqual(button.widthDp, 48, button.name);
                Assert.GreaterOrEqual(button.heightDp, 48, button.name);
                Assert.Greater(button.pixels.width, 0, button.name);
            }
        }
        [UnityTest] public IEnumerator RecordingShowsImmediateSelectionPendingAcceptanceAnimationAndReadyEnd()
        {
            yield return evidence.RecordInputJourney(directory, 2, 300, 15);
            var report = JsonUtility.FromJson<Report>(File.ReadAllText(Path.Combine(directory, "journey.json")));
            Assert.AreEqual("completed", report.outcome, report.error);
            Assert.AreEqual(2, report.completedInputs); Assert.IsTrue(report.initialReady); Assert.IsTrue(report.finalReady);
            Assert.IsTrue(report.muted); Assert.IsFalse(report.reducedMotion);
            Assert.IsFalse(evidence.RecordingJourney);
            Assert.IsTrue(report.frames[0].snapshot.ready); Assert.IsTrue(report.frames.Last().snapshot.ready);
            Assert.IsTrue(report.frames.Any(f => f.snapshot.busy && f.snapshot.accepted.actionCounter == 0), "Pending must remain distinct from accepted");
            Assert.IsTrue(report.frames.Any(f => f.snapshot.busy && f.snapshot.accepted.actionCounter > 0), "Record accepted animation frames while Busy");
            var selection = report.frames.Single(f => f.inputs.Any(i => i.phase == "pointer-down-after"));
            var down = selection.inputs.Single(i => i.phase == "pointer-down-after");
            Assert.IsTrue(down.previewRendererPresent, "Actual drag preview renderer must exist immediately after dispatch");
            Assert.LessOrEqual(selection.unityFrame - down.unityFrame, 1, "Capture selection within one actual rendered frame");
            Assert.AreEqual(report.frames.Length, Directory.GetFiles(directory, "frame-*.png").Length);
            for (int i = 0; i < report.frames.Length; i++)
            {
                var frame = report.frames[i]; var bytes = File.ReadAllBytes(Path.Combine(directory, frame.png));
                CollectionAssert.AreEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }, bytes.Take(8).ToArray());
                Assert.AreEqual(frame.snapshot.width, BigEndian(bytes, 16)); Assert.AreEqual(frame.snapshot.height, BigEndian(bytes, 20));
                if (i == 0) continue;
                Assert.Greater(frame.unityFrame, report.frames[i - 1].unityFrame, "Never duplicate rendered frames");
                Assert.Greater(frame.elapsedSeconds, report.frames[i - 1].elapsedSeconds);
            }
        }
        [UnityTest] public IEnumerator FrameBoundProducesExplicitIncompleteOutcomeAndNeverRelaxesStillCapture()
        {
            yield return evidence.RecordInputJourney(directory, 20, 2, 15);
            var report = JsonUtility.FromJson<Report>(evidence.LastJourneyJson);
            Assert.AreEqual("frame-limit", report.outcome); Assert.AreEqual(2, report.frames.Length);
            Assert.Less(report.completedInputs, 20); Assert.IsFalse(evidence.RecordingJourney);
            if (board.Busy) Assert.Throws<InvalidOperationException>(() => evidence.Capture(Path.Combine(directory, "invalid.png")).MoveNext());
            yield return Wait(() => board.Ready);
            evidence.Load("realm-8-daily"); yield return Wait(() => board.Ready);
            Assert.Throws<IOException>(() => evidence.RecordInputJourney(directory).MoveNext(), "Reusing a folder must never inherit old frames");
        }
        [UnityTest] public IEnumerator StoppingDuringDragCancelsSelectionWithoutSubmittingAndRequiresFreshFixtureCursor()
        {
            yield return evidence.PlayNextInput(); yield return Wait(() => board.Ready); // Reroll first.
            uint accepted = board.State.ActionCounter;
            yield return evidence.RecordInputJourney(directory, 1, 2, 15);
            var report = JsonUtility.FromJson<Report>(evidence.LastJourneyJson);
            Assert.AreEqual("frame-limit", report.outcome);
            Assert.IsTrue(report.frames.Last().inputs.Any(i => i.phase == "pointer-down-after" && i.previewRendererPresent));
            yield return null; // Deferred removal of the canceled ghost.
            Assert.AreEqual(accepted, board.State.ActionCounter); Assert.IsFalse(board.Busy);
            Assert.IsFalse(board.View.GetComponentsInChildren<SpriteRenderer>().Any(r => r.name == "Unaccepted drag preview"));
            Assert.Throws<InvalidOperationException>(() => evidence.PlayNextInput().MoveNext());
            Assert.Throws<InvalidOperationException>(() => evidence.RecordInputJourney(directory + "-retry").MoveNext());
            // Normal screen input remains usable; only the truncated fixture
            // cursor is invalidated. No accepted provider operation is canceled.
            var move = evidence.Current.steps.First(s => s.operation == PlayMoveRequest.Operation);
            int width = board.View.DisplayGrid[move.row * 8 + move.start];
            yield return evidence.Drag(board.View.Layout.CellCenter(move.row, move.start, width),
                board.View.Layout.CellCenter(move.row, move.destination, width));
            yield return Wait(() => board.Ready);
            Assert.Greater(board.State.ActionCounter, accepted);
        }
        private static int BigEndian(byte[] bytes, int offset) =>
            bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3];

        [UnityTest] public IEnumerator NativeRejectionRecordsPendingAndUnchangedAcceptedState()
        {
            yield return evidence.PlayNextInput(); yield return Wait(() => board.Ready);
            yield return evidence.RecordFaultJourney(directory, "native-rejection");
            var report = JsonUtility.FromJson<Report>(evidence.LastJourneyJson);
            Assert.AreEqual("completed", report.outcome, report.error);
            Assert.AreEqual("native-rejection", report.scenario);
            Assert.IsTrue(report.initialReady && report.finalReady);
            Assert.IsTrue(report.fault.pendingObserved && report.fault.expectedOutcomeObserved);
            Assert.AreEqual(1, report.fault.providerSubmits); Assert.AreEqual(1, report.fault.rejectedNotifications);
            Assert.AreEqual(0, report.fault.acceptedNotifications); Assert.IsNotEmpty(report.fault.nativeRejection);
            Assert.AreEqual(report.fault.before.stateSha256, report.fault.after.stateSha256);
            Assert.IsTrue(report.frames.Any(f => f.snapshot.busy && f.snapshot.stateSha256 == report.fault.before.stateSha256));
            Assert.IsTrue(report.frames.SelectMany(f => f.inputs).Any(i => i.phase == "fault-outcome-observed" && i.status == BoardNotices.Text(BoardNotice.Unavailable)));
        }
        [UnityTest] public IEnumerator QueuedDiscardRecordsTwoGesturesButOneNativeSubmission()
        {
            yield return evidence.PlayNextInput(); yield return Wait(() => board.Ready);
            yield return evidence.RecordFaultJourney(directory, "queued-discard");
            var report = JsonUtility.FromJson<Report>(evidence.LastJourneyJson);
            Assert.AreEqual("completed", report.outcome, report.error);
            Assert.IsTrue(report.fault.pendingObserved && report.fault.queuedObserved && report.fault.expectedOutcomeObserved);
            Assert.AreEqual(2, report.fault.dispatchedGestures); Assert.AreEqual(1, report.fault.providerSubmits);
            Assert.AreEqual(report.fault.before.accepted.actionCounter + 1, report.fault.after.accepted.actionCounter);
            Assert.AreNotEqual(report.fault.before.stateSha256, report.fault.after.stateSha256);
            Assert.IsTrue(report.frames.SelectMany(f => f.inputs).Any(i => i.phase == "fault-queued-intention" && i.status == BoardNotices.Text(BoardNotice.Queued)));
            Assert.IsTrue(report.frames.SelectMany(f => f.inputs).Any(i => i.phase == "fault-outcome-observed" && i.status == BoardNotices.Text(BoardNotice.Changed)));
            Assert.IsTrue(board.View.IsSettled(board.State.Grid));
            Assert.IsFalse(board.Paused, "A completed fault recording must leave normal interaction available");
        }
        [UnityTest] public IEnumerator UncertainAcceptedActionRecoversThroughActualButtonWithoutReplayingQueuedGesture()
        {
            foreach (bool reduced in new[] { false, true })
            {
                board.SetReducedMotion(reduced);
                evidence.Load("realm-8-daily"); yield return Wait(() => board.Ready);
                yield return evidence.PlayNextInput(); yield return Wait(() => board.Ready);
                yield return evidence.RecordFaultJourney(directory, "uncertain-recovery");
                var report = JsonUtility.FromJson<Report>(evidence.LastJourneyJson);
                Assert.AreEqual("completed", report.outcome, report.error);
                Assert.IsTrue(report.fault.pendingObserved && report.fault.queuedObserved && report.fault.recoveryObserved && report.fault.expectedOutcomeObserved);
                Assert.AreEqual(1, report.fault.providerSubmits); Assert.AreEqual(1, report.fault.providerRecoveries);
                Assert.AreEqual(2, report.fault.dispatchedGestures); Assert.AreEqual(1, report.fault.rejectedNotifications);
                Assert.AreEqual(report.fault.before.accepted.actionCounter + 1, report.fault.after.accepted.actionCounter);
                Assert.IsTrue(report.frames.SelectMany(frame => frame.inputs).Any(input => input.phase == "fault-recovery-started"));
                Assert.IsTrue(report.frames.Any(frame => !frame.snapshot.ready && !frame.snapshot.busy && frame.snapshot.stateSha256 == report.fault.before.stateSha256));
                Assert.IsTrue(report.finalReady); Assert.IsFalse(board.RecoveryRequired);
                Directory.Delete(directory, true);
            }
        }

        [UnityTest] public IEnumerator InterruptedFaultCancelsStillUnacceptedHeldSubmission()
        {
            yield return evidence.PlayNextInput(); yield return Wait(() => board.Ready);
            byte[] accepted = (byte[])board.Session.Accepted.State.Clone();
            // First frame + seven drag frames + two held frames stops after
            // submission while the provider is still held, before release.
            yield return evidence.RecordFaultJourney(directory, "queued-discard", 10);
            var report = JsonUtility.FromJson<Report>(evidence.LastJourneyJson);
            Assert.AreEqual("frame-limit", report.outcome);
            Assert.AreEqual(1, report.fault.providerSubmits, "Must stop after submit, not just during selection");
            yield return Wait(() => !board.Busy);
            Assert.IsTrue(board.RecoveryRequired, "Cancellation without a returned result must be reconciled explicitly");
            board.Recover(); yield return Wait(() => board.Ready);
            CollectionAssert.AreEqual(accepted, board.Session.Accepted.State);
            Assert.IsFalse(board.View.GetComponentsInChildren<SpriteRenderer>().Any(r => r.name == "Unaccepted drag preview"));
            Assert.Throws<InvalidOperationException>(() => evidence.PlayNextInput().MoveNext());
        }

        [UnityTest] public IEnumerator StoppingAfterSecondDragQueuesDoesNotSubmitItWhenHeldActionCancels()
        {
            yield return evidence.PlayNextInput(); yield return Wait(() => board.Ready);
            byte[] accepted = (byte[])board.Session.Accepted.State.Clone();
            var journey = evidence.RecordFaultJourney(directory, "queued-discard");
            var running = evidence.StartCoroutine(journey);
            yield return Wait(() => board.Busy && board.View.StatusText == BoardNotices.Text(BoardNotice.Queued));
            // Dispose the nested recorder explicitly as well: this test must
            // exercise cleanup regardless of Unity's coroutine disposal policy.
            var recorder = journey.Current as IDisposable;
            recorder?.Dispose(); evidence.StopCoroutine(running); (journey as IDisposable)?.Dispose();
            yield return Wait(() => !board.Busy);
            var report = JsonUtility.FromJson<Report>(evidence.LastJourneyJson);
            Assert.AreEqual("interrupted", report.outcome);
            Assert.IsTrue(report.fault.queuedObserved, "The stop must follow a complete second queued drag");
            Assert.AreEqual(2, report.fault.dispatchedGestures);
            Assert.AreEqual(1, report.fault.providerSubmits, "Cancelling the held action must not submit the queued intention");
            Assert.AreEqual(0, report.fault.acceptedNotifications);
            Assert.IsTrue(board.Paused); Assert.IsTrue(report.fault.pausedAfterInterruption);
            Assert.IsTrue(board.RecoveryRequired);
            CollectionAssert.AreEqual(accepted, board.Session.Accepted.State);
            board.Recover(); yield return Wait(() => board.Ready);
            CollectionAssert.AreEqual(accepted, board.Session.Accepted.State);
            Assert.Throws<InvalidOperationException>(() => evidence.PlayNextInput().MoveNext());
        }

        private sealed class CountingProvider : IBoardActionProvider
        {
            public int Calls;
            public BoardActionResult Result;
            public Task<BoardActionResult> Submit(CoreRunToken accepted, BoardAction action, CancellationToken cancellation)
            { Calls++; return Task.FromResult(Result); }
            public Task<BoardActionResult> ResolveVrf(CoreRunToken accepted, CancellationToken cancellation) => throw new InvalidOperationException();
        }
        [UnityTest] public IEnumerator HeldFaultHonorsCancellationAndReleasedProviderPreservesExplicitSnapshot()
        {
            var type = typeof(BoardEvidenceHarness).GetNestedType("FaultProvider", System.Reflection.BindingFlags.NonPublic);
            var inner = new CountingProvider { Result = BoardActionResult.Snapshot(board.Session.Accepted) };
            object Create() => Activator.CreateInstance(type, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic,
                null, new object[] { inner, false, false }, null);
            var held = (IBoardActionProvider)Create();
            using (var cancellation = new CancellationTokenSource())
            {
                var pending = held.Submit(board.Session.Accepted, new BoardAction(BoardActionKind.Move), cancellation.Token);
                Assert.IsFalse(pending.IsCompleted); cancellation.Cancel();
                yield return Wait(() => pending.IsCompleted);
                Assert.IsTrue(pending.IsCanceled); Assert.AreEqual(0, inner.Calls);
            }
            var released = Create(); type.GetMethod("Release").Invoke(released, null);
            var forwarded = ((IBoardActionProvider)released).Submit(board.Session.Accepted, new BoardAction(BoardActionKind.Move), default);
            yield return Wait(() => forwarded.IsCompleted);
            type.GetMethod("CancelIfHeld").Invoke(released, null);
            Assert.IsFalse(forwarded.IsFaulted); Assert.AreSame(inner.Result, forwarded.Result);
            Assert.IsTrue(forwarded.Result.IsSnapshot); Assert.AreEqual(1, inner.Calls);
        }
    }
}
