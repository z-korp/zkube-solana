using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Integration.App.Evidence;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneyProfileIdentityTests
    {
        private static readonly Lazy<JObject> FixtureData = new Lazy<JObject>(() => JObject.Parse(File.ReadAllText(
            Environment.GetEnvironmentVariable("ZKUBE_PROFILE_IDENTITY_FIXTURE") ??
            Path.GetFullPath(Path.Combine(Application.dataPath, "../../fixtures/unity-profile-identity-v1.json")))));
        private static JObject Fixture() => FixtureData.Value;
        public static IEnumerable<TestCaseData> Cases() => Fixture()["cases"].Select(row =>
            new TestCaseData((string)row["id"]).SetName("ProfileIdentity_" + (string)row["id"]));

        [TestCaseSource(nameof(Cases))]
        public async Task ChoicesMatchProgramAndTypeScriptThroughValidatedCampaignReads(string id)
        {
            var row = Fixture()["cases"].Single(value => (string)value["id"] == id);
            var e = new MoneyTestEnvironment();
            try
            {
                var accounts = MoneyTestEnvironment.Fixture("unity-product-reads-v1.json")["accounts"];
                foreach (var catalog in accounts["catalogs"]) e.Http.Add(catalog);
                e.Http.Add(row["player"]);
                await e.Flow.Connect(e.Owner);
                var read = (await e.Flow.RefreshProfile()).Value;
                var identity = read.Identity;
                CollectionAssert.AreEqual(row["unlocked"].Values<byte>(), identity.Emblems.Where(choice => choice.Earned).Select(choice => choice.Definition.Id));
                CollectionAssert.AreEqual(row["gold"].Values<byte>(), identity.Emblems.Where(choice => choice.Gold).Select(choice => choice.Definition.Id));
                Assert.That(identity.DisplayedEmblem, Is.EqualTo((byte)row["automatic"]));
                Assert.That(identity.StoredEmblem, Is.Zero);
                Assert.That(identity.ProgressAvailable, Is.True);
                foreach (var definition in ProfileIdentityCatalog.Emblems)
                {
                    var expected = Fixture()["emblems"].Single(value => (byte)value["id"] == definition.Id);
                    Assert.That(definition.Name, Is.EqualTo((string)expected["name"]));
                    Assert.That(definition.Realm, Is.EqualTo((byte)expected["realm"]));
                    Assert.That(identity.CanWear(definition.Id, 0), Is.EqualTo(row["unlocked"].Values<byte>().Contains(definition.Id)));
                }
                Assert.That(identity.CanWear(255, 0), Is.False);
                Assert.That(identity.CanWear(0, 255), Is.False);
                e.AssertReadOnly();
                // Session inspection reads the stored key to verify readiness;
                // only Connect may prompt, and visiting a profile never mutates keys.
                Assert.That(e.Native.Calls, Is.EqualTo(1), "Only the explicit Connect prompts the wallet");
                Assert.That(e.Native.Promotions + e.Native.Deletions, Is.Zero);
            }
            finally { await e.Flow.StopAsync(); }
        }

        [Test]
        public async Task MissingPublicationDoesNotConcealTheProfileOrOfferUnearnedEmblems()
        {
            var e = new MoneyTestEnvironment();
            try
            {
                var accounts = MoneyTestEnvironment.Fixture("unity-product-reads-v1.json")["accounts"];
                e.Http.Add(accounts["player"]);
                await e.Flow.Connect(e.Owner);
                var read = (await e.Flow.RefreshProfile()).Value;
                Assert.That(read.Campaign.Status, Is.EqualTo("missing-catalog"));
                Assert.That(read.Profile.Exists, Is.True);
                Assert.That(read.Identity.ProgressAvailable, Is.False);
                CollectionAssert.AreEqual(new byte[] { 0 }, read.Identity.Emblems.Where(value => value.Earned).Select(value => value.Definition.Id));
                e.AssertReadOnly();
            }
            finally { await e.Flow.StopAsync(); }
        }

        [Test]
        public async Task ConfirmedProfileWriteInvalidatesEarlierReadAndKeepsItsReceipt()
        {
            var graph = await MoneySessionEvidenceGraph.Create("profile-success",
                File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")),
                File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));
            var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(graph.Owner);
                var first = await flow.RefreshProfile();
                Assert.That(first.Value.Identity.StoredEmblem, Is.Zero);
                Assert.That(first.Value.Identity.DisplayedEmblem, Is.EqualTo(12));
                var result = (await flow.SetFeaturedIdentity(8, 3)).Value;
                Assert.That(first.IsCurrent, Is.False);
                var next = (await flow.RefreshProfile()).Value;
                Assert.That(next.Identity.StoredEmblem, Is.EqualTo(8));
                Assert.That(next.Profile.WornTier, Is.EqualTo(3));
                Assert.That(next.PreviousOperation, Is.SameAs(result));
                Assert.That(graph.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
                Assert.That(graph.Calls.Count(call => call.Operation == "signTransactions"), Is.Zero);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
    }
}
