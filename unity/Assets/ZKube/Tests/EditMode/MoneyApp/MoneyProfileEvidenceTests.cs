using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Integration.App.Evidence;
using ZKube.Integration.Execution;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneyProfileEvidenceTests
    {
        private static JObject Fixture() => JObject.Parse(File.ReadAllText(Path.Combine(Application.dataPath, "../../fixtures/unity-money-profile-v1.json")));
        private static Task<MoneySessionEvidenceGraph> Create(string scenario) => MoneySessionEvidenceGraph.Create(scenario,
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")),
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));

        [TestCase(false), TestCase(true)]
        public async Task AConfirmedChoiceSurvivesFailedReadbackWithoutAnotherWrite(bool corrupt)
        {
            var graph = await Create("profile-success"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(graph.Owner);
                if (corrupt) graph.CorruptFirstReadAfterJournalClear(graph.Services.Planner.Player(graph.Owner));
                else graph.FailFirstReadAfterJournalClear();
                var result = (await flow.SetFeaturedIdentity(8, 3)).Value;
                Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess), result.Code);
                if (corrupt) await MoneyTestEnvironment.Fails<FormatException>(() => flow.RefreshKredits());
                else await MoneyTestEnvironment.Fails<IOException>(() => flow.RefreshKredits());
                var read = (await flow.RefreshKredits()).Value;
                Assert.That(read.PreviousOperation, Is.SameAs(result));
                Assert.That((byte)read.Profile.Fields["featured_emblem"], Is.EqualTo(8));
                Assert.That(read.Profile.WornTier, Is.EqualTo(3));
                Assert.That(read.Pending, Is.Null);
                if (corrupt) Assert.That(graph.Calls.Count(call => call.Operation == "injected-account-owner-after-journal-clear"), Is.EqualTo(1));
                Assert.That(graph.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
                Assert.That(graph.Calls.Count(call => call.Operation == "signTransactions"), Is.Zero);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [TestCase("profile-success"), TestCase("profile-auto"), TestCase("profile-confirmed-failure"),
         TestCase("profile-pending-success"), TestCase("profile-pending-failure"),
         TestCase("profile-missing-session"), TestCase("profile-superseded")]
        public async Task FeaturedIdentityUsesOneDeviceWriteAndReadsTheActualProfile(string scenario)
        {
            var graph = await Create(scenario); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                var row = Fixture()["scenarios"].Single(value => (string)value["id"] == scenario);
                await flow.Connect(graph.Owner);
                var initial = await flow.RefreshKredits();
                var before = initial.Value.Profile;
                Assert.That((byte)before.Fields["featured_emblem"], Is.EqualTo((byte)row["expectedBefore"]["featuredEmblem"]));
                bool available = (string)row["variant"] != "missing-session";
                if (!available)
                {
                    await MoneyTestEnvironment.Fails<InvalidOperationException>(() => flow.SetFeaturedIdentity((byte)row["emblem"], (byte)row["frame"]));
                    Assert.That(graph.SentSignature, Is.Null);
                }
                else
                {
                    var receipt = (await flow.SetFeaturedIdentity((byte)row["emblem"], (byte)row["frame"])).Value;
                    var signature = receipt.Signature;
                    if ((string)row["status"] == "processed")
                    {
                        Assert.That(receipt.Outcome, Is.EqualTo(ExecutionOutcome.Pending), receipt.Code);
                        int checks = graph.Calls.Count(call => call.Operation == "getSignatureStatuses");
                        var pending = (await flow.RefreshKredits()).Value;
                        Assert.That(pending.Pending.Signature, Is.EqualTo(signature));
                        Assert.That(JToken.DeepEquals(pending.Profile.Fields, before.Fields), Is.True);
                        Assert.That(graph.Calls.Count(call => call.Operation == "getSignatureStatuses"), Is.EqualTo(checks));
                        await MoneyTestEnvironment.Fails<InvalidOperationException>(() => flow.SetFeaturedIdentity(0, 0));
                        if ((bool)row["failure"]) graph.ConfirmPendingFailure(); else graph.ConfirmPendingSuccess();
                        receipt = (await flow.ResumePending()).Value;
                    }
                    Assert.That(receipt.Outcome, Is.EqualTo((bool)row["failure"] ? ExecutionOutcome.ConfirmedFailure : ExecutionOutcome.ConfirmedSuccess), receipt.Code);
                    Assert.That(receipt.Signature, Is.EqualTo(signature));
                    Assert.That(signature, Is.EqualTo(graph.SentSignature));
                    Assert.That((await flow.RefreshKredits()).Value.PreviousOperation, Is.SameAs(receipt));
                    var calls = graph.Calls.Select(call => call.Operation).ToList();
                    Assert.That(calls.Count(call => call == "sendTransaction"), Is.EqualTo(1));
                    Assert.That(calls.IndexOf("commit-journal"), Is.LessThan(calls.IndexOf("sendTransaction")));
                }
                var after = (await flow.RefreshKredits()).Value.Profile;
                Assert.That((byte)after.Fields["featured_emblem"], Is.EqualTo((byte)row["expectedAfter"]["featuredEmblem"]));
                Assert.That(after.WornTier, Is.EqualTo((byte)row["expectedAfter"]["featuredFrameTier"]));
                Assert.That(after.Kredits.ToString(), Is.EqualTo((string)row["expectedAfter"]["kreditBalance"]));
                Assert.That(after.LadderPoints.ToString(), Is.EqualTo((string)row["expectedAfter"]["ladderPoints"]));
                foreach (var field in before.Fields.Properties().Where(value => value.Name != "featured_emblem" && value.Name != "featured_frame_tier"))
                    Assert.That(JToken.DeepEquals(after.Fields[field.Name], field.Value), Is.True, field.Name);
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
                Assert.That(graph.Calls.Count(call => call.Operation == "signTransactions"), Is.Zero);
                Assert.That(graph.HasCandidateKey, Is.False);
                Assert.That(graph.HasActiveKey, Is.EqualTo(available));
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
    }
}
