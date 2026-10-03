using System;
using ZKube.Local;
using ZKube.Presentation;

namespace ZKube.Integration.App
{
    public sealed partial class MoneyAppFlow
    {
        // The connected address's Campaign: its play record on this device, played
        // by the shared journey. Its runs stop with the address, and each durable
        // result starts the background write of its stars.
        public CampaignJourney Campaign(Action<AppPage> show, Action<LocalBoardActionProvider> openBoard)
        {
            if (stopped) throw new ObjectDisposedException(nameof(MoneyAppFlow));
            var lease = services.Identity.Lease();
            var local = services.Campaign(lease.Owner);
            services.SyncCampaign(lease);
            return new CampaignJourney(local.Product, local.Runs, show, openBoard,
                () => !stopped && services.Identity.IsCurrent(lease), () => services.SyncCampaign(lease));
        }
    }
}
