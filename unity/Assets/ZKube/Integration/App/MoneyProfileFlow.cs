using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;

namespace ZKube.Integration.App
{
    public sealed class MoneyProfileState
    {
        public CampaignProgress Campaign { get; }
        public PlayerProfile Profile => Campaign.Player;
        public MoneyProfileIdentity Identity { get; }
        public SessionAssessment Session { get; }
        public PendingTransaction Pending { get; }
        public ExecutionResult PreviousOperation { get; }
        internal MoneyProfileState(CampaignProgress campaign, SessionAssessment session,
            PendingTransaction pending, ExecutionResult previous)
        { Campaign = campaign; Identity = new MoneyProfileIdentity(campaign); Session = session; Pending = pending; PreviousOperation = previous; }
    }
    public sealed partial class MoneyAppFlow
    {
        // A profile visit is read-only. Pending writes require the explicit
        // receipt check, and a failed read never replaces the signed receipt.
        public async Task<MoneyRead<MoneyProfileState>> RefreshProfile(CancellationToken cancellation = default)
        {
            var read = await ReadOwnerProduct(cancellation, async (lease, token) => {
                var campaign = await services.Products.Campaign(token).ConfigureAwait(false);
                token.ThrowIfCancellationRequested();
                var session = await services.SessionLifecycle.Inspect().ConfigureAwait(false);
                token.ThrowIfCancellationRequested();
                var pending = await services.Journal.Load(lease.Owner).ConfigureAwait(false);
                return new MoneyProfileState(campaign.Value, session, pending, ReadOwnerOperation(out _));
            }).ConfigureAwait(false);
            var value = read.Value;
            return new MoneyRead<MoneyProfileState>(value, () => read.IsCurrent && CurrentOwnerOperation(value.PreviousOperation));
        }
    }
}
