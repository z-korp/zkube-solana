using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Client;
using ZKube.Integration.Client.Runs;

namespace ZKube.Integration.App
{
    public sealed class MoneyCampaignState
    {
        public CampaignProgress Progress { get; }
        public CampaignBrowseProjection Browse { get; }
        public SessionAssessment Session { get; }
        public RunClientState Run { get; }
        public bool PendingTransaction { get; }
        internal MoneyCampaignState(CampaignProgress progress, CampaignBrowseProjection browse, SessionAssessment session, RunClientState run, bool pending)
        { Progress = progress; Browse = browse; Session = session; Run = run; PendingTransaction = pending; }
    }
    public sealed partial class MoneyAppFlow
    {
        // Campaign browsing never resumes the journal. Use the existing owner
        // read gate/epoch, economy invalidation and shutdown drain.
        public Task<MoneyRead<MoneyCampaignState>> RefreshCampaign(CancellationToken cancellation = default) =>
            ReadOwnerProduct(cancellation, async (lease, token) => {
                var progress = await services.Products.Campaign(token).ConfigureAwait(false);
                token.ThrowIfCancellationRequested();
                var session = await services.SessionLifecycle.Inspect().ConfigureAwait(false);
                token.ThrowIfCancellationRequested();
                var run = await services.Runs.Inspect("campaign", token).ConfigureAwait(false);
                var pending = await services.Journal.Load(lease.Owner).ConfigureAwait(false);
                var projection = CampaignBrowseProjection.Create(progress.Value, run.Account, services.Accounts);
                return new MoneyCampaignState(progress.Value, projection, session, run, pending != null);
            });
    }
}
