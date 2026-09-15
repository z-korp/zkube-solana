using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using ZKube.Integration.Client;
using ZKube.Integration.Transport;
using ZKube.Local;

namespace ZKube.Integration.App
{
    public sealed class MoneyLocalCampaign
    {
        public LocalProductStore Product { get; }
        public LocalRunClient Runs { get; }
        internal CampaignRecordSync Sync { get; }
        internal MoneyLocalCampaign(LocalProductStore product, Func<long> now,
            Func<CancellationToken, Task<byte[]>> read, Func<byte[], CancellationToken, Task<bool>> write)
        { Product = product; Runs = new LocalRunClient(product, now); Sync = new CampaignRecordSync(product, Runs, read, write); }
    }

    public sealed partial class MoneyClientServices
    {
        private readonly object campaignGate = new object();
        private readonly CancellationTokenSource campaignStop = new CancellationTokenSource();
        private readonly Dictionary<string, MoneyLocalCampaign> campaigns = new Dictionary<string, MoneyLocalCampaign>();
        private Func<string, LocalProductStore> campaignStore;
        private Func<long> campaignClock;
        public Exception CampaignSyncError { get; private set; }

        public MoneyLocalCampaign Campaign(string owner)
        {
            if (string.IsNullOrWhiteSpace(owner)) throw new InvalidOperationException("Connect an address to play Campaign");
            SolanaAddress.Bytes(owner);
            lock (campaignGate)
            {
                if (campaigns.TryGetValue(owner, out var existing)) return existing;
                var product = campaignStore(owner);
                if (product.Owner != owner) throw new InvalidOperationException("Campaign storage belongs to another address");
                var local = new MoneyLocalCampaign(product, campaignClock,
                    async token => {
                        var read = await Rpc.ReadAccount(Rpc.Base, Planner.Player(owner), cancellation: token).ConfigureAwait(false);
                        return read.Envelope == null ? new byte[25] : Accounts.PlayerState(read.Envelope, owner)["campaign_stars"].Values<byte>().ToArray();
                    }, (stars, token) => WriteCampaignRecord(owner, stars, token));
                campaigns.Add(owner, local);
                return local;
            }
        }
        internal void SyncCampaign(IdentityLease lease)
        {
            try { if (Identity.IsCurrent(lease) && !campaignStop.IsCancellationRequested) Campaign(lease.Owner).Sync.Start(lease.Cancellation, campaignStop.Token); }
            catch (Exception error) { CampaignSyncError = error; }
        }
        private async Task<bool> WriteCampaignRecord(string owner, byte[] stars, CancellationToken cancellation)
        {
            var identity = Identity.Lease();
            if (identity.Owner != owner) return false;
            using var device = await SessionAccess.Load(identity).ConfigureAwait(false);
            var plan = Planner.RecordCampaignStars(device.Actor, stars);
            var lease = await Rpc.LatestBlockhash(Rpc.Base, cancellation).ConfigureAwait(false);
            var message = plan.CompileMessage(lease.Blockhash);
            var fee = await Rpc.FeeForMessage(Rpc.Base, message, cancellation).ConfigureAwait(false);
            var balance = await Rpc.Balance(Rpc.Base, plan.FeePayer, cancellation).ConfigureAwait(false);
            var rent = await Rpc.RentFloor(Rpc.Base, 0, cancellation).ConfigureAwait(false);
            plan.RequireDeviceFunding(balance, rent, fee);
            if (!Identity.IsCurrent(identity)) return false;
            cancellation.ThrowIfCancellationRequested();
            var transaction = device.Signer.PartialSign(SolanaWire.UnsignedTransaction(message));
            var simulation = await Rpc.Simulate(Rpc.Base, transaction, lease, cancellation).ConfigureAwait(false);
            if (!simulation.Succeeded || !Identity.IsCurrent(identity)) return false;
            // Only this cosmetic maximum merge uses a durable play-record intent.
            // It has no transaction journal entry or shared executor lock.
            var signature = await Rpc.Send(Rpc.Base, transaction, RpcSubmissionPolicy.Wallet, lease, cancellation).ConfigureAwait(false);
            var status = await Rpc.SignatureStatus(Rpc.Base, signature, cancellation).ConfigureAwait(false);
            return status.ErrorJson == null && (status.Confirmation == RpcConfirmation.Confirmed || status.Confirmation == RpcConfirmation.Finalized);
        }
        internal Task DrainCampaignSync()
        {
            campaignStop.Cancel();
            lock (campaignGate) return Task.WhenAll(campaigns.Values.Select(value => value.Sync.Pending));
        }
    }
}
