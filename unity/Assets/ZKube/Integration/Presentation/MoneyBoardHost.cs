using System;
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
using ZKube.Local;

namespace ZKube.Integration.Presentation
{
    // Owns one visible run. All network operations pass through the flow's
    // identity gate and shutdown drain; the shared board owns animation/input.
    public sealed class MoneyBoardHost : MonoBehaviour
    {
        private MoneyAppFlow flow;
        private Func<long> now;
        private MoneyRunHandle run;
        private MoneyRead<LocalBoardActionProvider> campaign;
        private BoardController board;
        private CancellationTokenSource lifetime;
        private bool paused, observing, foregroundNeeded, settling, settlementAttempted, settled, frozenShown;
        private string terminalTitle, terminalBody, settlementError;
        private long generation, foregroundGeneration;
        public bool HasRun => run != null || campaign != null;
        public BoardController Board => board;
        public bool OperationPending => observing || settling;
        public event Action Closed;
        public event Action<ResultPageView> ResultClosed;
        public event Action<MoneyRunOperation> ObservedOperation;

        public void Initialize(MoneyAppFlow value, Func<long> clock)
        {
            if (flow != null) throw new InvalidOperationException("The board host is already initialized");
            flow = value ?? throw new ArgumentNullException(nameof(value));
            now = clock ?? throw new ArgumentNullException(nameof(clock));
        }

        public void Open(MoneyRunLaunch launch, string title, float textScale)
        {
            if (flow == null || HasRun || !launch.CanBind || !flow.RunIdentityCurrent(launch.Run))
                throw new InvalidOperationException("No current accepted run can be opened");
            run = launch.Run; lifetime = new CancellationTokenSource(); generation++;
            settlementAttempted = settled = settling = observing = foregroundNeeded = frozenShown = false;
            terminalTitle = terminalBody = settlementError = null;
            var acceptedRun = run;
            var provider = new RunBoardActionProvider(run.Binding,
                (accepted, action, row, start, destination, token) => Execute(acceptedRun,
                    cancellation => flow.SubmitRun(acceptedRun, accepted, action, row, start, destination, now(), cancellation), token),
                token => Execute(acceptedRun, cancellation => flow.ResolveRun(acceptedRun, cancellation), token),
                token => Execute(acceptedRun, cancellation => flow.RecoverRun(acceptedRun, cancellation), token),
                token => Execute(acceptedRun, cancellation => flow.SettleRun(acceptedRun, cancellation), token));
            var root = new GameObject("Money accepted run"); root.transform.SetParent(transform, false);
            board = root.AddComponent<BoardController>();
            board.SetTextScale(textScale); board.TerminalPresenter = PresentTerminal;
            board.ExitRequested += Close;
            board.Bind(provider.Bind(launch.Operation.State, title));
            board.SetHostInputEnabled(!paused && !Frozen());
        }

