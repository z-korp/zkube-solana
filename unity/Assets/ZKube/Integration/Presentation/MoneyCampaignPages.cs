using System;
using System.Threading.Tasks;
using ZKube.Integration.Client;
using ZKube.Local;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    // The Campaign tab: the shared journey over the connected address's play
    // record, drawn on the shared pages and played on the one run board.
    public sealed partial class MoneyAppAdapter
    {
        private CampaignJourney campaign;
        private IdentityLease campaignLease;
        private AppPage? campaignPage;
        private RunBoard runBoard;
        public bool BrowsingCampaign => campaignPage != null;
        public byte SelectedRealm => campaign?.Realm ?? 0;
        public byte SelectedTrial => campaignPage == AppPage.Level ? campaign.Level : (byte)0;
        public RunBoard CampaignBoard => runBoard;

        public Task OpenCampaign()
        {
            if (!PageAvailable() || identity.Owner == null) return Task.CompletedTask;
            try { Journey().Map(); }
            catch (Exception error) { ShowError(error); }
            return Task.CompletedTask;
        }
        // The journey of the connected address; another address starts its own.
        private CampaignJourney Journey()
        {
            if (campaign != null && identity.IsCurrent(campaignLease)) return campaign;
            campaignLease = identity.Lease();
            return campaign = Flow.Campaign(ShowCampaign, PlayCampaign);
        }
        private void ShowCampaign(AppPage page)
        {
            CloseSharedView(); CloseSessionView(); CloseDailyView(); CloseKreditView(); CloseRewardView(); CloseProfileView();
            browsingOperation = false; failure = null; info = null;
            campaignPage = page; shell.Show(true); Present();
        }
        private void PlayCampaign(LocalBoardActionProvider provider)
        {
            if (runBoard == null) { runBoard = gameObject.AddComponent<RunBoard>(); runBoard.Initialize(); }
            var journey = campaign;
            runBoard.Open(provider.Bind(), () => journey.Unsaved, journey.Finished, journey.Left, journey.FirstRun);
            HidePages();
        }
        private void CloseCampaignView() { campaignPage = null; campaign?.Forget(); }
        // A changed address ends the journey, and its run's board with it.
        private void RefreshCampaignIdentity()
        {
            if (campaign == null || identity.IsCurrent(campaignLease)) return;
            runBoard?.Close(); campaign = null;
            if (campaignPage != null) { campaignPage = null; Present(); }
        }
        public CampaignPageView CampaignView() => campaign.CampaignView();
        public LevelPageView LevelPage() => campaign.LevelPage();
    }
}
