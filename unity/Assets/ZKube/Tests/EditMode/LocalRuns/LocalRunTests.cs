using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core;

namespace ZKube.Local.Tests
{
    public sealed class LocalRunTests
    {
        [TestCase(false)]
        [TestCase(true)]
        public void campaign_seed_is_fresh_per_attempt_and_replays_on_resume(bool money)
        {
            var disk = new System.Collections.Generic.Dictionary<string, string>();
            LocalProductStore Open() => new LocalProductStore(key => disk.TryGetValue(key, out var value) ? value : null,
                (key, value) => disk[key] = value, money ? "player-address" : null);
            var store = Open();
            var runs = new LocalRunClient(store, () => 0);
            var first = runs.StartCampaign(1, 1);
            var firstSeed = Open().Read.CampaignRun.Seed.ToArray();
            Assert.That(firstSeed.Length, Is.EqualTo(32));
            Assert.That(Open().Read.CampaignRun.Actions, Is.Empty);
            Assert.That(NativeEngine.Summary(first.View.Token).BonusCharges, Is.Zero);
            runs.Act(first.View.RunId, first.View.Token, new LocalRunAction(LocalActionKind.Finish));
            var second = runs.StartCampaign(1, 1);
            var secondSeed = Open().Read.CampaignRun.Seed.ToArray();
            Assert.That(secondSeed.Length, Is.EqualTo(32));
            CollectionAssert.AreNotEqual(firstSeed, secondSeed);
            Assert.That(Open().Read.CampaignRun.Actions, Is.Empty);
            var restored = new LocalRunClient(Open(), () => 86400,
                campaignSeed: () => throw new InvalidOperationException("Resume uses the saved randomness"));
            var resumed = restored.Active("campaign");
            CollectionAssert.AreEqual(second.View.Token.Config, resumed.Token.Config);
            CollectionAssert.AreEqual(second.View.Token.State, resumed.Token.State);
            CollectionAssert.AreEqual(secondSeed, Open().Read.CampaignRun.Seed);
        }

        [Test]
        public async Task campaign_record_enable_during_pending_attempt_retains_the_retry()
        {
            var store = new LocalProductStore(owner: "player-address");
            var runs = new LocalRunClient(store, () => 0);
            var stars = new byte[25]; stars[0] = 1; runs.MergeCampaignRecord(stars);
            var entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            int writes = 0;
            var sync = new CampaignRecordSync(store, runs, _ => Task.FromResult(new byte[25]), async (submitted, token) => {
                if (++writes == 1) { entered.TrySetResult(true); await release.Task; return false; }
                return true;
            });
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
            var store = Open(); var runs = new LocalRunClient(store, () => 0);
            var first = new byte[25]; first[0] = 1;
            runs.MergeCampaignRecord(first);
            var unavailable = new CampaignRecordSync(store, runs, _ => Task.FromResult(new byte[25]),
                (stars, token) => Task.FromResult(false));
            unavailable.Start(CancellationToken.None); await unavailable.Pending;
            Assert.That(Open().Read.CampaignWritePending, Is.True);
            store = Open(); runs = new LocalRunClient(store, () => 0);
            var retry = new CampaignRecordSync(store, runs, _ => Task.FromResult(new byte[25]), (submitted, token) => {
                CollectionAssert.AreEqual(first, submitted);
                var newer = new byte[25]; newer[24] = 192;
                runs.MergeCampaignRecord(newer);
                return Task.FromResult(true);
            });
            retry.Start(CancellationToken.None); await retry.Pending;
            Assert.That(Open().Read.CampaignWritePending, Is.True);
            Assert.That(Open().Read.Stars[0], Is.EqualTo(1));
            Assert.That(Open().Read.Stars[99], Is.EqualTo(3));
            var final = runs.PackedCampaignStars();
            var merged = new CampaignRecordSync(store, runs, _ => Task.FromResult(final),
                (stars, token) => throw new InvalidOperationException("Already synchronized"));
            merged.Start(CancellationToken.None); await merged.Pending;
            Assert.That(merged.LastError, Is.Null);
            Assert.That(Open().Read.CampaignWritePending, Is.False);
        }

