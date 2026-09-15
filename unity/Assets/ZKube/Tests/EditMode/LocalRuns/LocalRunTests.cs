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

        private static JObject Fixture => JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath,
            "../../fixtures/unity-local-runs-v1.json"
        ))));
        public static IEnumerable Cases() { foreach (var item in Fixture["cases"]) yield return new TestCaseData((string)item["name"]); }
        [TestCaseSource(nameof(Cases))]
        public void ActualBackendTrajectoryAndDecisions(string name)
        {
            var fixture = Fixture["cases"].Single(item => (string)item["name"] == name);
            string saved = fixture["initial"].ToString(); bool failWrites = false; int writes = 0; long now = (long)fixture["now"];
            LocalProductStore store = null; LocalRunClient client = null;
            void Restart() { store = new LocalProductStore(_ => saved, (_, value) => { if (failWrites) throw new IOException("disk-full"); saved = value; writes++; }); client = new LocalRunClient(store, () => now, StoreCampaignPolicy.PurchaseGate(store), () => Enumerable.Repeat((byte)0x5a, 32).ToArray()); }
            Restart();
            int index = 0;
            foreach (var step in fixture["steps"])
            {
                var command = step["command"]; string kind = (string)command["kind"]; LocalRunUpdate result = null; bool rejected = false;
                try
                {
                    switch (kind)
                    {
                        case "campaign": result = client.StartCampaign((byte)command["realm"], (byte)command["level"]); break;
                        case "daily": result = client.StartDaily(); break;
                        case "time": now = (long)command["now"]; break;
                        case "storage": failWrites = (bool)command["fail"]; break;
                        case "restart": Restart(); break;
                        case "billing": if ((bool)command["fail"]) throw new IOException("billing-offline"); client.ApplyCampaignEntitlement((bool)command["owned"], (string)command["price"]); break;
                        case "act": result = client.Act((string)command["id"], Action(command["action"])); break;
                        default: Assert.Fail("Unknown command " + kind); break;
                    }
                }
                catch (Exception error) when (error is NativeEngineException || error is InvalidOperationException || error is IOException || error is ArgumentException) { rejected = true; }
                string label = name + " step " + index++ + " " + kind;
                Assert.That(rejected, Is.EqualTo((bool)step["rejected"]), label);
                AssertView(result?.View, step["result"], label);
                AssertView(client.Active("campaign"), step["campaign"], label);
                AssertView(client.Active("arcade"), step["daily"], label);
                Assert.That(JToken.DeepEquals(JObject.Parse(saved), step["persisted"]), Is.True, label + " persistence");
                Assert.That(writes, Is.EqualTo((int)step["writes"]), label + " writes");
                var today = client.Today();
                Assert.That(today.DayId, Is.EqualTo((uint)step["today"]["dayId"]), label);
                Assert.That(today.Realm, Is.EqualTo((byte)step["today"]["realm"]), label);
                Assert.That(today.ObjectiveKind, Is.EqualTo((byte)step["today"]["kind"]), label);
                Assert.That(today.ObjectiveValue, Is.EqualTo((byte)step["today"]["value"]), label);
                Assert.That(today.OpensAt, Is.EqualTo((long)step["today"]["opensAt"]), label);
                Assert.That(today.FreezesAt, Is.EqualTo((long)step["today"]["freezesAt"]), label);
                if (result != null)
                {
                    var accepted = result.Transitions.Last();
                    CollectionAssert.AreEqual(result.View.Token.State, accepted.Token.State, label + " accepted transition");
                    var original = result.View.Token.State; result.View.Token.State[0] ^= 1; accepted.Token.State[0] ^= 1;
                    CollectionAssert.AreEqual(original, result.View.Token.State, label + " view isolation");
                    CollectionAssert.AreEqual(original, result.Transitions.Last().Token.State, label + " transition isolation");
                }
            }
        }
        private static LocalRunAction Action(JToken action)
        {
            switch ((string)action["_tag"])
            {
                case "Move": return new LocalRunAction(LocalActionKind.Move, (byte)action["row"], (byte)action["start"], (byte)action["destination"]);
                case "Bonus": return new LocalRunAction(LocalActionKind.Bonus, (byte)action["row"], (byte)action["column"]);
                case "Reroll": return new LocalRunAction(LocalActionKind.Reroll);
                case "Finish": return new LocalRunAction(LocalActionKind.Finish);
                default: throw new ArgumentException("Unknown action");
            }
        }
        private static void AssertView(LocalRunView actual, JToken expected, string label)
        {
            if (expected.Type == JTokenType.Null) { Assert.That(actual, Is.Null, label); return; }
            Assert.That(actual, Is.Not.Null, label); Assert.That(actual.RunId, Is.EqualTo((string)expected["id"]), label);
            Assert.That(actual.Mode, Is.EqualTo((string)expected["mode"]), label);
            Assert.That(string.Concat(actual.Token.State.Select(value => value.ToString("x2"))), Is.EqualTo((string)expected["tokenHex"]), label);
        }
    }
}
