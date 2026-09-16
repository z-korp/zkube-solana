using ZKube.Local;
using System;
using ZKube.Integration.Client;
using System.Linq;
using System.Threading.Tasks;
using ZKube.Integration.App;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private MoneyBoardHost boardHost;
        public bool PlayingRun => boardHost != null && boardHost.HasRun;

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

        public Task StartSelectedTrial()
        {
            if (!CanBrowse() || browseLevel == 0 || boardHost == null) return Task.CompletedTask;
            byte realm = browseRealm, trial = browseLevel;
            return OpenLocalCampaign(() => Flow.StartCampaignRun(realm, trial), "Trial " + trial);
        }
        public Task ResumeCampaignRun() => boardHost == null ? Task.CompletedTask :
            OpenLocalCampaign(() => Flow.OpenSavedCampaign(), "Campaign");

        private Task OpenLocalCampaign(Func<Task<MoneyRead<LocalBoardActionProvider>>> action, string title) => RunCampaign(async (epoch, token) => {
            var result = await action();
            if (!Current(epoch) || !result.IsCurrent) return;
            boardHost.Open(result, title, textScale);
            RetireArtwork(); root.SetActive(false);
        });

        private Task OpenRun(Func<Task<MoneyRead<MoneyRunLaunch>>> action, string title) => sessionActionPending || economyActionPending ? Task.CompletedTask : Run(async (epoch, token) => {
            status.text = "Opening your accepted run…";
            var result = await action();
            if (!Current(epoch) || !result.IsCurrent) return;
            foreach (var receipt in result.Value.Operation.Receipts)
                ShowReceipt(receipt.Result, receipt.Owner);
            if (!result.Value.CanBind)
            {
                await RefreshVisiblePage(epoch, token);
                if (Current(epoch)) status.text = "Your run is not ready to open. Check its saved state before continuing.";
                return;
            }
            boardHost.Open(result.Value, title, textScale);
            RetireArtwork(); root.SetActive(false);
        });

        private void ReturnFromRun()
        {
            if (detached || paused || !isActiveAndEnabled) return;
            root.SetActive(true);
            if (identity.Owner == null) { CloseProductViews(); }
            _ = RefreshOverview();
        }

    }
}