        [TestCase(false)]
        [TestCase(true)]
        public void local_campaign_run_survives_process_death(bool money)
        {
            var disk = new System.Collections.Generic.Dictionary<string, string>();
            string owner = money ? "player-address" : null;
            LocalProductStore Open() => new LocalProductStore(key => disk.TryGetValue(key, out var value) ? value : null,
                (key, value) => disk[key] = value, owner);
            var store = Open();
            var runs = new LocalRunClient(store, () => 0);
            var first = runs.StartCampaign(1, 1);
            var accepted = runs.Act(first.View.RunId, first.View.Token, new LocalRunAction(LocalActionKind.Reroll));
            Assert.That(store.Read.CampaignRun.Actions.Count, Is.EqualTo(1));
            var reopened = Open();
            var restored = new LocalRunClient(reopened, () => 86400);
            var resumed = restored.Active("campaign");
            CollectionAssert.AreEqual(accepted.View.Token.Config, resumed.Token.Config);
            CollectionAssert.AreEqual(accepted.View.Token.State, resumed.Token.State);
            Assert.Throws<InvalidOperationException>(() => restored.StartCampaign(1, 2));
            restored.Act(resumed.RunId, resumed.Token, new LocalRunAction(LocalActionKind.Finish));
            Assert.That(new LocalRunClient(Open(), () => 86400).Active("campaign"), Is.Null);
            if (money)
            {
                var other = new LocalProductStore(key => disk.TryGetValue(key, out var value) ? value : null,
                    (key, value) => disk[key] = value, "another-address");
                Assert.That(other.Read.CampaignRun, Is.Null);
                Assert.That(other.Read.Stars.All(stars => stars == 0), Is.True);
            }
        }

        [Test]
        public void campaign_action_is_accepted_only_after_durable_write()
        {
            string saved = null; bool fail = false;
            var store = new LocalProductStore(_ => saved, (_, value) => { if (fail) throw new IOException("disk-full"); saved = value; });
            var runs = new LocalRunClient(store, () => 0);
            var first = runs.StartCampaign(1, 1);
            string before = saved; fail = true;
            Assert.Throws<IOException>(() => runs.Act(first.View.RunId, first.View.Token, new LocalRunAction(LocalActionKind.Reroll)));
            CollectionAssert.AreEqual(first.View.Token.State, runs.Active("campaign").Token.State);
            Assert.That(saved, Is.EqualTo(before));
            fail = false;
            var accepted = runs.Act(first.View.RunId, first.View.Token, new LocalRunAction(LocalActionKind.Reroll));
            var restored = new LocalRunClient(new LocalProductStore(_ => saved), () => 0);
            CollectionAssert.AreEqual(accepted.View.Token.State, restored.Active("campaign").Token.State);
        }

        [Test]
        public void store_gate_is_a_store_identity_policy_over_shared_progression()
        {
            var state = new LocalProductState { Stars = Enumerable.Repeat((byte)3, 100).ToArray() };
            var store = new LocalProductStore(_ => LocalProductCodec.Encode(state));
            var money = new LocalRunClient(store, () => 0);
            var paidStore = new LocalRunClient(store, () => 0, StoreCampaignPolicy.PurchaseGate(store));
            Assert.That(money.CampaignLock(4), Is.Null);
            Assert.That(paidStore.CampaignLock(4), Is.EqualTo("purchase"));
            Assert.That(paidStore.CampaignLock(3), Is.Null);
            paidStore.ApplyCampaignEntitlement(true, "$1");
            Assert.That(paidStore.CampaignLock(4), Is.Null);
            store.WriteCampaign(current => { var next = LocalProductCodec.Decode(LocalProductCodec.Encode(current)); next.Stars[29] = 0; return next; });
            Assert.That(money.CampaignLock(4), Is.EqualTo("stars"));
            Assert.That(paidStore.CampaignLock(4), Is.EqualTo("stars"));
        }

    }
}
