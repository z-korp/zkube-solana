using ZKube.Core.Generated;
using System;
using ZKube.Core;
using ZKube.Integration.Client;
using System.Linq;
using System.Threading.Tasks;
using ZKube.Integration.App;
using ZKube.Integration.Execution;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private MoneyBoardHost boardHost;
        // An Arena run on its host's board, or a Campaign run on the run board.
        public bool PlayingRun => ArcadeRun || runBoard != null && runBoard.Playing;
        private bool ArcadeRun => boardHost != null && boardHost.Playing;
        // The host still holds an ended run whose result is not saved.
        private bool SavingResult => boardHost != null && boardHost.HasRun && !boardHost.Playing && !boardHost.Saved;

        public void AttachRunHost(MoneyBoardHost host)
        {
            if (boardHost != null || Flow == null) throw new InvalidOperationException("Attach one host after initialization");
            boardHost = host ?? throw new ArgumentNullException(nameof(host));
            boardHost.Initialize(Flow, now);
            // A run that ended opens the shared result page, as a Realms run does;
            // its result is saved behind that page, which says how that stands.
            boardHost.Finished += result => {
                if (detached) return;
                result.PlayerName = identity.Owner;
                lastResult = result;
                CloseProductViews(); sharedPage = AppPage.Result;
                if (paused || !isActiveAndEnabled) return;
                shell.Show(true); Present(); ReadSavedStreak();
            };
            boardHost.SaveChanged += () => {
                if (detached || lastResult == null || !boardHost.HasRun) return;
                lastResult.Notice = boardHost.SaveNotice;
                if (sharedPage == AppPage.Result) Present();
                ReadSavedStreak();
            };
            boardHost.ObservedOperation += operation => {
                if (detached || identity.Owner == null) return;
                foreach (var step in operation.Receipts)
                    if (step.Owner == identity.Owner) ShowReceipt(step.Result, step.Owner);
            };
            boardHost.Closed += ReturnFromRun;
        }

        // The run being entered or opened, as the Daily card's button says it until the board takes the screen.
        private string opening;
        // The Daily as the chain last confirmed it when the entry was tapped: the card keeps showing it,
        // Kredit figure included, while the entry's own looks retire the page's read.
        private MoneyDailyState enteringFrom;
        // A fresh entry changed the streak after the lobby was read: the result
        // page reads it once its result is saved, whichever comes first.
        private void ReadSavedStreak()
        { if (boardHost.Saved && lastResult != null && lastResult.Streak == null && sharedPage == AppPage.Result) _ = ReadResultStreak(); }
        private const int RunLooks = 10;
        private TimeSpan runLookEvery = TimeSpan.FromMilliseconds(500);
        private Task ReadResultStreak() => Run(async (epoch, token) => {
            var read = await Flow.RefreshDaily(token);
            if (!Current(epoch) || lastResult == null || lastResult.Day != read.Value.Lobby.DayId) return;
            lastResult.Streak = (uint?)read.Value.Lobby.Profile.Fields?["entry_streak_days"];
            if (sharedPage == AppPage.Result) Present();
        });
        // entered: the run is entered by this action, so the lobby's streak is from before it.
        private Task OpenRun(Func<Task<MoneyRead<MoneyRunLaunch>>> action, string word, bool entered) => sessionActionPending || economyActionPending ? Task.CompletedTask : Run(async (epoch, token) => {
            // The best to beat and the day's streak are the lobby's, taken before the run opens.
            enteringFrom = dailyRead != null && dailyRead.TryValue(out var lobby) ? lobby : null;
            var profile = enteringFrom?.Lobby.Profile.Fields;
            Status = "Opening your accepted run…";
            // A run whose result was left unsaved is let go: opening it saves it again.
            boardHost.Close();
            opening = word; Present();
            MoneyRead<MoneyRunLaunch> result;
            // What follows draws the page again when the run does not open; an opened board takes the screen.
            try
            {
                result = await action();
                // An entry still on its way is followed here, on the button that was tapped, to its
                // outcome. Confirmed, its run opens. Failed or never landed, the card says so and offers
                // the entry again. Still unconfirmed after a whole round, the page follows it as any other.
                var sent = entered && Current(epoch) && result.IsCurrent ? result.Value.Operation.Receipts.LastOrDefault()?.Result : null;
                if (sent != null && sent.Outcome == ExecutionOutcome.Pending)
                {
                    ShowReceipt(sent, identity.Owner);
                    var outcome = await Follow(sent, epoch, token);
                    if (!Current(epoch)) return;
                    ShowReceipt(outcome, identity.Owner);
                    if (outcome.Outcome != ExecutionOutcome.ConfirmedSuccess)
                    {
                        if (outcome.Outcome == ExecutionOutcome.Pending && waitedOut) Slow();
                        await RefreshVisiblePage(epoch, token);
                        if (Current(epoch) && MoneyReceiptText.Refusal(outcome) is string reason) Inform(reason);
                        return;
                    }
                    // Entered: the run reaches its rollup within a moment.
                    for (int look = 0; ; look++)
                    {
                        result = await Flow.OpenSavedRun();
                        if (!Current(epoch) || !result.IsCurrent) return;
                        if (result.Value.CanBind || look == RunLooks) break;
                        await Task.Delay(runLookEvery, token);
                    }
                }
            }
            finally { opening = null; enteringFrom = null; }
            if (!Current(epoch) || !result.IsCurrent) return;
            foreach (var receipt in result.Value.Operation.Receipts)
                ShowReceipt(receipt.Result, receipt.Owner);
            if (!result.Value.CanBind)
            {
                await RefreshVisiblePage(epoch, token);
                if (Current(epoch)) Inform(Words.ArenaRunNotReady);
                return;
            }
            boardHost.Open(result.Value, injectedScale, (uint?)profile?["best_daily_score"], Flow.DailyTop(NativeEngine.DayAt(result.Value.Run.DeadlineAt)),
                entered ? null : (uint?)profile?["entry_streak_days"]);
            HidePages(boardHost.Board);
        });

        private void ReturnFromRun()
        {
            if (detached || paused || !isActiveAndEnabled) return;
            shell.Show(true);
            if (identity.Owner == null) { CloseProductViews(); }
            _ = RefreshOverview();
        }

    }
}
