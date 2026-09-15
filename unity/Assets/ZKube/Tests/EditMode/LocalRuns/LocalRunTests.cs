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
using ZKube.Local.App;

namespace ZKube.Local.Tests
{
    public sealed class LocalRunTests
    {
        private static LocalRunClient Create(LocalProductStore store, bool money, Func<byte[]> campaignSeed = null) =>
            money ? new LocalRunClient(store, campaignSeed: campaignSeed) : new StoreRunClient(store, () => 0, campaignSeed);

        [TestCase(false)]
        [TestCase(true)]
        public void campaign_seed_is_fresh_per_attempt_and_replays_on_resume(bool money)
        {
            var disk = new System.Collections.Generic.Dictionary<string, string>();
            LocalProductStore Open() => new LocalProductStore(key => disk.TryGetValue(key, out var value) ? value : null,
                (key, value) => disk[key] = value, money ? "player-address" : null);
            var store = Open();
            var runs = Create(store, money);
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
            var restored = Create(Open(), money,
                campaignSeed: () => throw new InvalidOperationException("Resume uses the saved randomness"));
            var resumed = restored.Active("campaign");
            CollectionAssert.AreEqual(second.View.Token.Config, resumed.Token.Config);
            CollectionAssert.AreEqual(second.View.Token.State, resumed.Token.State);
            CollectionAssert.AreEqual(secondSeed, Open().Read.CampaignRun.Seed);
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
            var runs = Create(store, money);
            var first = runs.StartCampaign(1, 1);
            var accepted = runs.Act(first.View.RunId, first.View.Token, new LocalRunAction(LocalActionKind.Reroll));
            Assert.That(store.Read.CampaignRun.Actions.Count, Is.EqualTo(1));
            var reopened = Open();
            var restored = Create(reopened, money);
            var resumed = restored.Active("campaign");
            CollectionAssert.AreEqual(accepted.View.Token.Config, resumed.Token.Config);
            CollectionAssert.AreEqual(accepted.View.Token.State, resumed.Token.State);
            Assert.Throws<InvalidOperationException>(() => restored.StartCampaign(1, 2));
            restored.Act(resumed.RunId, resumed.Token, new LocalRunAction(LocalActionKind.Finish));
            Assert.That(Create(Open(), money).Active("campaign"), Is.Null);
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
            var runs = new LocalRunClient(store);
            var first = runs.StartCampaign(1, 1);
            string before = saved; fail = true;
            Assert.Throws<IOException>(() => runs.Act(first.View.RunId, first.View.Token, new LocalRunAction(LocalActionKind.Reroll)));
            CollectionAssert.AreEqual(first.View.Token.State, runs.Active("campaign").Token.State);
            Assert.That(saved, Is.EqualTo(before));
            fail = false;
            var accepted = runs.Act(first.View.RunId, first.View.Token, new LocalRunAction(LocalActionKind.Reroll));
            var restored = new LocalRunClient(new LocalProductStore(_ => saved));
            CollectionAssert.AreEqual(accepted.View.Token.State, restored.Active("campaign").Token.State);
        }


    }
}
