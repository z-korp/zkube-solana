using System;
using ZKube.Core;
using ZKube.Integration.Client;
using System.Linq;
using System.Threading.Tasks;
using ZKube.Integration.App;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private MoneyBoardHost boardHost;
        // An Arcade run on its host, or a Campaign run on the run board.
        public bool PlayingRun => ArcadeRun || runBoard != null && runBoard.Playing;
        private bool ArcadeRun => boardHost != null && boardHost.HasRun;

        public void AttachRunHost(MoneyBoardHost host)
        {
            if (boardHost != null || Flow == null) throw new InvalidOperationException("Attach one host after initialization");
            boardHost = host ?? throw new ArgumentNullException(nameof(host));
            boardHost.Initialize(Flow, now);
            boardHost.ResultClosed += result => {
                result.PlayerName = identity.Owner;
                result.Streak = profileRead != null && profileRead.IsCurrent ? (uint?)profileRead.Value.Profile.Fields?["entry_streak_days"] : null;
                lastResult = result;
            };
            boardHost.ObservedOperation += operation => {
                if (detached || identity.Owner == null) return;
                foreach (var step in operation.Receipts)
                    if (step.Owner == identity.Owner) ShowReceipt(step.Result, step.Owner);
            };
            boardHost.Closed += ReturnFromRun;
        }

        private Task OpenRun(Func<Task<MoneyRead<MoneyRunLaunch>>> action) => sessionActionPending || economyActionPending ? Task.CompletedTask : Run(async (epoch, token) => {
            Status = "Opening your accepted run…";
            var result = await action();
            if (!Current(epoch) || !result.IsCurrent) return;
            foreach (var receipt in result.Value.Operation.Receipts)
                ShowReceipt(receipt.Result, receipt.Owner);
            if (!result.Value.CanBind)
            {
                await RefreshVisiblePage(epoch, token);
                if (Current(epoch)) Inform("Your run is not ready to open. Check its saved state before continuing.");
                return;
            }
            ulong best = profileRead != null && profileRead.IsCurrent ? (ulong)((uint?)profileRead.Value.Profile.Fields?["best_daily_score"] ?? 0) : 0;
            boardHost.Open(result.Value, textScale, best, Flow.DailyTop(NativeEngine.DayAt(result.Value.Run.DeadlineAt)));
            HidePages(); RetireArtwork();
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
