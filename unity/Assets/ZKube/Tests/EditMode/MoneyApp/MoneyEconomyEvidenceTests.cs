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
    public sealed class MoneyEconomyEvidenceTests
    {
        private static JObject Fixture() => JObject.Parse(File.ReadAllText(Path.Combine(Application.dataPath, "../../fixtures/unity-money-economy-v1.json")));
        private static Task<MoneySessionEvidenceGraph> Create(string scenario) => MoneySessionEvidenceGraph.Create(scenario,
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")),
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));

        [TestCase("kredit-buy-1"), TestCase("kredit-buy-10"), TestCase("kredit-buy-25"),
         TestCase("kredit-owner-decline"), TestCase("kredit-fee-shortage"),
         TestCase("kredit-pending-success"), TestCase("kredit-pending-failure")]
        public async Task PurchaseReadsItsConfirmedProfileAndNeverChangesEntriesOrAwards(string scenario)
        {
            var graph = await Create(scenario); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                var row = Fixture()["scenarios"].Single(value => (string)value["id"] == scenario);
                await flow.Connect(graph.Owner);
                var before = (await flow.RefreshKredits()).Value.Profile;
                Assert.That(before.Kredits.ToString(), Is.EqualTo((string)row["expectedBefore"]["kredits"]));
                var result = (await flow.BuyKredits(graph.KreditPack)).Value;
                if ((string)row["status"] == "processed")
                {
                    Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.Pending), result.Code);
                    var pending = (await flow.RefreshKredits()).Value;
                    Assert.That(pending.Profile.Kredits, Is.EqualTo(before.Kredits));
                    Assert.That(pending.Pending.Signature, Is.EqualTo(result.Signature));
                    await MoneyTestEnvironment.Fails<InvalidOperationException>(() => flow.BuyKredits(graph.KreditPack));
                    var stillPending = (await flow.RefreshOwner()).Value;
                    Assert.That(stillPending.PreviousOperation.Signature, Is.EqualTo(result.Signature));
                    Assert.That(graph.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
                    if ((bool)row["failure"]) graph.ConfirmPendingFailure(); else graph.ConfirmPendingSuccess();
                    result = (await flow.ResumePending()).Value;
                }
                var expected = (bool)row["ownerDeclines"] ? ExecutionOutcome.Rejected : scenario == "kredit-fee-shortage" ? ExecutionOutcome.FeeShortage :
                    (bool)row["failure"] ? ExecutionOutcome.ConfirmedFailure : ExecutionOutcome.ConfirmedSuccess;
                Assert.That(result.Outcome, Is.EqualTo(expected), result.Code);
                var after = (await flow.RefreshKredits()).Value;
                Assert.That(after.PreviousOperation, Is.SameAs(result));
                Assert.That(after.Profile.Kredits.ToString(), Is.EqualTo((string)row["expectedAfter"]["kredits"]));
                Assert.That(after.Profile.LadderPoints, Is.EqualTo(before.LadderPoints));
                foreach (string field in new[] { "lifetime_paid_entries", "campaign_stars", "entry_streak_days" })
                    Assert.That(JToken.DeepEquals(after.Profile.Fields[field], before.Fields[field]), Is.True, field);
                Assert.That(after.Pending, Is.Null);
                bool submitted = expected == ExecutionOutcome.ConfirmedSuccess || expected == ExecutionOutcome.ConfirmedFailure;
                Assert.That(graph.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(submitted ? 1 : 0));
                Assert.That(graph.Calls.Count(call => call.Operation == "signTransactions"), Is.EqualTo(submitted || (bool)row["ownerDeclines"] ? 1 : 0));
                if (submitted)
                {
                    var calls = graph.Calls.Select(call => call.Operation).ToList();
                    Assert.That(calls.IndexOf("commit-journal"), Is.LessThan(calls.IndexOf("sendTransaction")));
                    Assert.That(result.Signature, Is.EqualTo(graph.SentSignature));
                }
                Assert.That(graph.HasActiveKey, Is.False); Assert.That(graph.HasCandidateKey, Is.False);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task DisconnectDuringPurchaseApprovalCannotSendOrReplaceTheNewOwnerView()
        {
            var graph = await Create("kredit-buy-1"); var flow = new MoneyAppFlow(graph.Services); var held = graph.HoldNextWallet();
            try
            {
                await flow.Connect(graph.Owner); var purchase = flow.BuyKredits(1); await held.Entered;
                var disconnect = flow.Disconnect(); Assert.That(graph.Services.Identity.Owner, Is.Null);
                held.Release();
                await MoneyTestEnvironment.Fails<OperationCanceledException>(async () => await purchase);
                await disconnect;
                Assert.That(graph.Calls.Any(call => call.Operation == "sendTransaction"), Is.False);
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { held.Release(); await flow.StopAsync(); }
        }

        [Test] public async Task ConfirmedPurchaseReceiptSurvivesAFailedBalanceReadAndNeverBuysAgain()
        {
            var graph = await Create("kredit-buy-10"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                await flow.Connect(graph.Owner);
                graph.FailFirstReadAfterJournalClear();
                var result = (await flow.BuyKredits(10)).Value;
                Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                await MoneyTestEnvironment.Fails<Exception>(async () => await flow.RefreshKredits());
                var refreshed = (await flow.RefreshKredits()).Value;
                Assert.That(refreshed.PreviousOperation, Is.SameAs(result));
                Assert.That(refreshed.Profile.Kredits, Is.EqualTo(35));
                Assert.That(graph.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
    }
}
