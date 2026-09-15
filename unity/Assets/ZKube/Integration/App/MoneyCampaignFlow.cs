using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Client;
using ZKube.Local;

namespace ZKube.Integration.App
{
    public sealed class MoneyCampaignState
    {
        public CampaignProgress Progress { get; }
        public CampaignBrowseProjection Browse { get; }
        public LocalRunView Run { get; }
        public bool RecordPending { get; }
        internal MoneyCampaignState(CampaignProgress progress, CampaignBrowseProjection browse, LocalRunView run, bool pending)
        { Progress = progress; Browse = browse; Run = run; RecordPending = pending; }
    }
    public sealed class MoneyCampaignRun
    {
        internal IdentityLease Identity { get; }
        public LocalRunClient Runs { get; }
        public LocalRunView View { get; }
        internal MoneyCampaignRun(IdentityLease identity, LocalRunClient runs, LocalRunView view)
        { Identity = identity; Runs = runs; View = view; }
    }
    public sealed partial class MoneyAppFlow
    {
        public bool CampaignIdentityCurrent(MoneyCampaignRun run) =>
            run != null && !stopped && services.Identity.IsCurrent(run.Identity);
        public void CampaignChanged(MoneyCampaignRun run)
        { if (CampaignIdentityCurrent(run) && run.Runs.Active("campaign") == null) services.SyncCampaign(run.Identity); }

        public Task<MoneyRead<MoneyCampaignState>> RefreshCampaign(CancellationToken cancellation = default) =>
            WithCampaign(cancellation, (lease, local) => {
                var progress = CampaignProgress.FromStars(lease.Owner, local.Product.Read.Stars);
                var run = local.Runs.Active("campaign");
                return new MoneyCampaignState(progress, CampaignBrowseProjection.Create(progress, run), run,
                    local.Product.Read.CampaignWritePending);
            });

        public Task<MoneyRead<MoneyCampaignRun>> StartCampaignRun(byte realm, byte level, CancellationToken cancellation = default) =>
            WithCampaign(cancellation, (lease, local) => {
                var progress = CampaignProgress.FromStars(lease.Owner, local.Product.Read.Stars);
                var browse = CampaignBrowseProjection.Create(progress, local.Runs.Active("campaign"));
                var trial = browse.Realms.SingleOrDefault(value => value.MapId == realm)?.Levels.SingleOrDefault(value => value.Level == level);
                if (trial == null || !trial.CanInspect) throw new InvalidOperationException("This Campaign trial is unavailable");
                var started = local.Runs.StartCampaign(realm, level);
                return new MoneyCampaignRun(lease, local.Runs, started.View);
            });

        public Task<MoneyRead<MoneyCampaignRun>> OpenSavedCampaign(CancellationToken cancellation = default) =>
            WithCampaign(cancellation, (lease, local) => {
                var run = local.Runs.Active("campaign") ?? throw new InvalidOperationException("No saved Campaign run");
                return new MoneyCampaignRun(lease, local.Runs, run);
            });

        private Task<MoneyRead<T>> WithCampaign<T>(CancellationToken cancellation, Func<IdentityLease, MoneyLocalCampaign, T> action) =>
            Track(() => {
                var lease = services.Identity.Lease();
                cancellation.ThrowIfCancellationRequested(); lifetime.Token.ThrowIfCancellationRequested();
                var value = action(lease, services.Campaign(lease.Owner));
                services.SyncCampaign(lease);
                return Task.FromResult(new MoneyRead<T>(value, () =>
                    !stopped && !cancellation.IsCancellationRequested && services.Identity.IsCurrent(lease)));
            });
    }
}