        public void Open(MoneyRead<LocalBoardActionProvider> launch, string title, float textScale)
        {
            if (flow == null || HasRun || !launch.IsCurrent)
                throw new InvalidOperationException("No current local run can be opened");
            campaign = launch; lifetime = new CancellationTokenSource(); generation++;
            settlementAttempted = settled = true;
            settling = observing = foregroundNeeded = frozenShown = false;
            terminalTitle = terminalBody = settlementError = null;
            var root = new GameObject("Money local Campaign"); root.transform.SetParent(transform, false);
            board = root.AddComponent<BoardController>(); board.SetTextScale(textScale);
            board.TerminalPresenter = PresentTerminal; board.ExitRequested += Close;
            board.Bind(launch.Value.Bind(title));
            board.SetHostInputEnabled(!paused);
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

        private bool Current(long epoch) => this != null && HasRun && epoch == generation &&
            (campaign != null ? campaign.IsCurrent : flow.RunIdentityCurrent(run));
        private bool CurrentForeground(long epoch, long visit) => Current(epoch) &&
            visit == foregroundGeneration && !paused && isActiveAndEnabled;
        private bool Frozen() => run != null && now() >= run.DeadlineAt;
        private bool Terminal() => board?.State != null && (board.State.Phase == (byte)CorePhase.Finished ||
            board.State.Phase == (byte)CorePhase.LevelComplete);

        private void Update()
        {
            if (!HasRun) return;
            if (!Current(generation)) { Close(); return; }
            if (paused || !board.PresentationInitialized) return;
            if (campaign != null)
            {
                if (foregroundNeeded && !board.Busy) { foregroundNeeded = false; board.Pause(); }
                board.SetHostInputEnabled(!Terminal() && !board.RecoveryRequired);
                return;
            }
            if (foregroundNeeded)
            {
                board.SetHostInputEnabled(false);
                if (!board.Busy && !settling && !observing) _ = ObserveForeground();
                return;
            }
            if (Terminal() && !board.Busy && !board.RecoveryRequired && !observing && !settlementAttempted)
            { _ = Settle(); return; }
            if (Frozen() && !Terminal())
            {
                board.SetHostInputEnabled(false);
                if (!board.Busy && !observing && !frozenShown)
                {
                    frozenShown = true;
                    board.View.OpenModal("DAILY FROZEN", "New actions are closed. Check for your accepted result.",
                        ("Check result", () => { frozenShown = false; foregroundNeeded = true; }),
                        ("Back to my runs", Close));
                }
            }
            else if (!Terminal() && !observing && !board.RecoveryRequired)
                board.SetHostInputEnabled(true);
        }

        private void PresentTerminal(BoardController source, string title, string body)
        {
            if (source != board) return;
            terminalTitle = title; terminalBody = body;
            RenderTerminal();
        }
        private void RenderTerminal()
        {
            if (board?.View == null || terminalTitle == null) return;
            string receipt = ReceiptText(run?.LastReceiptOperation);
            string body = terminalBody + "\n\n" + (settled ? "Result saved." : settling || !settlementAttempted ?
                "Saving your result…" : settlementError ?? "Check settlement before continuing.") + receipt;
            if (settled) board.View.OpenModal(terminalTitle, body, ("Continue", Close));
            else if (settlementAttempted && !settling)
                board.View.OpenModal(terminalTitle, body, ("Retry settlement", () => _ = Settle()), ("Back to my runs", Close));
            else board.View.OpenModal(terminalTitle, body);
        }
        private async Task Settle()
        {
            if (!HasRun || settling || settled || board.Busy || board.RecoveryRequired || !Terminal()) return;
            long epoch = generation; settling = settlementAttempted = true; settlementError = null;
            board.SetHostInputEnabled(false); RenderTerminal();
            try
            {
                var expected = run;
                var state = await Execute(expected, token => flow.SettleRun(expected, token), lifetime.Token);
                if (!Current(epoch)) return;
                settled = state.Phase == "consumed";
                if (!settled) settlementError = "The result is still settling. Check again.";
            }
            catch (Exception)
            {
                if (Current(epoch)) settlementError = "Settlement could not be confirmed. Your accepted result is retained.";
            }
            finally
            {
                if (Current(epoch)) { settling = false; RenderTerminal(); }
            }
        }

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
                    if (state.Phase == "consumed" && Terminal()) { settled = true; RenderTerminal(); }
                    else board.RequireRecovery("This run is no longer playable here. Return to your runs to check its state.");
                    return;
                }
                await board.ObserveSnapshot(BoardActionResult.Snapshot(run.Binding.Accept(state)));
                if (!CurrentForeground(epoch, visit)) return;
                if (board.State.Phase == (byte)CorePhase.AwaitingVrf)
                {
                    board.RequireRecovery("The next row is pending. Recover this run to continue.");
                    return;
                }
                board.SetHostInputEnabled(!Frozen() && !Terminal());
                if (!Terminal() && !Frozen()) board.Pause();
            }
            catch (Exception)
            {
                if (CurrentForeground(epoch, visit)) board.RequireRecovery("The current run could not be checked. Recover before playing again.");
            }
            finally { if (Current(epoch)) observing = false; }
        }

        private static string ReceiptText(MoneyRunOperation operation)
        {
            if (operation == null || operation.Receipts.Count == 0) return "";
            return "\n\n" + MoneyReceiptText.Describe(operation.Receipts.Last().Result);
        }
        public void Suspend(bool value)
        {
            if (paused == value) return;
            paused = value; foregroundGeneration++;
            if (!HasRun) return;
            board.SetHostInputEnabled(false);
            if (value) board.Pause(); else foregroundNeeded = true;
        }
        private void OnApplicationPause(bool value) => Suspend(value);
        private void OnDisable()
        { foregroundGeneration++; if (HasRun) { board.SetHostInputEnabled(false); foregroundNeeded = true; } }
        private void OnEnable()
        { foregroundGeneration++; if (HasRun) foregroundNeeded = true; }
        public void Close()
        {
            if (!HasRun) return;
            if (Current(generation) && Terminal() && settled)
                ResultClosed?.Invoke(new ResultPageView { HasResult = true, ProductName = Application.productName,
                    Mode = board.Session.Daily ? "Daily" : "Campaign", Realm = board.Session.RealmId,
                    Day = run == null ? 0 : checked((uint)(run.DeadlineAt / 86400)),
                    ObjectiveKind = board.Session.Daily ? board.Session.Rules.ObjectiveKind : board.Session.Rules.PrimaryKind,
                    ObjectiveValue = board.Session.Daily ? board.Session.Rules.ObjectiveValue : board.Session.Rules.PrimaryValue,
                    Score = board.Session.Daily ? board.State.DailyScore : board.State.Score,
                    ObjectiveTotal = board.Session.Daily ? board.State.ObjectiveTotal : board.State.PrimaryProgress, ShowStars = !board.Session.Daily,
                    StarSources = board.State.LatchedStarSources, Notice = "Result saved." });
            generation++; run = null; campaign = null;
            var previous = board; board = null;
            try { lifetime?.Cancel(); }
            finally
            {
                lifetime?.Dispose(); lifetime = null;
                if (previous != null) { previous.SetHostInputEnabled(false); previous.gameObject.SetActive(false); Destroy(previous.gameObject); }
                Closed?.Invoke();
            }
        }
        private void OnDestroy() => Close();
    }
}
