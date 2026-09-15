using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using ZKube.Local;
namespace ZKube.Integration.App.Tests
{
    public sealed class CampaignRecordSyncTests
    {
        [Test]
        public async Task campaign_record_enable_during_pending_attempt_retains_the_retry()
        {
            var store = new LocalProductStore(owner: "player-address");
            var runs = new LocalRunClient(store);
            var stars = new byte[25]; stars[0] = 1;
            var entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            int writes = 0;
            var sync = new CampaignRecordSync(store, runs, _ => Task.FromResult(new byte[25]), async (submitted, token) => {
                if (++writes == 1) { entered.TrySetResult(true); await release.Task; return false; }
                return true;
            });
            sync.MergeCampaignRecord(stars);
            sync.Start(CancellationToken.None); await entered.Task;
            sync.Start(CancellationToken.None); release.TrySetResult(true);
            await sync.Pending;
            Assert.That(writes, Is.EqualTo(2));
            Assert.That(store.Read.CampaignWritePending, Is.False);
        }

        [Test]
        public async Task campaign_record_retry_survives_restart_and_preserves_newer_stars()
        {
            string disk = null;
            LocalProductStore Open() => new LocalProductStore(_ => disk, (_, value) => disk = value, "player-address");
            var store = Open(); var runs = new LocalRunClient(store);
            var first = new byte[25]; first[0] = 1;
            var unavailable = new CampaignRecordSync(store, runs, _ => Task.FromResult(new byte[25]),
                (stars, token) => Task.FromResult(false));
            unavailable.MergeCampaignRecord(first);
            unavailable.Start(CancellationToken.None); await unavailable.Pending;
            Assert.That(Open().Read.CampaignWritePending, Is.True);
            store = Open(); runs = new LocalRunClient(store);
            CampaignRecordSync retry = null;
            retry = new CampaignRecordSync(store, runs, _ => Task.FromResult(new byte[25]), (submitted, token) => {
                CollectionAssert.AreEqual(first, submitted);
                var newer = new byte[25]; newer[24] = 192;
                retry.MergeCampaignRecord(newer);
                return Task.FromResult(true);
            });
            retry.Start(CancellationToken.None); await retry.Pending;
            Assert.That(Open().Read.CampaignWritePending, Is.True);
            Assert.That(Open().Read.Stars[0], Is.EqualTo(1));
            Assert.That(Open().Read.Stars[99], Is.EqualTo(3));
            var final = retry.PackedCampaignStars();
            var merged = new CampaignRecordSync(store, runs, _ => Task.FromResult(final),
                (stars, token) => throw new InvalidOperationException("Already synchronized"));
            merged.Start(CancellationToken.None); await merged.Pending;
            Assert.That(merged.LastError, Is.Null);
            Assert.That(Open().Read.CampaignWritePending, Is.False);
        }

    }
}
