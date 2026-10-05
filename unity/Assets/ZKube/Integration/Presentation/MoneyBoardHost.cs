using System;
using ZKube.Integration.Client;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Integration.Client.Runs;
using ZKube.Integration.Execution;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    // Owns one bound Arena run: on its board while it plays, then behind the
    // shared result page while its result is saved. All network operations pass
    // through the flow's identity gate and shutdown drain; the shared board owns
    // animation and input, and the shared result page owns the result.
    public sealed class MoneyBoardHost : MonoBehaviour
    {
        private MoneyAppFlow flow;
        private Func<long> now;
        private MoneyRunHandle run;
        private BoardController board;
        private CancellationTokenSource lifetime;
        private bool paused, observing, foregroundNeeded, settling, settlementAttempted, settled;
        // The run's last state once it has ended; its result is saved from then on.
        private RunSummary ended;
        private Coroutine handOff;
        private long generation, foregroundGeneration;
        // A run is bound: on its board, or being saved behind its result.
        public bool HasRun => run != null;
        // Its board is on screen.
        public bool Playing => board != null;
        public BoardController Board => board;
        public bool OperationPending => observing || settling;
        // The ended run's result: being saved, saved, or not saved yet.
        public const string SavingNotice = "Saving your result…", SavedNotice = "Result saved.", UnsavedNotice = "Your result is not saved yet.";
        public bool Saved => settled;
        public bool Unsaved => HasRun && ended != null && settlementAttempted && !settling && !settled;
        public string SaveNotice => settled ? SavedNotice : Unsaved ? UnsavedNotice : SavingNotice;
        // The board left without a result.
        public event Action Closed;
        // The run ended: the shared result takes the screen while its result is saved.
        public event Action<ResultPageView> Finished;
        public event Action SaveChanged;
        public event Action<MoneyRunOperation> ObservedOperation;

        public void Initialize(MoneyAppFlow value, Func<long> clock)
        {
            if (flow != null) throw new InvalidOperationException("The board host is already initialized");
            flow = value ?? throw new ArgumentNullException(nameof(value));
            now = clock ?? throw new ArgumentNullException(nameof(clock));
        }

        // best is the owner's best Daily score before this run and streak the
        // day's entry streak, each null when it was not read; top is the day's
        // Score board top as its read will give it.
        private ulong? best, streak;
        public void Open(MoneyRunLaunch launch, float textScale, ulong? best = null, Task<ulong?> top = null, ulong? streak = null)
        {
            this.best = best; this.streak = streak;
            if (flow == null || HasRun || !launch.CanBind || !flow.RunIdentityCurrent(launch.Run))
                throw new InvalidOperationException("No current accepted run can be opened");
            run = launch.Run; lifetime = new CancellationTokenSource(); generation++;
            settlementAttempted = settled = settling = observing = foregroundNeeded = false;
            ended = null;
            var acceptedRun = run;
            var provider = new RunBoardActionProvider(run.Binding,
                (accepted, action, row, start, destination, token) => Execute(acceptedRun,
                    cancellation => flow.SubmitRun(acceptedRun, accepted, action, row, start, destination, now(), cancellation), token),
                token => Execute(acceptedRun, cancellation => flow.ResolveRun(acceptedRun, cancellation), token),
                token => Execute(acceptedRun, cancellation => flow.RecoverRun(acceptedRun, cancellation), token),
                token => Execute(acceptedRun, cancellation => flow.SettleRun(acceptedRun, cancellation), token));
            var root = new GameObject("Money accepted run"); root.transform.SetParent(transform, false);
            board = root.AddComponent<BoardController>();
            board.SetTextScale(textScale); board.Host = new BoardHostHooks { Terminal = PresentTerminal, Exit = Close };
            board.Bind(provider.Bind(launch.Operation.State,
                new DailyContext { Top = top, Best = best, ClosesAt = run.Binding.DeadlineAt, Now = now }));
            board.SetHostInputEnabled(!paused && !Frozen());
        }

        private async Task<RunClientState> Execute(
            MoneyRunHandle expected,
            Func<CancellationToken, Task<MoneyRead<MoneyRunOperation>>> operation, CancellationToken caller)
        {
            if (run != expected || !HasRun) throw new OperationCanceledException("The visible run changed");
            long epoch = generation;
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, caller);
            var result = await operation(linked.Token);
            if (!Current(epoch) || !result.IsCurrent) throw new OperationCanceledException("The visible run changed");
            ObservedOperation?.Invoke(result.Value);
            return result.Value.RequireState();
        }

        private bool Current(long epoch) => this != null && HasRun && epoch == generation && flow.RunIdentityCurrent(run);
        private bool CurrentForeground(long epoch, long visit) => Current(epoch) &&
            visit == foregroundGeneration && !paused && isActiveAndEnabled;
        private bool Frozen() => run != null && now() >= run.DeadlineAt;
        private bool Terminal() => ended != null;

        private void Update()
        {
            if (!HasRun) return;
            if (!Current(generation)) { Close(); return; }
            if (paused) return;
            // An ended run's result is saved at once, with or without its board.
            if (Terminal() && !observing && !settlementAttempted) { _ = Settle(); return; }
            if (!Playing || !board.PresentationInitialized) return;
            if (foregroundNeeded)
            {
                board.SetHostInputEnabled(false);
                if (!board.Busy && !settling && !observing) _ = ObserveForeground();
                return;
            }
            // The day has closed on an unfinished run: no action counts any more,
            // so the run ends at its last accepted state. Its result opens, and
            // saving it ends the run by the Deadline rule.
            if (Frozen() && !Terminal())
            {
                board.SetHostInputEnabled(false);
                if (!board.Busy && !observing && !board.RecoveryRequired) PresentTerminal(board);
            }
            else if (!Terminal() && !observing && !board.RecoveryRequired)
                board.SetHostInputEnabled(true);
        }

        // The ended run stays on its board for a moment, as every run does, then
        // its result page takes the screen. The run stays bound until it is saved.
        private void PresentTerminal(BoardController source)
        {
            if (source != board || handOff != null) return;
            ended = board.State;
            handOff = StartCoroutine(HandOff());
        }
        private System.Collections.IEnumerator HandOff()
        {
            long epoch = generation;
            yield return new WaitForSecondsRealtime(RunBoard.TerminalHoldSeconds);
            handOff = null;
            if (!Current(epoch) || !Playing) yield break;
            var session = board.Session;
            var result = new ResultPageView { HasResult = true, ProductName = Application.productName,
                Mode = "Daily", Realm = session.RealmId, Day = NativeEngine.DayAt(run.DeadlineAt),
                ObjectiveKind = session.Rules.ObjectiveKind, ObjectiveValue = session.Rules.ObjectiveValue,
                Score = ended.DailyScore, ObjectiveTotal = ended.ObjectiveTotal, Streak = streak, Notice = SaveNotice };
            result.DailyOutcome(best.HasValue && ended.DailyScore > best.Value);
            var previous = board; board = null;
            previous.SetHostInputEnabled(false); previous.gameObject.SetActive(false); Destroy(previous.gameObject);
            Finished?.Invoke(result);
        }
        private async Task Settle()
        {
            if (!HasRun || settling || settled || !Terminal()) return;
            long epoch = generation; settling = settlementAttempted = true;
            SaveChanged?.Invoke();
            try
            {
                var expected = run;
                var state = await Execute(expected, token => flow.SettleRun(expected, token), lifetime.Token);
                if (!Current(epoch)) return;
                settled = state.Phase == "consumed";
            }
            catch (Exception error) { ZKube.Integration.Transport.ClientLog.Failure("run settlement", error); }
            finally
            {
                if (Current(epoch)) { settling = false; SaveChanged?.Invoke(); }
            }
        }
        // The player asks again for a result that is not saved yet.
        public void SaveAgain() { if (Unsaved) _ = Settle(); }

        private async Task ObserveForeground()
        {
            if (!HasRun || observing || board.Busy || settling) return;
            long epoch = generation, visit = foregroundGeneration;
            observing = true; foregroundNeeded = false;
            try
            {
                var value = await flow.ObserveBoundRun(run, lifetime.Token);
                if (!CurrentForeground(epoch, visit) || !value.IsCurrent) return;
                var state = value.Value.RequireState();
                if (state.Token == null)
                {
                    if (state.Phase == "consumed" && Terminal()) { settled = true; SaveChanged?.Invoke(); }
                    else board.RequireRecovery("This run is no longer playable here. Return to your runs to check its state.");
                    return;
                }
                board.Observe(run.Binding.Accept(state));
                if (!CurrentForeground(epoch, visit)) return;
                if (board.State.Phase == (byte)CorePhase.AwaitingVrf)
                {
                    board.RequireRecovery("The next row is pending. Recover this run to continue.");
                    return;
                }
                board.SetHostInputEnabled(!Frozen() && !Terminal());
                if (!Terminal() && !Frozen()) board.Pause();
            }
            catch (Exception error)
            {
                ZKube.Integration.Transport.ClientLog.Failure("run check", error);
                if (CurrentForeground(epoch, visit)) board.RequireRecovery("The current run could not be checked. Recover before playing again.");
            }
            finally { if (Current(epoch)) observing = false; }
        }

        public void Suspend(bool value)
        {
            if (paused == value) return;
            paused = value; foregroundGeneration++;
            if (!Playing) return;
            board.SetHostInputEnabled(false);
            if (value) board.Pause(); else foregroundNeeded = true;
        }
        private void OnApplicationPause(bool value) => Suspend(value);
        private void OnDisable()
        { foregroundGeneration++; if (Playing) { board.SetHostInputEnabled(false); foregroundNeeded = true; } }
        private void OnEnable()
        { foregroundGeneration++; if (Playing) foregroundNeeded = true; }
        // Lets the run go. A board on screen leaves without a result.
        public void Close()
        {
            if (!HasRun) return;
            generation++; run = null; ended = null;
            if (handOff != null) { StopCoroutine(handOff); handOff = null; }
            var previous = board; board = null;
            try { lifetime?.Cancel(); }
            finally
            {
                lifetime?.Dispose(); lifetime = null;
                if (previous != null)
                {
                    previous.SetHostInputEnabled(false); previous.gameObject.SetActive(false); Destroy(previous.gameObject);
                    Closed?.Invoke();
                }
            }
        }
        private void OnDestroy() => Close();
    }
}
