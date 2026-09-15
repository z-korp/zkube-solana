#if UNITY_EDITOR || ZKUBE_EVIDENCE
using System;
using System.Collections;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Evidence
{
    public sealed partial class BoardEvidenceHarness
    {
        [Serializable] private sealed class FaultObservation
        {
            public string scenario;
            public string faultSource = "Development-only held offline provider. Rejection submits a deliberately stale action counter to the real native engine; queue scenario releases the original valid native action. No chain transport failure is claimed.";
            public string precondition = "realm-8-daily loaded and its first actual reroll input completed before recording";
            public string nativeRejection;
            public int providerSubmits, providerRecoveries, acceptedNotifications, rejectedNotifications, dispatchedGestures;
            public bool pendingObserved, queuedObserved, recoveryObserved, expectedOutcomeObserved;
            public bool pausedAfterInterruption;
            public Readiness before, after;
            [NonSerialized] public FaultProvider provider;
        }
        private sealed class FaultProvider : IBoardActionProvider, IBoardRecoveryProvider
        {
            private readonly IBoardActionProvider inner;
            private readonly bool reject, uncertain;
            private readonly TaskCompletionSource<bool> gate = new TaskCompletionSource<bool>();
            private readonly TaskCompletionSource<bool> recoveryGate = new TaskCompletionSource<bool>();
            private CoreRunToken latest;
            public int SubmitCount { get; private set; }
            public int RecoveryCount { get; private set; }
            public string NativeRejection { get; private set; }
            public FaultProvider(IBoardActionProvider inner, bool reject, bool uncertain = false)
            { this.inner = inner; this.reject = reject; this.uncertain = uncertain; }
            public void Release() => gate.TrySetResult(true);
            public void ReleaseRecovery() => recoveryGate.TrySetResult(true);
            public void CancelIfHeld() { gate.TrySetCanceled(); recoveryGate.TrySetCanceled(); }
            public async Task<BoardActionResult> Submit(CoreRunToken accepted, BoardAction action, CancellationToken cancellation)
            {
                SubmitCount++;
                latest = accepted;
                // Only the held, unsubmitted operation is cancelled here.
                // Dispose registration before forwarding a released operation.
                using (cancellation.Register(() => gate.TrySetCanceled(cancellation)))
                    await gate.Task;
                cancellation.ThrowIfCancellationRequested();
                if (!reject)
                {
                    var result = await inner.Submit(accepted, action, cancellation);
                    latest = result.Token;
                    if (uncertain) throw new TimeoutException("Offline accepted response deliberately withheld");
                    return result;
                }
                var state = NativeEngine.Summary(accepted);
                try
                {
                    // Only the injected request counter differs. Native Rust
                    // rejects it; C# does not fabricate an error status or token.
                    NativeEngine.PlayMove(accepted, checked(state.ActionCounter - 1), state.Moves, action.Row, action.Start, action.Destination);
                }
                catch (NativeEngineException error) { NativeRejection = error.Status.ToString(); throw; }
                throw new InvalidOperationException("Stale action counter unexpectedly accepted by native engine");
            }
            public Task<BoardActionResult> ResolveVrf(CoreRunToken accepted, CancellationToken cancellation)
                => inner.ResolveVrf(accepted, cancellation);
            public async Task<BoardActionResult> Recover(CancellationToken cancellation)
            {
                RecoveryCount++;
                if (uncertain)
                    using (cancellation.Register(() => recoveryGate.TrySetCanceled(cancellation))) await recoveryGate.Task;
                cancellation.ThrowIfCancellationRequested();
                return latest == null ? null : BoardActionResult.Snapshot(latest);
            }
        }

        // Caller uses Load, readiness, PlayNextInput (the real reroll), readiness
        // first. Keeping setup outside capture makes the starting acceptance
        // explicit and leaves the full bounded window for observed fault input.
        public IEnumerator RecordFaultJourney(string directory, string scenario, int maxFrames = 300, float maxSeconds = 15)
        {
            if (scenario != "native-rejection" && scenario != "queued-discard" && scenario != "uncertain-recovery")
                throw new ArgumentException("Unknown fault journey scenario", nameof(scenario));
            if (maxFrames < 2 || maxFrames > 600 || maxSeconds <= 0 || maxSeconds > 30)
                throw new ArgumentOutOfRangeException("Fault recording bounds: 2–600 frames and at most 30 seconds");
            string destination = System.IO.Path.GetFullPath(directory);
            if (System.IO.Directory.Exists(destination) || System.IO.File.Exists(destination))
                throw new System.IO.IOException("Journey output must be a new directory: " + destination);
            if (RecordingJourney || journeyRequiresReload || Board == null || !Board.Ready || Board.Busy ||
                Current?.name != "realm-8-daily" || Board.State.ActionCounter != 1 || Board.State.Moves != 0)
                throw new InvalidOperationException("Load realm-8-daily, complete its reroll input and wait for readiness before a fault journey");
            var original = Board.Session;
            var provider = new FaultProvider(original.Actions, scenario == "native-rejection", scenario == "uncertain-recovery");
            var observation = new FaultObservation { scenario = scenario, provider = provider,
                before = JsonUtility.FromJson<Readiness>(ReadinessJson()) };
            if (scenario == "uncertain-recovery") observation.faultSource = "Development-only provider withholds a real native accepted result, then releases its snapshot on recovery. No chain timeout or Android process death is claimed.";
            Action<CoreRunToken> accepted = _ => observation.acceptedNotifications++;
            Action<string> rejected = _ => observation.rejectedNotifications++;
            Board.Accepted += accepted; Board.Rejected += rejected;
            try
            {
                Board.Bind(new BoardSession(original.Accepted, original.Rules, provider, original.Title, original.RealmId));
                // Binding replaces measured geometry. Record and dispatch only
                // after its actual frame is ready, as for every fixture load.
                float readyDeadline = Time.realtimeSinceStartup + 20;
                while (!Board.Ready)
                {
                    if (Time.realtimeSinceStartup > readyDeadline)
                        throw new TimeoutException("Fault provider binding did not render ready: " + Board.ReadinessIssue);
                    yield return null;
                }
                yield return RecordJourney(directory, 1, maxFrames, maxSeconds, DriveFault(observation), observation);
            }
            finally
            {
                // Unity may dispose the outer coroutine before the nested
                // recorder. Clear queued input before cancelling its held gate.
                if (RecordingJourney && Board != null) Board.Pause();
                provider.CancelIfHeld();
                Board.Accepted -= accepted; Board.Rejected -= rejected;
            }
        }

        private IEnumerator DriveFault(FaultObservation fault)
        {
            var move = Current.steps.First(s => s.operation == PlayMoveRequest.Operation);
            var accepted = Board.Session.Accepted;
            uint action = Board.State.ActionCounter;
            ushort moves = Board.State.Moves;
            int width = Board.View.DisplayGrid[move.row * 8 + move.start];
            var from = Board.View.Layout.CellCenter(move.row, move.start, width);
            var to = Board.View.Layout.CellCenter(move.row, move.destination, width);
            yield return Drag(from, to); fault.dispatchedGestures++;
            fault.pendingObserved = Board.Busy && accepted.State.SequenceEqual(Board.Session.Accepted.State);
            if (!fault.pendingObserved) throw new InvalidOperationException("Held input did not preserve pending acceptance");
            RecordInput("fault-provider-held", to, Board.View.Pointer.gameObject);
            // These null yields advance only after actual captured frames.
            for (int i = 0; i < 3; i++) yield return null;
            if (fault.scenario == "queued-discard" || fault.scenario == "uncertain-recovery")
            {
                yield return Drag(from, to); fault.dispatchedGestures++;
                fault.queuedObserved = Board.Busy && Board.View.StatusText == BoardNotices.Text(BoardNotice.Queued) &&
                    accepted.State.SequenceEqual(Board.Session.Accepted.State);
                if (!fault.queuedObserved) throw new InvalidOperationException("Second real drag was not queued against the held board");
                RecordInput("fault-queued-intention", to, Board.View.Pointer.gameObject);
                for (int i = 0; i < 3; i++) yield return null;
            }
            RecordInput("fault-provider-release", to, Board.View.Pointer.gameObject);
            fault.provider.Release();
            if (fault.scenario == "uncertain-recovery")
            {
                while (Board.Busy) yield return null;
                if (!Board.RecoveryRequired || !accepted.State.SequenceEqual(Board.Session.Accepted.State))
                    throw new InvalidOperationException("Uncertain response must preserve the displayed accepted token and require recovery");
                for (int i = 0; i < 3; i++) yield return null;
                Click("Dialog Recover run");
                fault.recoveryObserved = Board.Busy && Board.RecoveryRequired && fault.provider.RecoveryCount == 1;
                if (!fault.recoveryObserved) throw new InvalidOperationException("Actual recovery button did not start reconciliation");
                RecordInput("fault-recovery-started", to, Board.View.Pointer.gameObject);
                for (int i = 0; i < 3; i++) yield return null;
                fault.provider.ReleaseRecovery();
            }
            while (Board.Busy || !Board.Ready) yield return null;
            fault.expectedOutcomeObserved = fault.scenario == "native-rejection"
                ? accepted.State.SequenceEqual(Board.Session.Accepted.State) && fault.rejectedNotifications == 1 &&
                    fault.acceptedNotifications == 0 && Board.View.StatusText == BoardNotices.Text(BoardNotice.Unavailable)
                : Board.State.ActionCounter == action + 1 && Board.State.Moves == moves + 1 &&
                    !accepted.State.SequenceEqual(Board.Session.Accepted.State) &&
                    (fault.scenario == "uncertain-recovery" ? !Board.RecoveryRequired && fault.provider.RecoveryCount == 1
                        : Board.View.StatusText == BoardNotices.Text(BoardNotice.Changed));
            if (!fault.expectedOutcomeObserved || fault.provider.SubmitCount != 1)
                throw new InvalidOperationException("Fault journey outcome differed from its native acceptance/queue contract");
            RecordInput("fault-outcome-observed", to, Board.View.Pointer.gameObject);
            for (int i = 0; i < 3; i++) yield return null;
        }
    }
}
#endif
